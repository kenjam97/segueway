import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { spotifyConfig } from "./config";
import { cookieOptions, deleteSession, getSession, SESSION_COOKIE } from "./store";
import { SpotifyError } from "./spotify";

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", ...extra } });
}

export function requireSession(request: NextRequest) {
  const session = getSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw new SpotifyError(401, "REAUTHENTICATE", "Connect to Spotify to control playback.");
  return session;
}

export function requireOrigin(request: NextRequest) {
  if (request.headers.get("origin") !== spotifyConfig().origin) throw new SpotifyError(403, "INVALID_ORIGIN", "This request must come from the app.");
}

export function apiError(error: unknown, request: NextRequest) {
  const failure = error instanceof SpotifyError ? error : new SpotifyError(500, "INTERNAL_ERROR", "The app could not complete this request. Check the server configuration and try again.");
  const response = json({ error: { message: failure.message, code: failure.code, retryAfter: failure.retryAfter, quotaExceeded: failure.quotaExceeded } }, failure.status, failure.retryAfter ? { "Retry-After": String(failure.retryAfter) } : {});
  if (failure.status === 401) {
    deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
    response.cookies.set(SESSION_COOKIE, "", cookieOptions(request.nextUrl.protocol === "https:", 0));
  }
  return response;
}
