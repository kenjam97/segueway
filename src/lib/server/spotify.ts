import "server-only";
import type { Playback, PlaybackAction } from "@/lib/playback";
import type { Track } from "@/lib/events/model";
import { spotifyConfig } from "./config";
import { SCOPES, store, type Session, type Tokens } from "./store";

export class SpotifyError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number, public quotaExceeded = false) { super(message); }
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope?: string }
interface SpotifyPlayback {
  is_playing: boolean;
  progress_ms: number | null;
  timestamp?: number;
  repeat_state?: string;
  shuffle_state?: boolean;
  device: { id?: string | null; name: string; type: string; is_restricted: boolean } | null;
  item: { id?: string; uri?: string; type: string; name: string; duration_ms: number; artists?: { name: string }[]; album?: { images: { url: string }[] }; external_urls?: { spotify?: string } } | null;
  actions?: { disallows?: Playback["disallowed"] };
}

async function fetchSpotify(url: string, init: RequestInit) {
  try { return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(10_000) }); }
  catch { throw new SpotifyError(503, "UNAVAILABLE", "Spotify could not be reached. Please try again."); }
}

function checkCooldown() {
  if (store.cooldownUntil > Date.now()) throw new SpotifyError(429, store.quotaExceeded ? "QUOTA_EXCEEDED" : "RATE_LIMITED", store.quotaExceeded ? "Spotify's development quota is exhausted. Try again later." : "Spotify needs a short break. Controls will return after the cooldown.", Math.ceil((store.cooldownUntil - Date.now()) / 1000), store.quotaExceeded);
}

async function responseError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null);
  if (response.status === 429) {
    const quota = body?.error?.reason === "QUOTA_EXCEEDED";
    const raw = response.headers.get("Retry-After");
    const seconds = raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw ? (Date.parse(raw) - Date.now()) / 1000 : NaN;
    const retryAfter = Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : quota ? 3600 : 60;
    store.cooldownUntil = Math.max(store.cooldownUntil, Date.now() + retryAfter * 1000);
    store.quotaExceeded = quota;
    throw new SpotifyError(429, quota ? "QUOTA_EXCEEDED" : "RATE_LIMITED", quota ? "Spotify's development quota is exhausted. Try again later." : "Spotify is rate limiting requests. Please wait before trying again.", retryAfter, quota);
  }
  if (body?.error === "invalid_grant" || response.status === 401) throw new SpotifyError(401, "REAUTHENTICATE", "Your Spotify session expired or was revoked. Connect again.");
  if (response.status === 403) throw new SpotifyError(403, "FORBIDDEN", "Spotify refused this request. Check Premium, the app's user allowlist, and playback permissions or device restrictions.");
  if (response.status === 404) throw new SpotifyError(404, "NO_DEVICE", "No active Spotify device. Open Spotify, choose a device, and start a track.");
  throw new SpotifyError(502, "SPOTIFY_ERROR", "Spotify could not complete this request. Please try again.");
}

async function tokenRequest(params: URLSearchParams): Promise<TokenResponse> {
  checkCooldown();
  const { clientId, clientSecret } = spotifyConfig();
  const response = await fetchSpotify("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params,
  });
  if (!response.ok) return responseError(response);
  const body: TokenResponse = await response.json();
  if (!body.access_token || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new SpotifyError(502, "INVALID_RESPONSE", "Spotify returned an invalid token response.");
  if (body.scope !== undefined && SCOPES.some(scope => !body.scope!.split(" ").includes(scope))) throw new SpotifyError(401, "MISSING_SCOPES", "Spotify playback permissions were not granted. Connect again.");
  return body;
}

export async function exchangeCode(code: string): Promise<Tokens> {
  const body = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: spotifyConfig().redirectUri }));
  if (!body.refresh_token) throw new SpotifyError(502, "INVALID_RESPONSE", "Spotify did not return a refresh token. Connect again.");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + body.expires_in * 1000 };
}

async function refresh(session: Session, rejectedToken?: string) {
  // Another request may already have refreshed the rejected access token.
  if (rejectedToken && session.tokens.accessToken !== rejectedToken) return;
  if (session.refresh) return session.refresh;
  session.refresh = (async () => {
    const body = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.tokens.refreshToken }));
    session.tokens = { accessToken: body.access_token, refreshToken: body.refresh_token ?? session.tokens.refreshToken, expiresAt: Date.now() + body.expires_in * 1000 };
  })();
  try { await session.refresh; } finally { session.refresh = undefined; }
}

