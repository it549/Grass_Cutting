import { redirect } from "next/navigation";

export const done = (path: string, msg: string, bad = false): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${bad ? "err" : "msg"}=${encodeURIComponent(msg)}`);
