// สร้างหน้ากระดาษ A4 (794×1123 px) เป็น DOM สำหรับดูตัวอย่างและแปลงเป็น PDF — ใช้ในเบราว์เซอร์เท่านั้น
import { num } from "@/lib/calc";
import { docTotals, itAmt, type DocData, type Head } from "@/lib/docs";
import { PF, R_ST, kmTxt, stations, type PfKind, type RInfo } from "@/lib/model";
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

/** ตัดบรรทัดเฉพาะที่ช่องว่าง (แบบหนังสือราชการ) ไม่ตัดกลางคำ/กลางจำนวนเงิน · keep = วลีที่ต้องอยู่บรรทัดเดียวกัน (รับ HTML ที่ escape แล้ว) */
const ltNb = (s: string, keep: string[] = []) => {
  for (const k of [...keep, "ด้วย จักขอบคุณยิ่ง"]) if (k && /\s/.test(k)) s = s.split(k).join(k.replace(/\s+/g, "\u0001"));
  return s.split(/(\s+)/).map((w) => (/\S/.test(w) ? `<span class="nw">${w.replace(/\u0001/g, " ")}</span>` : w)).join("");
};
/** แก้ "แยกแยก" ในเอกสารเก่าที่สร้างก่อนแก้ชื่อสาย */
const noDup = (s: string) => s.replace(/แยก\s*แยก/g, "แยก");
const FITS = ["", " fit1", " fit2", " fit3", " fit3 fit4", " fit3 fit4 fit5"];
const ltPageNo = (pages: HTMLElement[]) => pages.forEach((p, i) => { p.classList.add("lt"); const c = p.querySelector(".bzcont"); if (c && i) c.textContent = `- ${i + 1} -`; });

