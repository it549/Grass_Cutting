// สร้างหน้ากระดาษ A4 (794×1123 px) เป็น DOM สำหรับดูตัวอย่างและแปลงเป็น PDF — ใช้ในเบราว์เซอร์เท่านั้น
import { num } from "@/lib/calc";
import { docTotals, itAmt, type DocData, type Head } from "@/lib/docs";
import { STATE_LABEL } from "@/lib/progress";
import { E, WD, bahtText, dL, dS, fmt, fmt0, fmtP, fmtQ, weekday } from "./fmt";

/** แปลงที่เก็บไฟล์ (เช่นโลโก้) เป็น URL ที่โหลดได้ */
let URLS: Record<string, string> = {};
export const registerUrls = (m: Record<string, string>) => { URLS = { ...URLS, ...m }; };
const logoOf = (h: Head) => (h.logo ? URLS[h.logo] || "" : "");

const PAGE_H = 1123;
const pageFits = (p: HTMLElement) => { const b = p.querySelector(".bzbody") as HTMLElement; return b.offsetTop + b.scrollHeight <= PAGE_H - 40 - 24; };

export function pgHead(h: Head, title: string, en: string, extra = "") {
  const lg = h.noLogo ? "" : logoOf(h);
  return `<div class="bzhead"><div class="bzco">${lg ? `<img src="${E(lg)}" alt="" crossorigin="anonymous">` : ""}<div><b>${E(h.name)}</b>${E(h.address)}${h.taxId ? `<br>เลขประจำตัวผู้เสียภาษี ${E(h.taxId)}${h.branch ? " · " + E(h.branch) : ""}` : ""}${h.phone || h.email ? `<br>${h.phone ? "โทร " + E(h.phone) : ""}${h.phone && h.email ? " · " : ""}${E(h.email || "")}` : ""}</div></div>
    <div class="bztitle"><h1>${E(title)}</h1><div class="en">${E(en)}</div>${extra}</div></div>`;
}
const signHtml = (sg: { label: string; name: string }[]) =>
  `<div class="bzsign">${(sg || []).map((s) => `<div><div class="ln"></div><div>(${s.name ? E(s.name) : "......................................"})</div><div>${E(s.label)}</div><div class="dt">วันที่ ......./......./.......</div></div>`).join("")}</div>`;

type PageOpts = { first: string; cont: string; thead?: string; rows: string[]; tail?: string; foot: string; cls?: string };
/** แบ่งหน้าอัตโนมัติ: หัวหน้าแรก, หัวหน้าต่อ, หัวตาราง, แถว, ส่วนท้าย */
export function paginate(host: HTMLElement, o: PageOpts) {
  const pages: HTMLElement[] = [];
  const np = (first: boolean) => {
    const p = document.createElement("div");
    p.className = "bzpage" + (o.cls ? " " + o.cls : "");
    p.innerHTML = `<div class="bzbody">${first ? o.first : o.cont}${o.thead || ""}</div><div class="bzfoot"></div>`;
    host.appendChild(p);
    pages.push(p);
    return p;
  };
  let p = np(true);
  const body = (q: HTMLElement) => (o.thead ? q.querySelector("tbody") : q.querySelector(".bzbody")) as HTMLElement;
  for (const r of o.rows) {
    const tb = body(p);
    tb.insertAdjacentHTML("beforeend", r);
    if (!pageFits(p) && tb.children.length > (o.thead ? 1 : 2)) {
      tb.lastElementChild?.remove();
      p = np(false);
      body(p).insertAdjacentHTML("beforeend", r);
    }
  }
  if (o.tail) {
    const add = (q: HTMLElement) => q.querySelector(".bzbody")!.insertAdjacentHTML("beforeend", `<div class="tail">${o.tail}</div>`);
    add(p);
    if (!pageFits(p)) {
      p.querySelector(".tail")?.remove();
      const tb = body(p);
      const moved: Element[] = [];
      while (o.thead && tb.children.length > 1 && moved.length < 2) { const l = tb.lastElementChild!; moved.unshift(l); l.remove(); }
      const q = np(false);
      moved.forEach((m) => body(q).appendChild(m));
      add(q);
    }
  }
  pages.forEach((x, i) => (x.querySelector(".bzfoot")!.textContent = `${o.foot} · หน้า ${i + 1}/${pages.length}`));
  return pages;
}