async function request<T>(session: Session, path: string, method = "GET", body?: unknown): Promise<T | null> {
  checkCooldown();
  if (session.tokens.expiresAt <= Date.now() + 30_000) await refresh(session);
  const token = session.tokens.accessToken;
  const send = (accessToken: string) => fetchSpotify(`https://api.spotify.com/v1${path}`, { method, headers: { Authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let response = await send(token);
  if (response.status === 401) { await refresh(session, token); response = await send(session.tokens.accessToken); }
  if (!response.ok) return responseError(response);
  // Playback commands only need confirmation of success. Spotify can return an
  // empty 200 as well as 204; attempting JSON parsing would falsely report failure.
  if (method !== "GET" || response.status === 204) return null;
  return await response.json() as T;
}

export async function getPlayback(session: Session): Promise<Playback | null> {
  const state = await request<SpotifyPlayback>(session, "/me/player");
  if (!state) return null;
  const track = state.item?.type === "track" ? state.item : null;
  return {
    isPlaying: state.is_playing, progressMs: state.progress_ms ?? 0, observedAt: Date.now(),
    timestamp: state.timestamp, repeatState: state.repeat_state, shuffleState: state.shuffle_state,
    progressAvailable: state.progress_ms !== null && Number.isFinite(state.progress_ms),
    device: state.device ? { id: state.device.id, name: state.device.name, type: state.device.type, restricted: state.device.is_restricted } : null,
    track: track ? { uri: track.uri, spotifyId: track.id, name: track.name, artist: track.artists?.map(a => a.name).join(", ") || "Unknown artist", artwork: track.album?.images[0]?.url ?? null, durationMs: track.duration_ms, url: track.external_urls?.spotify ?? null } : null,
    disallowed: state.actions?.disallows ?? {},
  };
}

export async function controlPlayback(session: Session, action: PlaybackAction) {
  return serializeCommand(session, () => request(session, `/me/player/${action}`, action === "next" || action === "previous" ? "POST" : "PUT"));
}

async function serializeCommand(session: Session, command: () => Promise<unknown>) {
  const previous = session.commands ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => { await command(); });
  session.commands = current;
  try { await current; } finally { if (session.commands === current) session.commands = undefined; }
}

export async function startTrack(session: Session, deviceId: string, uri: string) {
  await serializeCommand(session, () => request(session, `/me/player/play?${new URLSearchParams({ device_id: deviceId })}`, "PUT", { uris: [uri], position_ms: 0 }));
}

export async function prepareLiveDevice(session: Session, deviceId: string) {
  const query = new URLSearchParams({ device_id: deviceId });
  await serializeCommand(session, async () => {
    await request(session, `/me/player/repeat?${query}&state=off`, "PUT");
    await request(session, `/me/player/shuffle?${query}&state=false`, "PUT");
  });
  const playback = await getPlayback(session);
  if (playback?.device?.id !== deviceId || playback.device.restricted || playback.repeatState !== "off" || playback.shuffleState !== false) throw new SpotifyError(409, "DEVICE_NOT_READY", "Choose an unrestricted Spotify device and turn repeat and shuffle off, then try again.");
  return playback;
}

interface SearchTrack {
  id: string; uri: string; name: string; artists: { name: string }[];
  album: { name: string; images: { url: string }[] }; duration_ms: number;
}
export async function searchTracks(session: Session, query: string, offset = 0): Promise<{ tracks: Track[]; nextOffset: number | null }> {
  const params = new URLSearchParams({ q: query, type: "track", limit: "10", offset: String(offset) });
  const response = await request<{ tracks: { items: (SearchTrack | null)[]; next: string | null } }>(session, `/search?${params}`);
  if (!response?.tracks || !Array.isArray(response.tracks.items)) throw new SpotifyError(502, "INVALID_RESPONSE", "Spotify returned an invalid search response. Try again.");
  return {
    tracks: response.tracks.items.filter((track): track is SearchTrack => !!track?.id && !!track.uri).map(track => ({
      spotifyId: track.id, uri: track.uri, name: track.name, artists: track.artists.map(artist => artist.name),
      albumName: track.album.name, artwork: track.album.images[0]?.url ?? null, durationMs: track.duration_ms,
    })),
    nextOffset: response.tracks.next && offset + 10 <= 1000 ? offset + 10 : null,
  };
}