function letterPages(d: DocData, host: HTMLElement, copyLabel?: string) {
  const h = d.head, t = docTotals(d);
  const cp = copyLabel ?? d.copy;
  const lg = h.noLogo ? "" : logoOf(h);
  const nb = (x: string) => ltNb(E(ltTok(x, d)), [E(h.name)]);
  const head = `<div class="cthead"><div class="ctco">${lg ? `<img src="${E(lg)}" alt="" crossorigin="anonymous">` : ""}<div><b>${E(h.name)}</b>${E(h.address)}${h.taxId ? `<br>เลขประจำตัวผู้เสียภาษี ${E(h.taxId)}${h.branch ? " · " + E(h.branch) : ""}` : ""}${h.phone || h.email ? `<br>${h.phone ? "โทร " + E(h.phone) : ""}${h.phone && h.email ? " · " : ""}${E(h.email || "")}` : ""}</div></div>${cp ? `<div class="cp">${E(cp)}</div>` : ""}${d.status === "void" ? `<div class="cp">ยกเลิก</div>` : ""}</div>`;
  const kw = d.encl ? 118 : 72;
  const row = (k: string, v?: string) => (v ? `<div class="ltrow"><div class="ltk" style="min-width:${kw}px">${E(k)}</div><div class="ltv ltencl">${E(v)}</div></div>` : "");
  const first =
    head +
    `<div class="lttitle">${E(d.title)}</div>` +
    `<div class="ltno">ที่ ${E(d.no)}</div><div class="ltdate">${E(dL(d.date))}</div>` +
    `<div class="lthead">${row("เรื่อง", d.subject)}${row("เรียน", d.to)}${row("อ้างถึง", d.ref)}${row("สิ่งที่ส่งมาด้วย", d.encl)}</div>` +
    (d.status === "void" && d.voidReason ? `<div class="bznote" style="color:#c0392b"><b>ยกเลิกเอกสาร:</b> ${E(d.voidReason)}</div>` : "") +
    (d.p1 ? `<div class="ltp">${nb(d.p1)}</div>` : "");
  const tail =
    (d.p2 ? `<div class="ltp">${nb(d.p2)}</div>` : "") +
    (d.p3 ? `<div class="ltp">${nb(d.p3)}</div>` : "") +
    `<div class="ltsign"><div>${E(d.closing || "")}</div><div class="ltgap"></div><div>(${E(d.signName || "......................................")})</div><div>${E(d.signTitle || "")}</div></div>` +
    (d.contact && d.noContact !== true ? `<div class="ltcontact">${E(d.contact)}</div>` : "");
  const cont = `<div class="bzcont">${E(d.title)} ที่ ${E(d.no)} (ต่อ)</div>`;
  const foot = `${d.title} ที่ ${d.no}`;
  if (d.listStyle === "lines") {
    const lines = (d.items || [])
      .filter((it) => String(it.desc || "").trim())
      .map((it, i, a) => `<div class="ltli2">${a.length > 1 ? `<span class="ltn">${i + 1}.</span>` : ""}<span>${ltNb(E(noDup(String(it.desc).trim().replace(/^\d+[.)]\s*/, ""))))}</span></div>`);
    // ย่อให้อยู่หน้าเดียวเมื่อทำได้: ลองระดับกระชับขึ้นทีละขั้น (ตัวอักษรรายการไม่ต่ำกว่า 13px ≈ 14pt TH Sarabun)
    let pg: HTMLElement[] = [];
    for (const fit of FITS) {
      pg.forEach((x) => x.remove());
      pg = paginate(host, { first, cont, rows: lines, tail: `<div style="height:14px"></div>` + tail, foot, cls: "lt" + fit });
      if (pg.length === 1 || d.noFit) break;
    }
    ltPageNo(pg);
    return pg;
  }
  const thead = `<table class="lttab"><colgroup><col style="width:8%"><col><col style="width:15%"><col style="width:11%"><col style="width:16%"></colgroup><thead><tr><th>ลำดับ</th><th>สายทาง</th><th>พื้นที่ (ตร.ม.)</th><th>ราคา/ตร.ม.</th><th>จำนวนเงิน (บาท)</th></tr></thead><tbody></tbody></table>`;
  let n = 0;
  const rows = (d.items || []).map((it) => {
    const has = num(it.qty) || num(it.price);
    if (has) n++;
    return `<tr><td class="c">${has ? n : ""}</td><td>${E(noDup(it.desc))}</td><td class="n">${has ? fmtQ(it.qty) : ""}</td><td class="n">${has ? fmtP(it.price) : ""}</td><td class="n">${has ? fmt(itAmt(it)) : ""}</td></tr>`;
  });
  rows.push(`<tr class="tt"><td></td><td>รวม ${n} สายทาง${d.vatIncl !== false ? " (รวมภาษีมูลค่าเพิ่มแล้ว)" : ""}</td><td class="n">${fmtQ((d.items || []).reduce((s, it) => s + num(it.qty), 0))}</td><td></td><td class="n">${fmt(d.vatIncl !== false ? t.sum : t.total)}</td></tr>`);
  const pages = paginate(host, { first, cont, thead, rows, tail, foot, cls: "lt" });
  ltPageNo(pages);
  return pages;
}