// ---------------- เอกสาร ----------------
const ITEM_HEAD = `<table class="bzitems"><colgroup><col style="width:7%"><col><col style="width:11%"><col style="width:10%"><col style="width:12%"><col style="width:15%"></colgroup><thead><tr><th>ลำดับ</th><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ราคาต่อหน่วย<br>(บาท)</th><th>จำนวนเงิน<br>(บาท)</th></tr></thead><tbody></tbody></table>`;

export function docPages(d: DocData, host: HTMLElement, copyLabel?: string) {
  if (d.layout === "letter") return letterPages(d, host, copyLabel);
  const t = docTotals(d), p = d.party || ({} as DocData["party"]);
  const cp = copyLabel ?? d.copy;
  const extra = `${cp ? `<span class="bzcopy">${E(cp)}</span>` : ""}${d.status === "void" ? `<span class="bzvoid">ยกเลิก</span>` : ""}`;
  const info = ([["เลขที่", d.no], [d.dateLabel || "วันที่", dS(d.date)], ...(d.info || [])] as [string, string][]).filter((x) => x[0] || x[1]);
  const first =
    pgHead(d.head, d.title, d.en, extra) +
    `<div class="bzparty"><div class="bzbox"><div class="lb">${E(p.label)}</div><b>${E(p.name)}</b>${p.address ? `<div>${E(p.address)}</div>` : ""}${p.phone ? `<div>โทรศัพท์ ${E(p.phone)}</div>` : ""}${p.tax ? `<div>เลขประจำตัวผู้เสียภาษี ${E(p.tax)}</div>` : ""}</div><div class="bzbox"><div class="bzkv">${info.map(([k, v]) => `<span>${E(k)}</span><b>${E(v)}</b>`).join("")}</div></div></div>` +
    (d.intro ? `<div class="bzpara">${E(d.intro)}</div>` : "") +
    (d.status === "void" && d.voidReason ? `<div class="bznote" style="color:#c0392b"><b>ยกเลิกเอกสาร:</b> ${E(d.voidReason)}</div>` : "");
  let n = 0;
  const rows = (d.items || []).map((it) => {
    const has = num(it.qty) || num(it.price);
    if (has) n++;
    return `<tr><td class="c">${has ? n : ""}</td><td>${E(it.desc)}</td><td class="n">${has ? fmtQ(it.qty) : ""}</td><td class="c">${has ? E(it.unit) : ""}</td><td class="n">${has ? fmtP(it.price) : ""}</td><td class="n">${has ? fmt(itAmt(it)) : ""}</td></tr>`;
  });
  rows.push(`<tr class="tt"><td></td><td>รวม</td><td class="n">${fmtQ((d.items || []).reduce((s, it) => s + num(it.qty), 0))}</td><td></td><td></td><td class="n">${fmt(t.sum)}</td></tr>`);
  const vi = d.vatIncl !== false;
  const tot: [string, number, string?][] = [
    ["รวมเป็นเงิน", t.sum],
    ...((vi ? [["มูลค่าก่อนภาษี", t.pre], ["ภาษีมูลค่าเพิ่ม 7%", t.vat]] : [["ภาษีมูลค่าเพิ่ม 7%", t.vat]]) as [string, number][]),
    ["จำนวนเงินรวมทั้งสิ้น", t.total, "g"],
    ...((num(d.wht) ? [[`หักภาษี ณ ที่จ่าย ${num(d.wht)}%`, -t.wht], ["ยอดชำระสุทธิ", t.net, "g"]] : []) as [string, number, string?][]),
  ];
  const tail = `<div class="bzsum"><div><div class="bzwords">(${E(d.words || bahtText(t.total))})</div>${(d.notes || []).filter((x) => x.h || x.t).map((x) => `<div class="bznote">${x.h ? `<b>${E(x.h)}</b>${/\n/.test(x.t || "") ? "\n" : " "}` : ""}${E(x.t)}</div>`).join("")}</div>
    <div class="bztot">${tot.map(([k, v, g]) => `<div class="${g || ""}"><span>${E(k)}</span><span>${v < 0 ? "−" + fmt(-v) : fmt(v)}</span></div>`).join("")}</div></div>${signHtml(d.sign)}`;
  return paginate(host, { first, cont: `<div class="bzcont">${E(d.title)} เลขที่ ${E(d.no)} (ต่อ)</div>`, thead: ITEM_HEAD, rows, tail, foot: `${d.title} ${d.no}` });
}

