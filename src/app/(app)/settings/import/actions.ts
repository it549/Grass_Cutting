"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/context";
import { sql } from "@/lib/db/sql";
import { setRouteStatus } from "@/lib/data/routes";
import { docTotals, type DocData } from "@/lib/docs";
import { num } from "@/lib/calc";
import { weekOf } from "@/lib/model";

/* รูปแบบข้อมูลส่งออกจากระบบเดิม (claude.ai): แต่ละ collection เป็นรายการ {id, ...data} */
type Old = Record<string, unknown> & { id: string };
export type OldExport = { inst?: Old[]; pics?: Old[]; daily?: Old[]; docs?: Old[]; settings?: Old[]; road?: Old[]; adv?: Old[]; pay?: Old[]; fuel?: Old[] };
export type PhotoJob = { orderId: string; routeId: string; label: string; pics: { asset: string; kind: string; slot: string | null; date: string; time: string; cap: string; name: string; sig: string }[] };
export type ImportResult = { error?: string; log: string[]; photos: PhotoJob[] };

const s = (v: unknown) => (v == null ? "" : String(v));
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const cKey = (c: unknown) => s(c).toLowerCase().replace(/[\s.\-]/g, "");
const fyOf = (d: string) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return y + 543 + (m >= 10 ? 1 : 0); };
const PAYBY = ["cash", "pp", "bank"];
/** ห่อคำสั่ง SQL ให้คืน { data, error } แบบเดิม (ย้ายข้อมูลต่อแม้บางแถวพลาด) */
async function q<T>(run: () => Promise<T>): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    return { data: await run(), error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}
type Row = Record<string, string | number | boolean | null>;
const ins = (table: string, row: Row) => q(async () => (await sql<{ id: string }[]>`insert into ${sql(table)} ${sql(row)} returning id`)[0]);

