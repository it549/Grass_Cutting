// สถานะของสายทาง: ดูจากรูปก่อน/หลัง และการติ๊กเสร็จเอง
export type PhotoLite = { kind: "b" | "a" | string; taken_date: string | null };
export type RouteStatusLite = { done: boolean | null; done_date: string | null };
export const STATE_LABEL = ["ยังไม่เริ่ม", "กำลังทำ", "เสร็จ"] as const;

export function routeState(r: RouteStatusLite, photos: PhotoLite[]) {
  const b = photos.filter((x) => x.kind === "b").length;
  const a = photos.filter((x) => x.kind === "a").length;
  const done = r.done === true || (r.done !== false && b > 0 && a > 0);
  const lastA = photos.filter((x) => x.kind === "a" && x.taken_date).map((x) => x.taken_date as string).sort().pop();
  const firstB = photos.filter((x) => x.kind === "b" && x.taken_date).map((x) => x.taken_date as string).sort()[0];
  return {
    b,
    a,
    s: (done ? 2 : b + a ? 1 : 0) as 0 | 1 | 2,
    doneDate: r.done_date || (done ? lastA || "" : ""),
    startDate: firstB || "",
  };
}