export function ltTok(s: string | undefined, d: DocData) {
  const t = docTotals(d), its = (d.items || []).filter((it) => num(it.qty) || num(it.price));
  return String(s || "")
    .replace(/\{จำนวนเงิน\}/g, fmt(t.total))
    .replace(/\{ตัวอักษร\}/g, d.words || bahtText(t.total))
    .replace(/\{จำนวนสาย\}/g, String(its.length))
    .replace(/\{พื้นที่\}/g, fmtQ(its.reduce((s2, it) => s2 + num(it.qty), 0)));
}

function letterPages(d: DocData, host: HTMLElement, copyLabel?: string) {
  const h = d.head, t = docTotals(d);
  const cp = copyLabel ?? d.copy;
  const lg = h.noLogo ? "" : logoOf(h);
  const head = `<div class="cthead"><div class="ctco">${lg ? `<img src="${E(lg)}" alt="" crossorigin="anonymous">` : ""}<div><b>${E(h.name)}</b>${E(h.address)}${h.taxId ? `<br>เลขประจำตัวผู้เสียภาษี ${E(h.taxId)}${h.branch ? " · " + E(h.branch) : ""}` : ""}${h.phone || h.email ? `<br>${h.phone ? "โทร " + E(h.phone) : ""}${h.phone && h.email ? " · " : ""}${E(h.email || "")}` : ""}</div></div>${cp ? `<div class="cp">${E(cp)}</div>` : ""}${d.status === "void" ? `<div class="cp">ยกเลิก</div>` : ""}</div>`;
  const kw = d.encl ? 118 : 72;
  const row = (k: string, v?: string) => (v ? `<div class="ltrow"><div class="ltk" style="min-width:${kw}px">${E(k)}</div><div class="ltv ltencl">${E(v)}</div></div>` : "");
  const first =
    head +
    `<div class="lttitle">${E(d.title)}</div>` +
    `<div class="ltno">ที่ ${E(d.no)}</div><div class="ltdate">${E(dL(d.date))}</div>` +
    `<div class="lthead">${row("เรื่อง", d.subject)}${row("เรียน", d.to)}${row("อ้างถึง", d.ref)}${row("สิ่งที่ส่งมาด้วย", d.encl)}</div>` +
    (d.status === "void" && d.voidReason ? `<div class="bznote" style="color:#c0392b"><b>ยกเลิกเอกสาร:</b> ${E(d.voidReason)}</div>` : "") +
    (d.p1 ? `<div class="ltp">${E(ltTok(d.p1, d))}</div>` : "");
  const tail =
    (d.p2 ? `<div class="ltp">${E(ltTok(d.p2, d))}</div>` : "") +
    (d.p3 ? `<div class="ltp">${E(ltTok(d.p3, d))}</div>` : "") +
    `<div class="ltsign"><div>${E(d.closing || "")}</div><div class="ltgap"></div><div>(${E(d.signName || "......................................")})</div><div>${E(d.signTitle || "")}</div></div>` +
    (d.contact && d.noContact !== true ? `<div class="ltcontact">${E(d.contact)}</div>` : "");
  const cont = `<div class="bzcont">${E(d.title)} ที่ ${E(d.no)} (ต่อ)</div>`;
  let pages: HTMLElement[];
  if (d.listStyle === "lines") {
    const lines = (d.items || []).filter((it) => String(it.desc || "").trim()).map((it) => `<div class="ltli2">${E(it.desc)}</div>`);
    pages = paginate(host, { first, cont, rows: lines, tail: `<div style="height:14px"></div>` + tail, foot: `${d.title} ที่ ${d.no}`, cls: "lt" });
  } else {
    const thead = `<table class="lttab"><colgroup><col style="width:8%"><col><col style="width:15%"><col style="width:11%"><col style="width:16%"></colgroup><thead><tr><th>ลำดับ</th><th>สายทาง</th><th>พื้นที่ (ตร.ม.)</th><th>ราคา/ตร.ม.</th><th>จำนวนเงิน (บาท)</th></tr></thead><tbody></tbody></table>`;
    let n = 0;
    const rows = (d.items || []).map((it) => {
      const has = num(it.qty) || num(it.price);
      if (has) n++;
      return `<tr><td class="c">${has ? n : ""}</td><td>${E(it.desc)}</td><td class="n">${has ? fmtQ(it.qty) : ""}</td><td class="n">${has ? fmtP(it.price) : ""}</td><td class="n">${has ? fmt(itAmt(it)) : ""}</td></tr>`;
    });
    rows.push(`<tr class="tt"><td></td><td>รวม ${n} สายทาง${d.vatIncl !== false ? " (รวมภาษีมูลค่าเพิ่มแล้ว)" : ""}</td><td class="n">${fmtQ((d.items || []).reduce((s, it) => s + num(it.qty), 0))}</td><td></td><td class="n">${fmt(d.vatIncl !== false ? t.sum : t.total)}</td></tr>`);
    pages = paginate(host, { first, cont, thead, rows, tail, foot: `${d.title} ที่ ${d.no}`, cls: "lt" });
  }
  pages.forEach((p, i) => { const c = p.querySelector(".bzcont"); if (c && i) c.textContent = `- ${i + 1} -`; });
  return pages;
}