export async function importOld(x: OldExport): Promise<ImportResult> {
  const { userId, company, perm } = await requireCompany();
  const log: string[] = [];
  const photos: PhotoJob[] = [];
  if (!perm.members) return { error: "เฉพาะเจ้าของที่ย้ายข้อมูลได้", log, photos };
  const settings = Object.fromEntries((x.settings ?? []).map((d) => [d.id, d])) as Record<string, Old>;

  // ข้อมูลบริษัท: เติมเฉพาะช่องที่ยังว่าง
  const co = settings.company as Record<string, unknown> | undefined;
  if (co) {
    const map: Record<string, string> = { name_en: "nameEn", tax_id: "taxId", branch: "branch", address: "address", phone: "phone", email: "email", signer_name: "signer", signer_title: "signerTitle", bank_name: "bankName", bank_account_no: "bankNo", bank_account_name: "bankAcct" };
    const patch: Record<string, string> = {};
    for (const [col, k] of Object.entries(map)) if (!(company as unknown as Record<string, unknown>)[col] && s(co[k])) patch[col] = s(co[k]);
    if (Object.keys(patch).length) {
      const { error } = await q(() => sql`update companies set ${sql(patch)} where id = ${company.id}`);
      log.push(error ? `ข้อมูลบริษัท: ${error.message}` : `ข้อมูลบริษัท: เติม ${Object.keys(patch).length} ช่องที่ยังว่าง`);
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
    const { data, error } = await q(async () => (await sql<{ id: string }[]>`
      insert into agencies (company_id, name, short_name, address, phone, tax_id, director, hmds, sort, photo_lr)
      values (${company.id}, ${s(a.name) || "แขวง"}, ${s(a.short) || null}, ${s(a.addr) || null}, ${s(a.phone) || null},
              ${s(a.tax) || null}, ${s(a.director) || null}, ${((a.hmds as string[]) ?? []).map(String)}, ${i}, ${a.photoLR === true})
      returning id
    `)[0]);
    if (error || !data) { log.push(`แขวง ${s(a.name)}: ${error?.message}`); continue; }
    agMap[a.id] = data.id; agAdded++;
  }
  log.push(`แขวง: เพิ่มใหม่ ${agAdded} · มีอยู่แล้ว ${oldAg.length - agAdded}`);
  const agOf = (id: unknown) => agMap[s(id)] ?? agMap[oldAg[0].id];

  // ลูกจ้าง (ทะเบียนคนงาน): จับคู่ตามชื่อ เติมข้อมูลใหม่ให้คนที่มีอยู่แล้วเฉพาะช่องที่ว่าง
  const oldCrew = ((settings.crew?.list as Old[] | undefined) ?? []) as Old[];
  const crewNow = await sql<{ id: string; name: string; nick: string; role: string; phone: string; pay_no: string; note: string; start_date: string | null }[]>`
    select id, name, nick, role, phone, pay_no, note, start_date from crew where company_id = ${company.id}
  `;
  const crewMap: Record<string, string> = {};
  let crAdd = 0;
  for (const [i, c] of oldCrew.entries()) {
    const name = s(c.name).trim();
    if (!name) continue;
    const row = {
      name, nick: s(c.nick).slice(0, 60), role: s(c.role).slice(0, 60), phone: s(c.phone).slice(0, 40), wage: num(c.wage),
      pay_by: PAYBY.includes(s(c.payBy)) ? s(c.payBy) : "cash", pay_no: s(c.payNo).slice(0, 80), start_date: isDate(c.start) ? c.start : null,
      active: c.status !== "paused", note: s(c.note).slice(0, 500),
    };
    const hit = crewNow.find((n) => n.name === name);
    if (hit) {
      crewMap[c.id] = hit.id;
      const patch: Row = {};
      for (const k of ["nick", "role", "phone", "pay_no", "note"] as const) if (!hit[k] && row[k]) patch[k] = row[k];
      if (!hit.start_date && row.start_date) patch.start_date = row.start_date;
      if (Object.keys(patch).length) await sql`update crew set ${sql(patch)} where id = ${hit.id} and company_id = ${company.id}`;
      continue;
    }
    const { data, error } = await ins("crew", { company_id: company.id, ...row, sort: 100 + i });
    if (error || !data) { log.push(`ลูกจ้าง ${name}: ${error?.message}`); continue; }
    crewMap[c.id] = data.id; crAdd++;
  }
  log.push(`ลูกจ้าง: เพิ่ม ${crAdd} คน · มีอยู่แล้ว ${Object.keys(crewMap).length - crAdd}`);
  const crewId = (id: unknown, name?: unknown) => crewMap[s(id)] ?? crewNow.find((n) => n.name === s(name).trim())?.id ?? "";

  // ทะเบียนสายทาง
  const roadMap: Record<string, string> = {};
  if ((x.road ?? []).length) {
    const rdNow: { id: string; agency_id: string; code: string }[] = [...(await sql<{ id: string; agency_id: string; code: string }[]>`select id, agency_id, code from roads where company_id = ${company.id}`)];
    let rAdd = 0;
    for (const g of x.road ?? []) {
      const ag = agOf(g.ag), code = s(g.code).trim();
      if (!code) continue;
      const hit = rdNow.find((n) => n.agency_id === ag && cKey(n.code) === cKey(code));
      if (hit) { roadMap[g.id] = hit.id; continue; }
      const map = s(g.map).trim();
      const { data, error } = await ins("roads", {
        company_id: company.id, agency_id: ag, hmd: s(g.hmd), code, name: s(g.name).trim(), amp: s(g.amp).trim(),
        len_km: num(g.len) > 0 ? num(g.len) : null, map_url: /^https?:\/\//i.test(map) ? map : null, note: s(g.note),
      });
      if (error || !data) { log.push(`สายทาง ${code}: ${error?.message}`); continue; }
      roadMap[g.id] = data.id; rAdd++;
      rdNow.push({ id: data.id, agency_id: ag, code });
    }
    log.push(`ทะเบียนสายทาง: เพิ่ม ${rAdd} สาย · มีอยู่แล้ว ${Object.keys(roadMap).length - rAdd}`);
  }

  // ใบสั่งจ้าง + สายทาง
  const ordMap: Record<string, string> = {};
  const routeMap: Record<string, string> = {};
  let oAdd = 0, oSkip = 0;
  const todayFy = fyOf(new Date().toISOString().slice(0, 10));
  for (const I of x.inst ?? []) {
    const po = (I.po ?? {}) as Record<string, unknown>;
    const ag = agOf(I.ag);
    const fy = num(I.yr) || (isDate(po.date) ? fyOf(po.date) : 0) || todayFy;
    const rs = ((I.routes as Old[]) ?? []).map((r) => ({ old: r.id, code: s(r.code).trim(), descr: s(r.desc).trim(), area: num(r.area), rate: num(r.rate), road_id: roadMap[s(r.road)] ?? "", in_po: r.inPo !== false }));
    const [ex] = await sql<{ id: string }[]>`
      select id from orders where company_id = ${company.id} and agency_id = ${ag} and fy = ${fy} and round_no = ${num(I.no) || 1} and hmd = ${s(I.hmd)}
    `;
    let oid = ex?.id as string | undefined;
    if (oid) oSkip++;
    else {
      const order = {
        agency_id: ag, fy, round_no: num(I.no) || 1, hmd: s(I.hmd), start_date: isDate(I.start) ? I.start : "", po_no: s(po.no), po_date: isDate(po.date) ? po.date : "", proj_no: s(po.projNo),
        due_days: po.dueDays ? String(Math.trunc(num(po.dueDays))) : "", due_date: isDate(po.dueDate) ? po.dueDate : "", penalty: s(po.penalty),
        vat_incl: I.vatIncl !== false, note: "", po_file_path: "",
      };
      const routes = rs.map(({ code, descr, area, rate, road_id, in_po }) => ({ code, descr, area, rate, road_id, in_po }));
      const { data, error } = await q(async () => (await sql<{ id: string }[]>`select public.save_order(${null}, ${company.id}, ${sql.json(order)}, ${sql.json(routes)}) as id`)[0].id);
      if (error || !data) { log.push(`ใบสั่งจ้าง ${s(po.no) || "งวด " + s(I.no) + " หมวด" + s(I.hmd)}: ${error?.message}`); continue; }
      oid = data; oAdd++;
    }
    ordMap[I.id] = oid!;
    const newR = await sql<{ id: string; code: string; seq: number }[]>`select id, code, seq from routes where order_id = ${oid!} order by seq`;
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
      await q(() => setRouteStatus(userId, rid, typeof p.done === "boolean" ? p.done : null, isDate(p.doneDate) ? p.doneDate : null));
      stN++;
    }
    // v34: รูปที่วางในช่องตาม กม. (slots) ย้ายมาพร้อมช่อง · รูปในถาด = t · รูปรุ่นเก่า = b/a
    const slots = (p.slots && typeof p.slots === "object" ? p.slots : {}) as Record<string, unknown>;
    const slotOf = (id: string) => Object.keys(slots).find((k) => slots[k] === id && /^[baLR]\|\d+$/.test(k)) ?? null;
    const list = ((p.pics as Old[]) ?? []).filter((q) => q.id).map((q) => {
      const sl = slotOf(s(q.id));
      return { asset: s(q.id), slot: sl, kind: sl ? sl[0] : q.kind === "a" || q.kind === "b" ? s(q.kind) : "t", date: s(q.date), time: s(q.time), cap: s(q.cap), name: s(q.name), sig: s(q.sig) || "old:" + s(q.id) };
    });
    if (list.length) photos.push({ orderId: oid, routeId: rid, label: key, pics: list });
  }
  if (stN) log.push(`สถานะสายทาง: ${stN} สาย`);

  // บันทึกรายวัน (แบบใหม่ work [{i, r, km, fin}] หรือแบบเดิม inst + routes)
  let dAdd = 0, dSkip = 0;
  for (const d of x.daily ?? []) {
    if (!isDate(d.id)) continue;
    const [ex] = await sql`select log_date from daily_logs where company_id = ${company.id} and log_date = ${d.id}`;
    if (ex) { dSkip++; continue; }
    const inst = s(d.inst);
    const work = Array.isArray(d.work)
      ? (d.work as Old[]).map((w) => ({ r: routeMap[`${s(w.i)}_${s(w.r)}`], km: w.km == null || s(w.km) === "" ? null : num(w.km), fin: w.fin === true })).filter((w) => w.r).map((w) => (w.fin ? w : { r: w.r, km: w.km }))
      : ((d.routes as string[]) ?? []).map((r) => routeMap[`${inst}_${r}`]).filter(Boolean).map((r) => ({ r, km: null }));
    const crew = ((d.crew as Old[]) ?? []).filter((c) => s(c.name).trim()).map((c) => ({ id: crewId(c.id, c.name), name: s(c.name), wage: num(c.wage), ot: num(c.ot), on: Boolean(c.on), ...(c.on && c.half ? { half: true } : {}) }));
    const { error } = await q(() => sql`
      insert into daily_logs (company_id, log_date, order_id, work, crew, fuel, fuel_car, water, other, note, updated_by)
      values (${company.id}, ${d.id}, ${ordMap[inst] ?? null}, ${sql.json(work)}, ${sql.json(crew)}, ${num(d.fuel)}, ${num(d.fuelCar)},
              ${num(d.water)}, ${num(d.other)}, ${s(d.note)}, ${userId})
    `);
    if (error) log.push(`รายวัน ${d.id}: ${error.message}`); else dAdd++;
  }
  if ((x.daily ?? []).length) log.push(`บันทึกรายวัน: เพิ่ม ${dAdd} วัน · มีอยู่แล้ว ${dSkip}`);

  // เบิกล่วงหน้า
  if ((x.adv ?? []).length) {
    const aNow = await sql<{ crew_id: string; adv_date: string; amt: number }[]>`select crew_id, adv_date, amt from crew_advances where company_id = ${company.id}`;
    let aAdd = 0, aSkip = 0;
    for (const a of x.adv ?? []) {
      const cid = crewId(a.cid);
      if (!cid || !isDate(a.date) || !(num(a.amt) > 0)) { aSkip++; continue; }
      if (aNow.some((n) => n.crew_id === cid && n.adv_date === a.date && Number(n.amt) === num(a.amt))) { aSkip++; continue; }
      const { error } = await ins("crew_advances", { company_id: company.id, crew_id: cid, adv_date: a.date as string, amt: num(a.amt), note: s(a.note).slice(0, 200), created_by: userId });
      if (error) log.push(`เบิกล่วงหน้า ${a.date}: ${error.message}`); else aAdd++;
    }
    log.push(`เบิกล่วงหน้า: เพิ่ม ${aAdd} · ข้าม ${aSkip}`);
  }
  // จ่ายค่าแรงแล้ว
  if ((x.pay ?? []).length) {
    let pAdd = 0, pSkip = 0;
    for (const p of x.pay ?? []) {
      const cid = crewId(p.cid, p.name);
      if (!cid || !isDate(p.wk) || !isDate(p.date)) { pSkip++; continue; }
      const wk0 = weekOf(p.wk)[0]; // ระบบเดิมเก็บเป็นวันจันทร์ · ที่นี่รอบเริ่มวันเสาร์ก่อนหน้า
      const [ex] = await sql`select crew_id from crew_pays where company_id = ${company.id} and week_start = ${wk0} and crew_id = ${cid}`;
      if (ex) { pSkip++; continue; }
      const { error } = await q(() => sql`insert into crew_pays ${sql({
        company_id: company.id, week_start: wk0, crew_id: cid, name: s(p.name), pay_date: p.date as string, method: PAYBY.includes(s(p.method)) ? s(p.method) : "cash",
        days: num(p.days), gross: num(p.gross), ot: num(p.ot), ded: num(p.ded), net: num(p.net), created_by: userId,
      })}`);
      if (error) log.push(`จ่ายค่าแรง ${p.wk}: ${error.message}`); else pAdd++;
    }
    log.push(`จ่ายค่าแรง: เพิ่ม ${pAdd} รายการ · ข้าม ${pSkip}`);
  }
  // รถ + น้ำมัน
  const carMap: Record<string, string> = {};
  const oldCars = ((settings.cars?.list as Old[] | undefined) ?? []) as Old[];
  if (oldCars.length) {
    const cNow = await sql<{ id: string; plate: string }[]>`select id, plate from cars where company_id = ${company.id}`;
    for (const [i, c] of oldCars.entries()) {
      const plate = s(c.plate).trim();
      if (!plate) continue;
      const hit = cNow.find((n) => cKey(n.plate) === cKey(plate));
      if (hit) { carMap[c.id] = hit.id; continue; }
      const { data, error } = await ins("cars", { company_id: company.id, plate, name: s(c.name), fuel_type: s(c.fuelType), active: c.status !== "off", sort: i });
      if (error || !data) { log.push(`รถ ${plate}: ${error?.message}`); continue; }
      carMap[c.id] = data.id;
    }
    log.push(`รถ: ${Object.keys(carMap).length} คัน`);
  }
  if ((x.fuel ?? []).length) {
    const fNow = await sql<{ log_date: string; kind: string; liters: number; amt: number }[]>`select log_date, kind, liters, amt from fuel_logs where company_id = ${company.id}`;
    let fAdd = 0, fSkip = 0;
    for (const f of x.fuel ?? []) {
      const kind = f.kind === "car" ? "car" : "mower";
      if (!isDate(f.date) || !(num(f.liters) > 0)) { fSkip++; continue; }
      if (fNow.some((n) => n.log_date === f.date && n.kind === kind && Number(n.liters) === num(f.liters) && Number(n.amt) === num(f.amt))) { fSkip++; continue; }
      const { error } = await ins("fuel_logs", {
        company_id: company.id, log_date: f.date as string, kind, liters: num(f.liters), price: num(f.price), amt: num(f.amt),
        crew_id: crewId(f.by) || null, by_name: s(f.byName), car_id: kind === "car" ? carMap[s(f.car)] ?? null : null, car_plate: kind === "car" ? s(f.carPlate) : "",
        odo: kind === "car" && num(f.odo) > 0 ? Math.round(num(f.odo)) : null, note: s(f.note).slice(0, 200), created_by: userId,
      });
      if (error) log.push(`น้ำมัน ${f.date}: ${error.message}`); else fAdd++;
    }
    log.push(`เบิกน้ำมัน: เพิ่ม ${fAdd} · ข้าม ${fSkip}`);
  }

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
    const { error } = await q(() => sql`
      insert into documents (company_id, order_id, kind, no, doc_date, status, data, total, issued_at, void_reason, created_by)
      values (${company.id}, ${ordMap[s(inst)] ?? null}, ${kind}, ${s(d.no)}, ${isDate(d.date) ? d.date : new Date().toISOString().slice(0, 10)},
              ${st}, ${sql.json(dd as unknown as Record<string, never>)}, ${docTotals(dd).total}, ${st !== "draft" ? s(issuedAt) || new Date().toISOString() : null},
              ${st === "void" ? s(voidReason) || "ยกเลิกในระบบเดิม" : null}, ${userId})
    `);
    if (error) log.push(`เอกสาร ${s(d.no)}: ${error.message}`); else cAdd++;
  }
  log.push(`เอกสาร: เพิ่ม ${cAdd} · เลขที่ซ้ำ (ข้าม) ${cSkip}`);
  if (photos.length) log.push(`รูป: ${photos.reduce((n, p) => n + p.pics.length, 0)} รูป กำลังอัปโหลดจากไฟล์ zip…`);
  revalidatePath("/", "layout");
  return { log, photos };
}
