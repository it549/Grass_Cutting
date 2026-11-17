// อัปโหลดไฟล์จากเบราว์เซอร์ไปเก็บที่ local storage ของเซิร์ฟเวอร์ (แทนการอัปโหลดตรงไป Supabase Storage)
export async function uploadFile(path: string, blob: Blob): Promise<{ error?: string }> {
  const fd = new FormData();
  fd.set("path", path);
  fd.set("file", blob, "file");
  const res = await fetch("/api/files/upload", { method: "POST", body: fd });
  let json: { error?: string } = {};
  try {
    json = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok) return { error: json.error || "อัปโหลดไม่สำเร็จ" };
  return {};
}
