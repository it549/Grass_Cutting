"use client";

// หน้าเอกสาร: บอร์ดตามหมวดของงวด (ใบสั่งจ้าง › ใบเสนอราคา › หนังสือส่งมอบ › ใบกำกับภาษี) + ทะเบียนเอกสาร (แบบเดียวกับระบบบน claude.ai)
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Chip, Stat, Top, toast } from "@/components/ui";
import { RoundDialog } from "@/components/RoundDialog";
import { PackButton } from "@/components/PackButton";
import { RoundTabs } from "@/app/(app)/rounds/WorkView";
import { createDoc } from "./actions";
import { type DocKind, type DocLite, docTodos, docsOf, orderTotal } from "@/lib/docboard";
import { type Order, type RoundKey, type World, dS, fmt0, hasPo, poRoutes, rInfo, rkName, rkQuery, roundOf, roundSlots, workIndex } from "@/lib/model";

type Can = { orders: boolean; prices: boolean; qt: boolean; dl: boolean; rc: boolean };
const STL: Record<DocLite["status"], [string, string]> = { draft: ["ฉบับร่าง", "w"], issued: ["ออกแล้ว", "g"], void: ["ยกเลิก", "nd"] };
const TITLE: Record<DocKind, string> = { qt: "ใบเสนอราคา", dl: "หนังสือส่งมอบงาน", rc: "ใบกำกับภาษี / ใบเสร็จรับเงิน" };
const fmt2 = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function NewBtn({ kind, o, back, label, cls }: { kind: DocKind; o: Order; back: string; label: string; cls: string }) {
  return (
    <form action={createDoc} style={{ display: "contents" }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="order" value={o.id} />
      <input type="hidden" name="back" value={back} />
      <Submit label={label} cls={cls} />
    </form>
  );
}
function Submit({ label, cls }: { label: string; cls: string }) {
  const { pending } = useFormStatus();
  return <button className={cls} type="submit" disabled={pending}>{pending ? "กำลังสร้าง…" : label}</button>;
}

export function DocsView({ W, k, agSel, docs, tab, flash, can }: {
  W: World; k: RoundKey | null; agSel: string; docs: DocLite[]; tab: "board" | "list"; flash: { msg: string | null; err: string | null }; can: Can;
}) {
  const router = useRouter();
  const path = usePathname();
  const wi = useMemo(() => workIndex(W.days), [W.days]);
  const [plan, setPlan] = useState<string | null>(null);

  useEffect(() => {
    if (!flash.err && !flash.msg) return;
    if (flash.err) toast(flash.err, true); else if (flash.msg) toast(flash.msg);
    const u = new URL(window.location.href);
    u.searchParams.delete("err"); u.searchParams.delete("msg");
    window.history.replaceState(null, "", u.pathname + u.search);
  }, [flash.err, flash.msg]);

  const q = (x: RoundKey | null, list = false) => `/docs?${[x ? rkQuery(x) : agSel ? "ag=" + agSel : "", list ? "tab=list" : ""].filter(Boolean).join("&")}`;
  const tabs = (
    <div className="tabs">
      <Link href={q(k)} className={tab === "board" ? "on" : ""}>ตามหมวด</Link>
      <Link href={q(k, true)} className={tab === "list" ? "on" : ""}>ทะเบียนเอกสาร</Link>
    </div>
  );
  const agPick = W.agencies.length > 1 ? (
    <select className="in" style={{ width: "auto" }} value={agSel} onChange={(e) => router.push(e.target.value ? `/docs?ag=${e.target.value}` : "/docs")}>
      <option value="">ทุกแขวง</option>
      {W.agencies.map((a) => <option key={a.id} value={a.id}>{a.short_name || a.name}</option>)}
    </select>
  ) : null;
  const ordLabel = (o: Order) => {
    const A = W.agencies.find((a) => a.id === o.agency_id);
    return `${W.agencies.length > 1 && A ? (A.short_name || A.name) + " · " : ""}งวด ${o.round_no}/${o.fy}${o.hmd ? " · หมวด" + o.hmd : ""}`;
  };

  // ---------- ทะเบียนเอกสาร ----------
  if (tab === "list") {
    const L = [...docs].sort((a, b) => b.doc_date.localeCompare(a.doc_date) || b.no.localeCompare(a.no));
    return (
      <div className="ax"><div className="pg">
        <Top crumb={<>สำนักงาน › <b>เอกสาร</b></>} title="ทะเบียนเอกสาร" sub="เอกสารทุกใบทุกงวด ทุกแขวง" acts={tabs} />
        <div className="body"><div className="card">
          {L.length ? (
            <div className="tscroll"><table className="tb">
              <thead><tr><th>เลขที่</th><th>ประเภท</th><th>งวด / หมวด</th><th>อ้างอิงใบสั่งจ้าง</th><th>วันที่</th><th className="n">จำนวนเงิน</th><th>สถานะ</th></tr></thead>
              <tbody>
                {L.map((d) => {
                  const o = W.orders.find((x) => x.id === d.order_id);
                  return (
                    <tr key={d.id} className="click" onClick={() => router.push(`/docs/${d.id}`)}>
                      <td><Link href={`/docs/${d.id}`} onClick={(e) => e.stopPropagation()}><b>{d.no}</b></Link></td>
                      <td>{TITLE[d.kind]}</td>
                      <td className="small">{o ? ordLabel(o) : "–"}</td>
                      <td className="small muted">{o?.po_no || "–"}</td>
                      <td className="small">{dS(d.doc_date)}</td>
                      <td className="n num">{fmt2(d.total)}</td>
                      <td><Chip c={STL[d.status][1]}>{STL[d.status][0]}</Chip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          ) : <div className="emp">ยังไม่มีเอกสาร</div>}
        </div></div>
      </div></div>
    );
  }

  // ---------- ยังไม่มีงวด ----------
  if (!k) {
    const A = agSel ? W.agencies.find((a) => a.id === agSel) : null;
    return (
      <div className="ax"><div className="pg">
        <Top crumb={<>สำนักงาน › <b>เอกสาร</b></>} title="เอกสาร" sub="ทุกเอกสารอ้างอิงจากใบสั่งจ้างเท่านั้น" acts={<>{agPick}{tabs}</>} />
        <div className="body"><div className="card"><div className="emp big">
          <h3>{A ? (A.short_name || A.name) + " ยังไม่มีงวดงาน" : "ยังไม่มีงวดงาน"}</h3>
          <p>{A && W.orders.length ? "เปลี่ยนแขวงที่ช่องเลือกด้านบน หรือดูเอกสารทั้งหมดที่แท็บ ทะเบียนเอกสาร" : "สร้างงวดที่หน้า งาน ก่อน แล้วจึงออกเอกสาร"}</p>
        </div></div></div>
      </div></div>
    );
  }

  // ---------- บอร์ดตามหมวด ----------
  const back = `${path}?${rkQuery(k)}`;
  const xs = roundOf(W, k), slots = roundSlots(W, k), S3 = slots.length;
  const poI = xs.filter(hasPo), poVal = can.prices ? poI.reduce((s, o) => s + orderTotal(o), 0) : 0;
  const billed = docs.filter((d) => d.kind === "rc" && d.status === "issued" && xs.some((o) => o.id === d.order_id)).reduce((s, d) => s + d.total, 0);
  const todo = docTodos(W, wi, k, docs);
  const nd = (kd: DocKind) => xs.filter((o) => docsOf(docs, o, kd).length).length;

  const cell = (o: Order, kd: DocKind) => {
    const L = docsOf(docs, o, kd);
    if (!hasPo(o)) return <div className="dcell"><Chip c="nd">รอใบสั่งจ้าง</Chip></div>;
    if (L.length) return (
      <div className="dcell">
        {L.map((d) => (
          <Link key={d.id} className="dchip" href={`/docs/${d.id}`}>
            <Chip c={d.status === "issued" ? "g" : "b"}>{d.no}</Chip>
            <span className="muted small">{dS(d.doc_date)}{d.status === "draft" ? " · ร่าง" : ""}</span>
          </Link>
        ))}
      </div>
    );
    if (kd === "dl") {
      const pr = poRoutes(o), ok = pr.filter((r) => rInfo(W, wi, r).s === "done").length, ready = ok === pr.length && pr.length > 0;
      return (
        <div className="dcell">
          {can.dl ? <NewBtn kind="dl" o={o} back={back} label="ทำหนังสือส่งมอบ" cls={"btn sm" + (ready ? " pr" : "")} /> : <Chip c="nd">ยังไม่มี</Chip>}
          <span className="muted small">{ready ? "พร้อมแล้ว รูปครบทุกสาย" : `ตัดครบและรูปครบ ${ok}/${pr.length} สาย`}</span>
        </div>
      );
    }
    if (kd === "rc") {
      if (!can.rc) return <div className="dcell"><Chip c="nd">ยังไม่มี</Chip></div>;
      return (
        <div className="dcell">
          {docsOf(docs, o, "dl").length ? <NewBtn kind="rc" o={o} back={back} label="ออกใบกำกับ/ใบเสร็จ" cls="btn sm pr" />
            : <><Chip c="nd">รอส่งมอบ</Chip><NewBtn kind="rc" o={o} back={back} label="ออกก่อนได้" cls="lnk small" /></>}
        </div>
      );
    }
    return (
      <div className="dcell">
        {can.qt ? <NewBtn kind="qt" o={o} back={back} label="ทำใบเสนอราคา" cls="btn sm pr" /> : <Chip c="nd">ยังไม่มี</Chip>}
        <span className="muted small">ดึงสาย พื้นที่ ราคาจากใบสั่งจ้าง</span>
      </div>
    );
  };

  return (
    <div className="ax"><div className="pg">
      <Top
        crumb={<>สำนักงาน › <b>เอกสาร</b></>}
        title={`เอกสาร ${rkName(k)}`}
        sub="ทุกเอกสารอ้างอิงจากใบสั่งจ้างเท่านั้น สาย พื้นที่ และราคามาจากใบสั่งจ้าง"
        acts={<>{agPick}<RoundTabs W={W} wi={wi} k={k} onGo={(x) => router.push(q(x))} />{tabs}</>}
      />
      <div className="body">
        <div className="stats">
          <Stat l="ได้ใบสั่งจ้างแล้ว" v={poI.length} u={"/ " + S3 + " หมวด"} />
          <Stat l="มูลค่าตามใบสั่งจ้าง" v={can.prices ? fmt0(poVal) : "–"} u="บาท" s={poI.length && can.prices ? "รวม VAT" : undefined} />
          <Stat l="ออกใบกำกับภาษีแล้ว" v={fmt0(billed)} u="บาท" />
          <Stat l="รอดำเนินการ" v={todo.length} u="รายการ" />
        </div>
        <div className="card">
          <div className="tscroll"><table className="tb board">
            <thead><tr><th style={{ width: "15%" }}>หมวด</th><th>1. ใบสั่งจ้าง</th><th>2. ใบเสนอราคา</th><th>3. หนังสือส่งมอบ</th><th>4. ใบกำกับภาษี / ใบเสร็จ</th></tr></thead>
            <tbody>
              {slots.map(({ h, o }) => {
                if (!o) return (
                  <tr key={"s-" + h} className="slot">
                    <td><b>{h || "ไม่ระบุหมวด"}</b><div className="muted small">ยังไม่มีในงวดนี้</div></td>
                    <td><div className="dcell">
                      {can.orders ? <Link className="btn sm pr" href={`/orders/new?${rkQuery(k)}&hmd=${encodeURIComponent(h)}`}>+ อัปโหลดใบสั่งจ้าง</Link> : <Chip c="nd">ยังไม่มี</Chip>}
                      <span className="muted small">ระบบรู้หมวดจากแถวนี้</span>
                    </div></td>
                    <td colSpan={3}><div className="dcell">
                      <Chip c="nd">รอใบสั่งจ้าง</Chip>
                      {can.orders ? <button className="lnk small" type="button" onClick={() => setPlan(h)}>หรือเลือกสายจากทะเบียนก่อน</button> : null}
                    </div></td>
                  </tr>
                );
                const pics = o.routes.filter((r) => rInfo(W, wi, r).pics).length;
                const pr = poRoutes(o), area = pr.reduce((s, r) => s + r.area, 0), out = o.routes.filter((r) => r.in_po === false).length;
                return (
                  <tr key={o.id}>
                    <td><b>{o.hmd || "ไม่ระบุหมวด"}</b><div className="muted small">{o.routes.length} สาย · รูปครบ {pics}/{o.routes.length}</div></td>
                    <td>{hasPo(o) ? (
                      <div className="dcell">
                        <Link className="dchip" href={`/orders/${o.id}`}><Chip c="g">{o.po_no}</Chip></Link>
                        <span className="muted small">{fmt0(area)} ตร.ม.{can.prices ? ` · ${fmt0(orderTotal(o))} บาท` : ""}</span>
                        {out ? <span className="small" style={{ color: "var(--warn)" }}>{out} สายในแผนไม่อยู่ในใบสั่งจ้าง</span> : null}
                        <PackButton className="lnk small" orderIds={[o.id]} mode="pack" label="PDF ชุดส่งงวด" filename={`ชุดส่งงวด-${o.hmd || ""}-${rkName(k)}`} />
                      </div>
                    ) : (
                      <div className="dcell">
                        {can.orders ? <Link className="btn sm" href={`/orders/${o.id}`}>+ อัปโหลดใบสั่งจ้าง</Link> : <Chip c="nd">ยังไม่มี</Chip>}
                        <span className="muted small">ลูกค้ายังไม่ส่งมา</span>
                      </div>
                    )}</td>
                    <td>{cell(o, "qt")}</td>
                    <td>{cell(o, "dl")}</td>
                    <td>{cell(o, "rc")}</td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td><b>รวมงวด</b><div className="muted small">{S3} หมวด</div></td>
                <td><b>{poI.length}/{S3}</b>{can.prices ? <span className="muted small"> · {fmt0(poVal)} บาท</span> : null}</td>
                <td><b>{nd("qt")}/{S3}</b></td>
                <td><b>{nd("dl")}/{S3}</b></td>
                <td><b>{nd("rc")}/{S3}</b>{billed ? <span className="muted small"> · {fmt0(billed)} บาท</span> : null}</td>
              </tr>
            </tbody>
          </table></div>
        </div>
        <div className="hint">ⓘ อัปโหลดใบสั่งจ้างแล้ว AI จะอ่านและจับคู่กับสายในแผนให้ ถ้ามีสายที่ไม่ตรงกับแผนจะเตือนก่อนบันทึก</div>
      </div>
      {plan != null ? (
        <RoundDialog W={W} editK={k} initAg={k.ag} focusH={plan} onClose={() => setPlan(null)} onDone={() => { setPlan(null); router.refresh(); }} />
      ) : null}
    </div></div>
  );
}
