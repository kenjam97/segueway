import type { ApiErrorBody, Playback, PlaybackAction } from "./playback";

export class PlayerError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter = 0, public quotaExceeded = false) { super(message); }
}

async function call<T>(init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch("/api/playback", { ...init, cache: "no-store", credentials: "same-origin" }); }
  catch { throw new PlayerError(0, "NETWORK", "Connection lost. Check your network and try again."); }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new PlayerError(response.status, error?.code ?? "UNKNOWN", error?.message ?? "Something went wrong. Please try again.", error?.retryAfter ?? 0, error?.quotaExceeded ?? false);
  }
  return body as T;
}

export const playerClient = {
  async read() { return (await call<{ playback: Playback | null }>()).playback; },
  async control(action: PlaybackAction) {
    await call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
  },
};