// ---------------- รายงานภาพถ่าย / ใบสรุปงวด ----------------
export type PackPhoto = { url: string; kind: string; date: string | null; time: string | null; caption: string };
export type PackRoute = { id: string; code: string; descr: string; area: number; rate: number; s: 0 | 1 | 2; doneDate: string; startDate: string; photos: PackPhoto[] };
export type PackOrder = {
  id: string; label: string; round_no: number; hmd: string; po_no: string | null; po_date: string | null; proj_no: string | null;
  due_date: string | null; vat_incl: boolean; agencyName: string; agencyAddr: string; routes: PackRoute[];
};
export type PackCompany = { head: Head; signer: string; name: string };

export function routeReportPages(C: PackCompany, I: PackOrder, r: PackRoute, host: HTMLElement) {
  const bs = r.photos.filter((x) => x.kind === "b"), as = r.photos.filter((x) => x.kind === "a");
  const hm = I.hmd ? `<div>หมวดบำรุงทางหลวงชนบท${E(I.hmd)}</div>` : "";
  const first =
    pgHead(C.head, "รายงานภาพถ่าย", "Photo Report · Before / After") +
    `<div class="bzparty"><div class="bzbox"><div class="lb">สายทาง</div><b>สาย ${E(r.code)}</b><div>${E(r.descr)}</div>${hm}</div><div class="bzbox"><div class="bzkv"><span>งวดที่</span><b>${E(I.round_no)}</b><span>ใบสั่งจ้างเลขที่</span><b>${E(I.po_no || "")}</b><span>พื้นที่</span><b>${fmt0(r.area)} ตร.ม.</b><span>วันที่ดำเนินการ</span><b>${E(r.startDate && r.startDate !== r.doneDate ? dS(r.startDate) + " – " : "")}${E(dS(r.doneDate) || "–")}</b><span>ผู้รับจ้าง</span><b>${E(C.name)}</b></div></div></div>`;
  const cell = (p: PackPhoto | undefined, lab: string) =>
    p
      ? `<div><div class="ph" style="background-image:url('${E(p.url)}')"></div><div class="cap">${[lab, p.date ? dS(p.date) + (p.time ? " " + p.time + " น." : "") : "", p.caption || ""].filter(Boolean).map(E).join(" · ")}</div></div>`
      : `<div><div class="ph">ไม่มีรูป${lab}</div><div class="cap">&nbsp;</div></div>`;
  const rows: string[] = [];
  const n = Math.max(bs.length, as.length);
  for (let i = 0; i < n; i++) rows.push(`<div class="bzpairs"><div class="rh">ภาพที่ ${i + 1}</div>${cell(bs[i], "ก่อนดำเนินการ")}${cell(as[i], "หลังดำเนินการ")}</div>`);
  if (!n) rows.push(`<div class="bznote" style="text-align:center;padding:40px;color:#999">ยังไม่มีรูปถ่ายของสายนี้</div>`);
  return paginate(host, { first, cont: `<div class="bzcont">รายงานภาพถ่าย สาย ${E(r.code)} (ต่อ)</div>`, rows, foot: `รายงานภาพถ่าย สาย ${r.code} · ${I.label}` });
}

