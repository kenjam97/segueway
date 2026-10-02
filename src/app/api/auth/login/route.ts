import { NextRequest, NextResponse } from "next/server";
import { spotifyConfig } from "@/lib/server/config";
import { cookieOptions, createState, SCOPES, STATE_COOKIE } from "@/lib/server/store";
import { apiError } from "@/lib/server/http";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const config = spotifyConfig();
    // Canonicalize before setting cookies so callback and login use the same host.
    // NextRequest also normalizes loopback URLs; the Host header preserves the browser host.
    const actualHost = request.headers.get("host") ?? new URL(request.url).host;
    if (actualHost !== new URL(config.origin).host) return NextResponse.redirect(new URL("/api/auth/login", config.origin));
    const state = createState();
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri, scope: SCOPES.join(" "), state }).toString();
    const response = NextResponse.redirect(url);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(STATE_COOKIE, state, cookieOptions(config.secure, 600));
    return response;
  } catch (error) { return apiError(error, request); }
}
