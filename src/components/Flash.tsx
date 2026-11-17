export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (err) return <p className="alert bad">{err}</p>;
  if (msg) return <p className="alert ok">{msg}</p>;
  return null;
}
