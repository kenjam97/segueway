import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { spotifyConfig } from "@/lib/server/config";
import { consumeState, cookieOptions, createSession, deleteSession, SESSION_COOKIE, STATE_COOKIE } from "@/lib/server/store";
import { exchangeCode, SpotifyError } from "@/lib/server/spotify";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const config = spotifyConfig();
  const home = new URL("/", config.origin);
  let sessionId: string | undefined;
  try {
    const state = request.nextUrl.searchParams.get("state");
    const cookie = request.cookies.get(STATE_COOKIE)?.value;
    if (!state || !cookie || state.length > 128 || Buffer.byteLength(state) !== Buffer.byteLength(cookie) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie)) || !consumeState(state)) {
      home.searchParams.set("authError", "state");
    } else if (request.nextUrl.searchParams.has("error")) {
      home.searchParams.set("authError", "denied");
    } else {
      const code = request.nextUrl.searchParams.get("code");
      if (!code) throw new Error("Missing code");
      sessionId = createSession(await exchangeCode(code));
      deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
    }
  } catch (error) {
    home.searchParams.set("authError", error instanceof SpotifyError && error.status === 429 ? "rate" : "failed");
  }
  const response = NextResponse.redirect(home);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(STATE_COOKIE, "", cookieOptions(config.secure, 0));
  if (sessionId) response.cookies.set(SESSION_COOKIE, sessionId, cookieOptions(config.secure));
  return response;
}
