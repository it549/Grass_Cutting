"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db/sql";
import { setRouteStatus } from "@/lib/data/routes";
import { docTotals, type DocData } from "@/lib/docs";
import { num } from "@/lib/calc";

/* รูปแบบข้อมูลส่งออกจากระบบเดิม (claude.ai): แต่ละ collection เป็นรายการ {id, ...data} */
type Old = Record<string, unknown> & { id: string };
export type OldExport = { inst?: Old[]; pics?: Old[]; daily?: Old[]; docs?: Old[]; settings?: Old[] };
export type PhotoJob = { orderId: string; routeId: string; label: string; pics: { asset: string; kind: "a" | "b"; date: string; time: string; cap: string; name: string }[] };
export type ImportResult = { error?: string; log: string[]; photos: PhotoJob[] };

const s = (v: unknown) => (v == null ? "" : String(v));
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function importOld(x: OldExport): Promise<ImportResult> {
  const { company, perm } = await requireCompany();
  const session = await getSession();
  const log: string[] = [];
  const photos: PhotoJob[] = [];
  if (!perm.members || !session) return { error: "เฉพาะเจ้าของที่ย้ายข้อมูลได้", log, photos };
  const userId = session.userId;
  const settings = Object.fromEntries((x.settings ?? []).map((d) => [d.id, d])) as Record<string, Old>;

  // ข้อมูลบริษัท: เติมเฉพาะช่องที่ยังว่าง
  const co = settings.company as Record<string, unknown> | undefined;
  if (co) {
    const map: Record<string, string> = { name_en: "nameEn", tax_id: "taxId", branch: "branch", address: "address", phone: "phone", email: "email", signer_name: "signer", signer_title: "signerTitle", bank_name: "bankName", bank_account_no: "bankNo", bank_account_name: "bankAcct" };
    const patch: Record<string, string> = {};
    for (const [col, k] of Object.entries(map)) if (!(company as unknown as Record<string, unknown>)[col] && s(co[k])) patch[col] = s(co[k]);
    if (Object.keys(patch).length) {
      try {
        await sql`update companies set ${sql(patch, ...Object.keys(patch))} where id = ${company.id}`;
        log.push(`ข้อมูลบริษัท: เติม ${Object.keys(patch).length} ช่องที่ยังว่าง`);
      } catch (e) {
        log.push(`ข้อมูลบริษัท: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // แขวง
  const agNow = await sql<{ id: string; name: string; hmds: string[] }[]>`select id, name, hmds from agencies where company_id = ${company.id}`;
  const agMap: Record<string, string> = {};
  const oldAg = ((settings.agencies?.list as Old[] | undefined) ?? []) as Old[];
  if (!oldAg.length) oldAg.push({ id: "chb", name: "แขวงทางหลวงชนบทชลบุรี", short: "ชลบุรี", hmds: ((settings.roads?.hmds as string[]) ?? ["ชลบุรี", "บ่อทอง", "บางละมุง"]) });
  let agAdded = 0;
  for (const [i, a] of oldAg.entries()) {
    const hit = agNow.find((n) => n.name.trim() === s(a.name).trim());
    if (hit) { agMap[a.id] = hit.id; continue; }
    try {
      const [row] = await sql<{ id: string }[]>`
        insert into agencies (company_id, name, short_name, address, phone, tax_id, director, hmds, sort)
        values (${company.id}, ${s(a.name) || "แขวง"}, ${s(a.short) || null}, ${s(a.addr) || null}, ${s(a.phone) || null},
                ${s(a.tax) || null}, ${s(a.director) || null}, ${(a.hmds as string[]) ?? []}, ${i})
        returning id
      `;
      agMap[a.id] = row.id; agAdded++;
    } catch (e) {
      log.push(`แขวง ${s(a.name)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log.push(`แขวง: เพิ่มใหม่ ${agAdded} · มีอยู่แล้ว ${oldAg.length - agAdded}`);
  const agOf = (id: unknown) => agMap[s(id)] ?? agMap[oldAg[0].id];

  // ลูกจ้าง
  const oldCrew = ((settings.crew?.list as Old[] | undefined) ?? []) as Old[];
  const crewNow = await sql<{ name: string }[]>`select name from crew where company_id = ${company.id} and active = true`;
  const newCrew = oldCrew.filter((c) => s(c.name).trim() && !crewNow.some((n) => n.name === s(c.name).trim()));
  if (newCrew.length) {
    try {
      await sql`
        insert into crew ${sql(newCrew.map((c, i) => ({ company_id: company.id, name: s(c.name).trim(), wage: num(c.wage), sort: 100 + i })))}
      `;
    } catch (e) {
      log.push(`ลูกจ้าง: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log.push(`ลูกจ้าง: เพิ่ม ${newCrew.length} คน`);

  // ใบสั่งจ้าง + สายทาง
  const ordMap: Record<string, string> = {};
  const routeMap: Record<string, string> = {};
  let oAdd = 0, oSkip = 0;
  for (const I of x.inst ?? []) {
    const po = (I.po ?? {}) as Record<string, unknown>;
    const ag = agOf(I.ag);
    const rs = ((I.routes as Old[]) ?? []).map((r) => ({ old: r.id, code: s(r.code).trim(), descr: s(r.desc).trim(), area: num(r.area), rate: num(r.rate) }));
    const [ex] = await sql<{ id: string }[]>`
      select id from orders where company_id = ${company.id} and agency_id = ${ag} and round_no = ${num(I.no) || 1} and hmd = ${s(I.hmd)}
    `;
    let oid = ex?.id;
    if (oid) oSkip++;
    else {
      const order = {
        agency_id: ag, round_no: num(I.no) || 1, hmd: s(I.hmd), po_no: s(po.no), po_date: isDate(po.date) ? po.date : "", proj_no: s(po.projNo),
        due_days: po.dueDays ? String(Math.trunc(num(po.dueDays))) : "", due_date: isDate(po.dueDate) ? po.dueDate : "", penalty: s(po.penalty),
        vat_incl: I.vatIncl !== false, note: "", po_file_path: "",
      };
      try {
        const [row] = await sql<{ id: string }[]>`
          select public.save_order(null, ${company.id}, ${sql.json(order)}, ${sql.json(rs.map(({ code, descr, area, rate }) => ({ code, descr, area, rate })))}) as id
        `;
        oid = row.id; oAdd++;
      } catch (e) {
        log.push(`ใบสั่งจ้าง ${s(po.no)}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }
    ordMap[I.id] = oid;
    const newR = await sql<{ id: string; code: string; seq: number }[]>`select id, code, seq from routes where order_id = ${oid} order by seq`;
    const used = new Set<string>();
    for (const r of rs) {
      const m = newR.find((n) => n.code === r.code && !used.has(n.id));
      if (m) { routeMap[`${I.id}_${r.old}`] = m.id; used.add(m.id); }
    }
  }
  log.push(`ใบสั่งจ้าง: เพิ่มใหม่ ${oAdd} · มีอยู่แล้ว (ข้าม) ${oSkip}`);

  // สถานะสายทาง + รายการรูป (รูปอัปโหลดจากเบราว์เซอร์ต่อ)
  let stN = 0;
  for (const p of x.pics ?? []) {
    const key = `${s(p.inst)}_${s(p.rid)}`;
    const rid = routeMap[key] ?? routeMap[p.id];
    const oid = ordMap[s(p.inst)];
    if (!rid || !oid) continue;
    if (p.done === true || p.done === false || isDate(p.doneDate)) {
      try {
        await setRouteStatus(userId, rid, typeof p.done === "boolean" ? p.done : null, isDate(p.doneDate) ? (p.doneDate as string) : null);
        stN++;
      } catch {
        // ข้ามถ้าตั้งสถานะไม่ได้
      }
    }
    const list = ((p.pics as Old[]) ?? []).filter((q) => q.id).map((q) => ({ asset: s(q.id), kind: (q.kind === "a" ? "a" : "b") as "a" | "b", date: s(q.date), time: s(q.time), cap: s(q.cap), name: s(q.name) }));
    if (list.length) photos.push({ orderId: oid, routeId: rid, label: key, pics: list });
  }
  if (stN) log.push(`สถานะสายทาง: ${stN} สาย`);

  // บันทึกรายวัน
  let dAdd = 0, dSkip = 0;
  for (const d of x.daily ?? []) {
    if (!isDate(d.id)) continue;
    const [ex] = await sql<{ log_date: string }[]>`select log_date from daily_logs where company_id = ${company.id} and log_date = ${d.id}`;
    if (ex) { dSkip++; continue; }
    const inst = s(d.inst);
    try {
      await sql`
        insert into daily_logs (company_id, log_date, order_id, work, crew, fuel, other, note) values (
          ${company.id}, ${d.id}, ${ordMap[inst] ?? null},
          ${sql.json(((d.routes as string[]) ?? []).map((r) => routeMap[`${inst}_${r}`]).filter(Boolean).map((r) => ({ r, km: null })))},
          ${sql.json(((d.crew as Old[]) ?? []).map((c) => ({ id: s(c.id), name: s(c.name), wage: num(c.wage), ot: num(c.ot), on: Boolean(c.on) })))},
          ${num(d.fuel)}, ${num(d.other)}, ${s(d.note)}
        )
      `;
      dAdd++;
    } catch (e) {
      log.push(`รายวัน ${d.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if ((x.daily ?? []).length) log.push(`บันทึกรายวัน: เพิ่ม ${dAdd} วัน · มีอยู่แล้ว ${dSkip}`);

  // เอกสาร
  let cAdd = 0, cSkip = 0;
  const docNow = await sql<{ no: string }[]>`select no from documents where company_id = ${company.id}`;
  for (const d of x.docs ?? []) {
    const kind = s(d.kind);
    if (!["qt", "dl", "rc"].includes(kind) || !s(d.no)) continue;
    if (docNow.some((n) => n.no === s(d.no))) { cSkip++; continue; }
    const { id: _i, inst, status, updatedAt: _u, issuedAt, voidReason, ...rest } = d;
    void _i; void _u;
    const dd = { ...rest, head: { ...((rest.head as object) ?? {}), logo: company.logo_path ?? "" } } as unknown as DocData;
    const st = status === "issued" || status === "void" ? status : "draft";
    try {
      await sql`
        insert into documents (company_id, order_id, kind, no, doc_date, status, data, total, issued_at, void_reason) values (
          ${company.id}, ${ordMap[s(inst)] ?? null}, ${kind}, ${s(d.no)}, ${isDate(d.date) ? d.date : new Date().toISOString().slice(0, 10)},
          ${st}, ${sql.json(dd)}, ${docTotals(dd).total}, ${st !== "draft" ? s(issuedAt) || new Date().toISOString() : null},
          ${st === "void" ? s(voidReason) || "ยกเลิกในระบบเดิม" : null}
        )
      `;
      cAdd++;
    } catch (e) {
      log.push(`เอกสาร ${s(d.no)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log.push(`เอกสาร: เพิ่ม ${cAdd} · เลขที่ซ้ำ (ข้าม) ${cSkip}`);
  if (photos.length) log.push(`รูป: ${photos.reduce((n, p) => n + p.pics.length, 0)} รูป กำลังอัปโหลดจากไฟล์ zip…`);
  revalidatePath("/", "layout");
  return { log, photos };
}
