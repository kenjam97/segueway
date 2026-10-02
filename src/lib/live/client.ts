import type { LiveState } from "./machine";
import type { Event } from "@/lib/events/model";
import { PlayerError } from "@/lib/player-client";
import type { ApiErrorBody } from "@/lib/playback";

export interface ClientCommand {
  action: "start" | "cue" | "cancel" | "go_now" | "restart" | "skip" | "end" | "pause" | "play";
  event?: Event;
  section?: number;
  confirmed?: boolean;
}
async function call(init: RequestInit = {}): Promise<LiveState | null> {
  let response: Response;
  try { response = await fetch("/api/live", { ...init, credentials: "same-origin", cache: "no-store" }); }
  catch { throw new PlayerError(0, "NETWORK", "Connection to Segueway lost. The server may still be running playback; reconnect before sending another command."); }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new PlayerError(response.status, error?.code ?? "UNKNOWN", error?.message ?? "Live playback could not be read.", error?.retryAfter ?? 0);
  }
  return body.live;
}
export const liveClient = {
  read: () => call(),
  command: (command: ClientCommand, state: LiveState | null, requestId: string) => call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, requestId, runId: state?.runId, revision: state?.revision }) }),
};
