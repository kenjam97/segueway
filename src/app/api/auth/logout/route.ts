import { NextRequest, NextResponse } from "next/server";
import { spotifyConfig } from "@/lib/server/config";
import { cookieOptions, deleteSession, SESSION_COOKIE } from "@/lib/server/store";
import { apiError, requireOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    requireOrigin(request);
    const config = spotifyConfig();
    deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
    const response = NextResponse.redirect(new URL("/", config.origin), 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(SESSION_COOKIE, "", cookieOptions(config.secure, 0));
    return response;
  } catch (error) { return apiError(error, request); }
}
