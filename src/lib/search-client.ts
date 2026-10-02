import type { Track } from "./events/model";
import type { ApiErrorBody } from "./playback";

export class SearchError extends Error {
  constructor(public status: number, message: string, public retryAfter = 0, public quotaExceeded = false) { super(message); }
}
export async function searchSpotify(query: string, offset: number, signal: AbortSignal): Promise<{ tracks: Track[]; nextOffset: number | null }> {
  let response: Response;
  try { response = await fetch(`/api/spotify/search?${new URLSearchParams({ q: query, offset: String(offset) })}`, { signal, cache: "no-store", credentials: "same-origin" }); }
  catch (error) { if (signal.aborted) throw error; throw new SearchError(0, "Spotify search could not be reached. Check your connection and retry."); }
  const body = await response.json();
  if (!response.ok) {
    const failure = (body as ApiErrorBody).error;
    throw new SearchError(response.status, failure?.message ?? "Search failed. Try again.", failure?.retryAfter, failure?.quotaExceeded);
  }
  return body;
}
