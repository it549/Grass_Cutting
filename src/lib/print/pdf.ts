// แปลงหน้ากระดาษเป็น PDF ในเบราว์เซอร์ (html2canvas + jsPDF โหลดเมื่อกดเท่านั้น)
export async function waitImgs(host: HTMLElement) {
  const urls = new Set<string>();
  host.querySelectorAll("img").forEach((i) => urls.add(i.src));
  host.querySelectorAll<HTMLElement>(".ph[style]").forEach((e) => {
    const m = /url\(["']?(.*?)["']?\)/.exec(e.style.backgroundImage);
    if (m) urls.add(m[1]);
  });
  await Promise.all([...urls].map((u) => new Promise((r) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = im.onerror = r; im.src = u; })));
}

export async function savePdf(build: (host: HTMLElement) => HTMLElement[] | Promise<HTMLElement[]>, filename: string, onProgress?: (s: string) => void) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-12000px;top:0;width:794px";
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    const pages = await build(host);
    await waitImgs(host);
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(`กำลังสร้าง PDF ${i + 1}/${pages.length}`);
      const cv = await html2canvas(pages[i], { scale: 2.4, useCORS: true, backgroundColor: "#ffffff", logging: false });
      if (i) pdf.addPage();
      pdf.addImage(cv.toDataURL("image/jpeg", 0.88), "JPEG", 0, 0, 210, 297);
      cv.width = cv.height = 0;
    }
    const blob = pdf.output("blob");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return pages.length;
  } finally {
    host.remove();
  }
}
