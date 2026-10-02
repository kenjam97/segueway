import { NextRequest } from "next/server";
import { apiError, json, requireOrigin, requireSession } from "@/lib/server/http";
import { liveCommand, liveSnapshot, migrateQueueGuard, type LiveCommand } from "@/lib/server/live";
import { parseLibrary } from "@/lib/events/storage";
import { SpotifyError } from "@/lib/server/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { const session = requireSession(request); await migrateQueueGuard(session); return json({ live: liveSnapshot(session) }); }
  catch (error) { return apiError(error, request); }
}
export async function POST(request: NextRequest) {
  try {
    requireOrigin(request);
    const session = requireSession(request);
    const raw = await request.text();
    if (raw.length > 500_000) throw new SpotifyError(413, "TOO_LARGE", "This event is too large for live mode.");
    const body = JSON.parse(raw) as LiveCommand;
    if (!body || typeof body !== "object" || typeof body.requestId !== "string" || body.requestId.length < 8 || body.requestId.length > 100 || !["start", "cue", "cancel", "go_now", "restart", "skip", "end", "pause", "play"].includes(body.action)) throw new SpotifyError(400, "INVALID_ACTION", "Choose a valid live action.");
    if (body.action === "start") {
      try {
        body.event = parseLibrary(JSON.stringify({ version: 1, events: [body.event], activeEventId: body.event?.id })).events[0];
        if (body.event.sections.length > 100 || body.event.sections.some(section => section.tracks.length > 500 || section.tracks.some(track => track.durationMs <= 0))) throw new Error("Invalid event size");
      } catch { throw new SpotifyError(400, "INVALID_EVENT", "This event contains invalid or excessive section/track data."); }
    }
    return json({ live: await liveCommand(session, body) });
  } catch (error) {
    return apiError(error instanceof SyntaxError ? new SpotifyError(400, "INVALID_JSON", "Send a valid live action.") : error, request);
  }
}
