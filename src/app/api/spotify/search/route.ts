import { NextRequest } from "next/server";
import { apiError, json, requireSession } from "@/lib/server/http";
import { searchTracks, SpotifyError } from "@/lib/server/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const session = requireSession(request);
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const offsetValue = request.nextUrl.searchParams.get("offset") ?? "0";
    const offset = Number(offsetValue);
    if (!query || query.length > 200 || !/^\d+$/.test(offsetValue) || !Number.isInteger(offset) || offset < 0 || offset > 1000) throw new SpotifyError(400, "INVALID_SEARCH", "Enter a search of 1–200 characters and a valid result offset.");
    return json(await searchTracks(session, query, offset));
  } catch (error) { return apiError(error, request); }
}
