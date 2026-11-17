// อ่านวันที่ถ่ายจาก EXIF ของ JPEG และย่อรูปก่อนอัปโหลด (ทำในเบราว์เซอร์)
export async function exifDate(file: Blob): Promise<{ date: string; time: string } | null> {
  try {
    const buf = new DataView(await file.slice(0, 196608).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o < buf.byteLength - 4) {
      const mk = buf.getUint16(o), len = buf.getUint16(o + 2);
      if (mk === 0xffe1 && buf.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = buf.getUint16(t) === 0x4949;
        const u16 = (p: number) => buf.getUint16(t + p, le), u32 = (p: number) => buf.getUint32(t + p, le);
        const str = (p: number, n: number) => { let s = ""; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(buf.getUint8(t + p + i)); return s; };
        const ifd = (p: number) => {
          const n = u16(p), out: Record<number, { cnt: number; val: number }> = {};
          for (let i = 0; i < n; i++) { const e = p + 2 + i * 12; out[u16(e)] = { cnt: u32(e + 4), val: u32(e + 8) }; }
          return out;
        };
        const i0 = ifd(u32(4));
        let dt: string | null = null;
        if (i0[0x8769]) { const ex = ifd(i0[0x8769].val); if (ex[0x9003]) dt = str(ex[0x9003].val, ex[0x9003].cnt); }
        if (!dt && i0[0x0132]) dt = str(i0[0x0132].val, i0[0x0132].cnt);
        const m = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(dt || "");
        return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` } : null;
      }
      if ((mk & 0xff00) !== 0xff00) break;
      o += 2 + len;
    }
  } catch {}
  return null;
}

export async function shrink(file: Blob, max = 1600) {
  const bm = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bm.width, bm.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bm.width * k);
  cv.height = Math.round(bm.height * k);
  cv.getContext("2d")!.drawImage(bm, 0, 0, cv.width, cv.height);
  bm.close();
  const blob = await new Promise<Blob>((r, j) => cv.toBlob((b) => (b ? r(b) : j(new Error("ย่อรูปไม่สำเร็จ"))), "image/jpeg", 0.85));
  const w = cv.width, h = cv.height;
  cv.width = cv.height = 0;
  return { blob, w, h };
}