// ---------------- รายงานภาพถ่าย / ใบสรุปงวด ----------------
export type PackPhoto = { url: string; kind: string; date: string | null; time: string | null; caption: string };
export type PackRoute = {
  id: string; code: string; descr: string; area: number; rate: number; in_po: boolean; s: RInfo["s"]; doneDate: string; startDate: string; photos: PackPhoto[];
  /** ความยาวสาย (กม.) · URL รูปตามช่อง "b|500" · แขวงต้องใช้แบบสำรวจซ้าย/ขวา */
  L: number; slotUrl: Record<string, string>; lrNeed: boolean;
};
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
  const rs = I.routes.filter((r) => r.in_po); // ใบสรุปงวดนับเฉพาะสายที่อยู่ในใบสั่งจ้าง
  const lineAmt = (r: PackRoute) => Math.round(r.area * r.rate * 100) / 100;
  const sum = rs.reduce((s, r) => s + lineAmt(r), 0), area = rs.reduce((s, r) => s + r.area, 0);
  const vi = I.vat_incl !== false;
  const total = vi ? sum : sum * 1.07, pre = vi ? sum / 1.07 : sum, vat = total - pre;
  const doneN = rs.filter((r) => r.s === "done").length, doneArea = rs.filter((r) => r.s === "done").reduce((s, r) => s + r.area, 0);
  const first =
    pgHead(C.head, "ใบสรุปผลการดำเนินงาน", "Installment Summary") +
    `<div class="bzparty"><div class="bzbox"><div class="lb">ผู้ว่าจ้าง</div><b>${E(I.agencyName)}</b><div>${E(I.agencyAddr)}</div></div><div class="bzbox"><div class="bzkv"><span>งวดที่</span><b>${E(I.round_no)}</b>${I.hmd ? `<span>หมวด</span><b>หมวดบำรุงทางหลวงชนบท${E(I.hmd)}</b>` : ""}<span>ใบสั่งจ้างเลขที่</span><b>${E(I.po_no || "–")}${I.po_date ? " ลงวันที่ " + E(dS(I.po_date)) : ""}</b><span>เลขที่โครงการ</span><b>${E(I.proj_no || "–")}</b><span>ครบกำหนดส่งมอบ</span><b>${E(dS(I.due_date) || "–")}</b><span>ผลงาน</span><b>เสร็จ ${doneN}/${rs.length} สาย · ${fmt0(doneArea)}/${fmt0(area)} ตร.ม.</b></div></div></div>`;
  const thead = `<table class="bzitems"><colgroup><col style="width:6%"><col style="width:12%"><col><col style="width:12%"><col style="width:13%"><col style="width:12%"><col style="width:9%"></colgroup><thead><tr><th>ลำดับ</th><th>สายทาง</th><th>รายการ</th><th>พื้นที่ (ตร.ม.)</th><th>จำนวนเงิน (บาท)</th><th>วันที่แล้วเสร็จ</th><th>สถานะ</th></tr></thead><tbody></tbody></table>`;
  const rows = rs.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${E(r.code)}</td><td>${E(r.descr)}</td><td class="n">${fmt0(r.area)}</td><td class="n">${fmt(lineAmt(r))}</td><td class="c">${E(dS(r.doneDate))}</td><td class="c">${R_ST[r.s][0]}</td></tr>`);
  rows.push(`<tr class="tt"><td></td><td colspan="2">รวมทั้งสิ้น ${rs.length} สายทาง</td><td class="n">${fmt0(area)}</td><td class="n">${fmt(sum)}</td><td colspan="2"></td></tr>`);
  const tail = `<div class="bzsum"><div><div class="bzwords">(${E(bahtText(total))})</div><div class="bznote">${vi ? "ราคารวมภาษีมูลค่าเพิ่มแล้ว" : "ราคายังไม่รวมภาษีมูลค่าเพิ่ม"}</div></div><div class="bztot"><div><span>มูลค่าก่อนภาษี</span><span>${fmt(pre)}</span></div><div><span>ภาษีมูลค่าเพิ่ม 7%</span><span>${fmt(vat)}</span></div><div class="g"><span>รวมทั้งสิ้น</span><span>${fmt(total)}</span></div></div></div>${signHtml([{ label: "ผู้ควบคุมงาน", name: "" }, { label: "ผู้รับจ้าง", name: C.signer }])}`;
  return paginate(host, { first, cont: `<div class="bzcont">ใบสรุปผลการดำเนินงาน ${E(I.label)} (ต่อ)</div>`, thead, rows, tail, foot: `ใบสรุปผลการดำเนินงาน ${I.label}` });
}

// ---------------- รูปรายงานตาม กม. ตามแบบฟอร์มของหน่วยงาน (v34) ----------------
/** ba = ใบรายงานผลก่อน/หลัง ทุก 500 ม. (หน้าแรก 3 แถว ต่อไป 4) · lr = แบบสำรวจซ้าย/ขวา ทุก 250 ม. (4 แถว) */
export function pfPages(r: { code: string; descr: string; area: number }, f: PfKind, L: number, slotUrl: Record<string, string>, host: HTMLElement) {
  const F = PF[f], ps = stations(L, F.step), pages: HTMLElement[] = [];
  const name = `${E(r.code)}  ${E(r.descr || "")}`;
  const box = (k: string, cap: string) => { const u = slotUrl[k]; return `<div class="pfc"><div class="pfph"${u ? ` style="background-image:url('${E(u)}')"` : ""}></div><div class="pfk">${cap}</div></div>`; };
  const row = (m: number) => `<div class="pfr">${F.cols.map(([c]) => box(c + "|" + m, (f === "ba" ? "กม. ที่ " : "") + kmTxt(m))).join("")}</div>`;
  const heads = `<div class="pfr pfh">${F.cols.map(([, t]) => `<div><span>${t}</span></div>`).join("")}</div>`;
  const per = 4, first = f === "ba" ? 3 : 4;
  let i = 0, n = 0;
  while (i < ps.length || n === 0) {
    const take = n === 0 ? first : per, chunk = ps.slice(i, i + take);
    i += take;
    const p = document.createElement("div");
    p.className = "bzpage pf pf-" + f;
    const top = n > 0 ? "" : f === "ba"
      ? `<div class="pft">ใบรายงานผลการดำเนินงานจ้างเหมาบริการตัดหญ้า</div><div class="pfl"><span>สายทาง</span><u>${name}</u></div><div class="pfl"><span>พื้นที่ดำเนินการ</span><u class="c">${num(r.area) ? fmt0(num(r.area)) : ""}</u><span>ตร.ม.</span></div>`
      : `<div class="pft">แบบฟอร์มรูปถ่ายการสำรวจงานตัดหญ้า ทุก 250 เมตร<small>แบบฟอร์มตัดหญ้า 3</small></div><div class="pfl"><span>ชื่อสายทาง</span><u>${name}</u></div>`;
    p.innerHTML = f === "ba" ? `<div class="pfbox">${top}${heads}${chunk.map(row).join("")}</div>` : `${top}<div class="pfbox">${heads}${chunk.map(row).join("")}</div>`;
    host.appendChild(p);
    pages.push(p);
    n++;
    if (!ps.length) break;
  }
  return pages;
}
/** รายงานรูปของสาย: รู้ความยาวสาย = แบบฟอร์มตาม กม. (ก่อน/หลัง + ซ้าย/ขวา ถ้าแขวงต้องใช้หรือมีรูป) · ไม่รู้ = รายงานภาพถ่ายแบบเดิม */
export function routePhotoPages(C: PackCompany, I: PackOrder, r: PackRoute, host: HTMLElement) {
  if (!(r.L > 0)) return routeReportPages(C, I, r, host);
  const out = pfPages(r, "ba", r.L, r.slotUrl, host);
  if (r.lrNeed || Object.keys(r.slotUrl).some((k) => /^[LR]\|/.test(k))) out.push(...pfPages(r, "lr", r.L, r.slotUrl, host));
  return out;
}

// ---------------- ใบสำคัญจ่ายค่าแรง (แบบเดียวกับระบบบน claude.ai) ----------------
type VDay = { on: boolean; half?: boolean; wage?: number | null; ot?: number | null };
export type VoucherRow = {
  cid: string; name: string; nick?: string; payText?: string; days: Record<string, VDay>; units: number; gross: number; ot: number; ded: number; net: number; left: number;
  paid: { pay_date: string; method?: string } | null;
};
const vPay = (c: VDay | undefined) => (c && c.on ? (c.half ? num(c.wage) / 2 : num(c.wage)) + num(c.ot) : 0);
const vUnits = (n: number) => { const f = Math.floor(n), h = n - f >= 0.5; return (f || !h ? String(f) : "") + (h ? "½" : ""); };
const PAYBY_T: Record<string, string> = { cash: "เงินสด", pp: "พร้อมเพย์", bank: "โอนเข้าบัญชี" };

/** ใบสำคัญจ่ายค่าแรงรวมทั้งสัปดาห์ (คนละแถว ให้เซ็นรับเงิน) */
export function voucherPages(C: PackCompany, wk: string[], rows0: VoucherRow[], jobs: string, host: HTMLElement) {
  const P = rows0.filter((p) => p.units || p.ot), showSun = P.some((p) => p.days[wk[6]]), days = showSun ? wk : wk.slice(0, 6);
  const tot = (f: (p: VoucherRow) => number) => P.reduce((s, p) => s + f(p), 0);
  const dn = (d: string) => +d.slice(8, 10);
  const first = pgHead(C.head, "ใบสำคัญจ่ายค่าแรงรายวัน", "Daily Wage Payment Voucher") +
    `<div class="bzparty"><div class="bzbox"><div class="lb">งาน</div><b>จ้างเหมาบริการงานตัดหญ้า</b><div>${E(jobs)}</div></div><div class="bzbox"><div class="bzkv"><span>ช่วงวันที่</span><b>${E(dS(wk[0]))} – ${E(dS(days[days.length - 1]))}</b><span>จำนวนคน-วัน</span><b>${vUnits(tot((p) => p.units))}</b></div></div></div>`;
  const thead = `<table class="bzitems"><colgroup><col style="width:4%"><col>${days.map(() => `<col style="width:${showSun ? 5.8 : 6.6}%">`).join("")}<col style="width:4.5%"><col style="width:9.5%"><col style="width:8%"><col style="width:9.5%"><col style="width:11%"></colgroup><thead><tr><th>ที่</th><th>ชื่อ-สกุล</th>${days.map((d) => `<th>${WD[weekday(d)]}<br>${dn(d)}</th>`).join("")}<th>วัน</th><th>ค่าแรง+OT</th><th>หักเบิก</th><th>รับสุทธิ</th><th>ลายมือชื่อผู้รับเงิน</th></tr></thead><tbody></tbody></table>`;
  const cell = (c: VDay | undefined) => (!c ? "" : fmt0(vPay(c)) + (c.half ? "<br><small>(½)</small>" : ""));
  const rows = P.map((p, i) => `<tr style="height:36px"><td class="c">${i + 1}</td><td>${E(p.name)}</td>${days.map((d) => `<td class="c" style="font-size:11.5px;padding-left:1px;padding-right:1px">${cell(p.days[d])}</td>`).join("")}<td class="c">${vUnits(p.units)}</td><td class="n">${fmt(p.gross + p.ot)}</td><td class="n">${p.ded ? fmt(p.ded) : ""}</td><td class="n">${fmt(p.net)}</td><td></td></tr>`);
  rows.push(`<tr class="tt"><td></td><td>รวม</td>${days.map((d) => { const s = P.reduce((t, p) => t + vPay(p.days[d]), 0); return `<td class="c" style="font-size:11px;padding-left:1px;padding-right:1px">${s ? fmt0(s) : ""}</td>`; }).join("")}<td class="c">${vUnits(tot((p) => p.units))}</td><td class="n">${fmt(tot((p) => p.gross + p.ot))}</td><td class="n">${tot((p) => p.ded) ? fmt(tot((p) => p.ded)) : ""}</td><td class="n">${fmt(tot((p) => p.net))}</td><td></td></tr>`);
  const tail = `<div class="bzwords">(${E(bahtText(tot((p) => p.net)))})</div>${signHtml([{ label: "ผู้จ่ายเงิน", name: "" }, { label: "ผู้อนุมัติ", name: C.signer }])}`;
  return paginate(host, { first, cont: `<div class="bzcont">ใบสำคัญจ่ายค่าแรง (ต่อ)</div>`, thead, rows, tail, foot: `ใบสำคัญจ่ายค่าแรง ${dS(wk[0])} – ${dS(days[days.length - 1])}` });
}

/** ใบสำคัญจ่ายแยกรายคน (คนละหน้า) */
export function voucherEach(C: PackCompany, wk: string[], rows0: VoucherRow[], host: HTMLElement) {
  const out: HTMLElement[] = [];
  for (const p of rows0.filter((x) => x.units || x.ot)) {
    const ds = wk.filter((d) => p.days[d]);
    const how = p.paid?.method ? PAYBY_T[p.paid.method] + (p.paid.method !== "cash" && p.payText && !/^เงินสด/.test(p.payText) ? " " + p.payText.replace(/^พร้อมเพย์ /, "") : "") : p.payText || "เงินสด";
    const first = pgHead(C.head, "ใบสำคัญจ่ายค่าแรง", "Wage Payment Voucher") +
      `<div class="bzparty"><div class="bzbox"><div class="lb">ผู้รับเงิน</div><b>${E(p.name)}</b>${p.nick ? `<div>(${E(p.nick)})</div>` : ""}<div>รับเงินทาง ${E(how)}</div></div><div class="bzbox"><div class="bzkv"><span>ช่วงวันที่</span><b>${E(dS(wk[0]))} – ${E(dS(wk[5]))}</b><span>วันที่จ่าย</span><b>${E(p.paid ? dS(p.paid.pay_date) : "")}</b><span>จำนวนวัน</span><b>${vUnits(p.units)}</b></div></div></div>`;
    const thead = `<table class="bzitems"><colgroup><col style="width:8%"><col><col style="width:16%"><col style="width:16%"><col style="width:18%"></colgroup><thead><tr><th>ลำดับ</th><th>วันที่</th><th>มาทำงาน</th><th>OT/เบี้ยเลี้ยง</th><th>จำนวนเงิน</th></tr></thead><tbody></tbody></table>`;
    const rows = ds.map((d, i) => { const c = p.days[d]; return `<tr><td class="c">${i + 1}</td><td>${E(WD[weekday(d)] + " " + dS(d))}</td><td class="c">${c.half ? "ครึ่งวัน" : "เต็มวัน"}</td><td class="n">${num(c.ot) ? fmt(c.ot) : ""}</td><td class="n">${fmt(vPay(c))}</td></tr>`; });
    rows.push(`<tr class="tt"><td></td><td>รวมค่าแรง + OT</td><td class="c">${vUnits(p.units)} วัน</td><td class="n">${p.ot ? fmt(p.ot) : ""}</td><td class="n">${fmt(p.gross + p.ot)}</td></tr>`);
    if (p.ded) rows.push(`<tr><td></td><td>หักเงินเบิกล่วงหน้า</td><td></td><td></td><td class="n">−${fmt(p.ded)}</td></tr>`);
    rows.push(`<tr class="tt"><td></td><td>รับสุทธิ</td><td></td><td></td><td class="n">${fmt(p.net)}</td></tr>`);
    const tail = `<div class="bzwords">(${E(bahtText(p.net))})</div>${p.left > 0 ? `<div class="bznote">เงินเบิกคงค้างยกไปหักครั้งถัดไป ${fmt(p.left)} บาท</div>` : ""}${signHtml([{ label: "ผู้รับเงิน", name: p.name }, { label: "ผู้จ่ายเงิน", name: "" }])}`;
    out.push(...paginate(host, { first, cont: `<div class="bzcont">ใบสำคัญจ่ายค่าแรง ${E(p.name)} (ต่อ)</div>`, thead, rows, tail, foot: `ใบสำคัญจ่ายค่าแรง ${p.name} · ${dS(wk[0])} – ${dS(wk[5])}` }));
  }
  return out;
}

// ---------------- ทะเบียนคนงาน ----------------
export type CrewPrint = { name: string; nick: string; role: string; phone: string; wage: number | null; payText: string; active: boolean };
export function crewPages(C: PackCompany, L: CrewPrint[], today: string, host: HTMLElement) {
  const act = L.filter((c) => c.active);
  const first = pgHead(C.head, "ทะเบียนคนงาน", "Worker Register") +
    `<div class="bzparty"><div class="bzbox"><div class="lb">งาน</div><b>จ้างเหมาบริการงานตัดหญ้า</b><div>ข้อมูล ณ วันที่ ${E(dS(today))}</div></div><div class="bzbox"><div class="bzkv"><span>ทำงานอยู่</span><b>${act.length} คน</b><span>พักงาน</span><b>${L.length - act.length} คน</b><span>ค่าแรงรวม/วัน</span><b>${fmt0(act.reduce((s, c) => s + num(c.wage), 0))} บาท</b></div></div></div>`;
  const thead = `<table class="bzitems"><colgroup><col style="width:5%"><col style="width:22%"><col style="width:9%"><col style="width:11%"><col style="width:12%"><col style="width:9%"><col style="width:22%"><col style="width:10%"></colgroup><thead><tr><th>ที่</th><th>ชื่อ-สกุล</th><th>ชื่อเล่น</th><th>ตำแหน่ง</th><th>โทร</th><th>ค่าแรง/วัน</th><th>รับเงินทาง</th><th>สถานะ</th></tr></thead><tbody></tbody></table>`;
  const rows = L.map((c, i) => `<tr style="height:32px${c.active ? "" : ";color:#888"}"><td class="c">${i + 1}</td><td>${E(c.name)}</td><td>${E(c.nick)}</td><td>${E(c.role)}</td><td>${E(c.phone)}</td><td class="n">${fmt0(c.wage)}</td><td style="font-size:12px">${E(c.payText)}</td><td class="c">${c.active ? "ทำงาน" : "พักงาน"}</td></tr>`);
  return paginate(host, { first, cont: `<div class="bzcont">ทะเบียนคนงาน (ต่อ)</div>`, thead, rows, tail: "", foot: `ทะเบียนคนงาน ${dS(today)}` });
}