export function summaryPages(C: PackCompany, I: PackOrder, host: HTMLElement) {
  const rs = I.routes;
  const lineAmt = (r: PackRoute) => Math.round(r.area * r.rate * 100) / 100;
  const sum = rs.reduce((s, r) => s + lineAmt(r), 0), area = rs.reduce((s, r) => s + r.area, 0);
  const vi = I.vat_incl !== false;
  const total = vi ? sum : sum * 1.07, pre = vi ? sum / 1.07 : sum, vat = total - pre;
  const doneN = rs.filter((r) => r.s === 2).length, doneArea = rs.filter((r) => r.s === 2).reduce((s, r) => s + r.area, 0);
  const first =
    pgHead(C.head, "ใบสรุปผลการดำเนินงาน", "Installment Summary") +
    `<div class="bzparty"><div class="bzbox"><div class="lb">ผู้ว่าจ้าง</div><b>${E(I.agencyName)}</b><div>${E(I.agencyAddr)}</div></div><div class="bzbox"><div class="bzkv"><span>งวดที่</span><b>${E(I.round_no)}</b>${I.hmd ? `<span>หมวด</span><b>หมวดบำรุงทางหลวงชนบท${E(I.hmd)}</b>` : ""}<span>ใบสั่งจ้างเลขที่</span><b>${E(I.po_no || "–")}${I.po_date ? " ลงวันที่ " + E(dS(I.po_date)) : ""}</b><span>เลขที่โครงการ</span><b>${E(I.proj_no || "–")}</b><span>ครบกำหนดส่งมอบ</span><b>${E(dS(I.due_date) || "–")}</b><span>ผลงาน</span><b>เสร็จ ${doneN}/${rs.length} สาย · ${fmt0(doneArea)}/${fmt0(area)} ตร.ม.</b></div></div></div>`;
  const thead = `<table class="bzitems"><colgroup><col style="width:6%"><col style="width:12%"><col><col style="width:12%"><col style="width:13%"><col style="width:12%"><col style="width:9%"></colgroup><thead><tr><th>ลำดับ</th><th>สายทาง</th><th>รายการ</th><th>พื้นที่ (ตร.ม.)</th><th>จำนวนเงิน (บาท)</th><th>วันที่แล้วเสร็จ</th><th>สถานะ</th></tr></thead><tbody></tbody></table>`;
  const rows = rs.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${E(r.code)}</td><td>${E(r.descr)}</td><td class="n">${fmt0(r.area)}</td><td class="n">${fmt(lineAmt(r))}</td><td class="c">${E(dS(r.doneDate))}</td><td class="c">${STATE_LABEL[r.s]}</td></tr>`);
  rows.push(`<tr class="tt"><td></td><td colspan="2">รวมทั้งสิ้น ${rs.length} สายทาง</td><td class="n">${fmt0(area)}</td><td class="n">${fmt(sum)}</td><td colspan="2"></td></tr>`);
  const tail = `<div class="bzsum"><div><div class="bzwords">(${E(bahtText(total))})</div><div class="bznote">${vi ? "ราคารวมภาษีมูลค่าเพิ่มแล้ว" : "ราคายังไม่รวมภาษีมูลค่าเพิ่ม"}</div></div><div class="bztot"><div><span>มูลค่าก่อนภาษี</span><span>${fmt(pre)}</span></div><div><span>ภาษีมูลค่าเพิ่ม 7%</span><span>${fmt(vat)}</span></div><div class="g"><span>รวมทั้งสิ้น</span><span>${fmt(total)}</span></div></div></div>${signHtml([{ label: "ผู้ควบคุมงาน", name: "" }, { label: "ผู้รับจ้าง", name: C.signer }])}`;
  return paginate(host, { first, cont: `<div class="bzcont">ใบสรุปผลการดำเนินงาน ${E(I.label)} (ต่อ)</div>`, thead, rows, tail, foot: `ใบสรุปผลการดำเนินงาน ${I.label}` });
}

// ---------------- ใบสำคัญจ่ายค่าแรง ----------------
export type CrewDay = { id?: string; name: string; wage: number; ot: number; on: boolean };
export type VoucherDay = { date: string; crew: CrewDay[] };
export function voucherPages(C: PackCompany, week: string[], logs: VoucherDay[], jobs: string, host: HTMLElement) {
  const per: Record<string, { name: string; days: Record<string, number>; amt: number; n: number }> = {};
  for (const d of week) {
    const r = logs.find((x) => x.date === d);
    if (!r) continue;
    for (const c of r.crew || []) if (c.on) {
      const k = c.id || c.name;
      const p = (per[k] = per[k] || { name: c.name, days: {}, amt: 0, n: 0 });
      p.days[d] = num(c.wage) + num(c.ot);
      p.amt += p.days[d];
      p.n++;
    }
  }
  const ps = Object.values(per), tot = ps.reduce((s, p) => s + p.amt, 0);
  const dnum = (d: string) => +d.slice(8, 10);
  const first =
    pgHead(C.head, "ใบสำคัญจ่ายค่าแรงรายวัน", "Daily Wage Payment Voucher") +
    `<div class="bzparty"><div class="bzbox"><div class="lb">งาน</div><b>จ้างเหมาบริการงานตัดหญ้า</b><div>${E(jobs)}</div></div><div class="bzbox"><div class="bzkv"><span>ช่วงวันที่</span><b>${E(dS(week[0]))} – ${E(dS(week[6]))}</b><span>จำนวนคน-วัน</span><b>${ps.reduce((s, p) => s + p.n, 0)}</b></div></div></div>`;
  const thead = `<table class="bzitems"><colgroup><col style="width:6%"><col>${week.map(() => `<col style="width:6.5%">`).join("")}<col style="width:6%"><col style="width:12%"><col style="width:15%"></colgroup><thead><tr><th>ลำดับ</th><th>ชื่อ-สกุล</th>${week.map((d) => `<th>${WD[weekday(d)]}<br>${dnum(d)}</th>`).join("")}<th>วัน</th><th>จำนวนเงิน</th><th>ลายมือชื่อผู้รับเงิน</th></tr></thead><tbody></tbody></table>`;
  const rows = ps.map((p, i) => `<tr style="height:34px"><td class="c">${i + 1}</td><td>${E(p.name)}</td>${week.map((d) => `<td class="c">${p.days[d] != null ? fmt0(p.days[d]) : ""}</td>`).join("")}<td class="c">${p.n}</td><td class="n">${fmt(p.amt)}</td><td></td></tr>`);
  const dayTot = (d: string) => ps.reduce((s, p) => s + (p.days[d] || 0), 0);
  rows.push(`<tr class="tt"><td></td><td>รวม</td>${week.map((d) => `<td class="c">${dayTot(d) ? fmt0(dayTot(d)) : ""}</td>`).join("")}<td class="c">${ps.reduce((s, p) => s + p.n, 0)}</td><td class="n">${fmt(tot)}</td><td></td></tr>`);
  const tail = `<div class="bzwords">(${E(bahtText(tot))})</div>${signHtml([{ label: "ผู้จ่ายเงิน", name: "" }, { label: "ผู้อนุมัติ", name: C.signer }])}`;
  return paginate(host, { first, cont: `<div class="bzcont">ใบสำคัญจ่ายค่าแรง (ต่อ)</div>`, thead, rows, tail, foot: `ใบสำคัญจ่ายค่าแรง ${dS(week[0])} – ${dS(week[6])}` });
}
