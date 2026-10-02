import { NextRequest } from "next/server";
import { apiError, json, requireOrigin, requireSession } from "@/lib/server/http";
import { SpotifyError } from "@/lib/server/spotify";
import { livePlayback, remoteControl } from "@/lib/server/live";
import type { PlaybackAction } from "@/lib/playback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { return json({ playback: await livePlayback(requireSession(request)) }); }
  catch (error) { return apiError(error, request); }
}

export async function POST(request: NextRequest) {
  try {
    requireOrigin(request);
    const session = requireSession(request);
    const body: unknown = await request.json().catch(() => null);
    const action = body && typeof body === "object" && "action" in body ? body.action : null;
    if (typeof action !== "string" || !["play", "pause", "previous", "next"].includes(action)) throw new SpotifyError(400, "INVALID_ACTION", "Choose play, pause, previous, or next.");
    await remoteControl(session, action as PlaybackAction);
    return json({ ok: true });
  } catch (error) { return apiError(error, request); }
}
