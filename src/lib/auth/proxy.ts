import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./jwt";

const PUBLIC_PATHS = ["/login", "/auth"];

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const signedIn = Boolean(token && (await verifySessionToken(token)));
  const path = request.nextUrl.pathname;

  if (!signedIn && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
