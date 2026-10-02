import "server-only";
import { randomUUID } from "node:crypto";
import type { Event } from "@/lib/events/model";
import type { PlaybackAction } from "@/lib/playback";
import { createLiveState, LEGACY_QUEUE_ERROR, liveReducer, observationDelay, type LiveState } from "@/lib/live/machine";
import { controlPlayback, getPlayback, prepareLiveDevice, SpotifyError, startTrack } from "./spotify";
import { store, type Session } from "./store";

interface Run { owner: Session; state: LiveState; timer?: ReturnType<typeof setTimeout>; queueGuardMigrated?: boolean }
interface Runtime { run: Run | null; serial: Promise<unknown>; requests: Map<string, { owner: Session; state: LiveState | null }> }
const globals = globalThis as typeof globalThis & { seguewayLive?: Runtime };
const runtime = globals.seguewayLive ??= { run: null, serial: Promise.resolve(), requests: new Map() };
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = runtime.serial.catch(() => {}).then(work);
  runtime.serial = next.catch(() => {});
  return next;
}
function clearExpiredRun() {
  const run = runtime.run;
  if (run && (run.owner.expiresAt <= Date.now() || !Array.from(store.sessions.values()).includes(run.owner))) {
    if (run.timer) clearTimeout(run.timer);
    runtime.run = null;
  }
}
function log(stage: string, state: LiveState, extra: unknown = {}) {
  if (process.env.NODE_ENV === "development" && process.env.SEGUEWAY_LIVE_DEBUG === "1") console.info("[segueway:live]", { stage, runId: state.runId, occurrence: state.cursor.occurrence, at: Date.now(), ...extra as object });
}
function update(run: Run, state: LiveState) {
  const previous = run.state;
  run.state = state;
  if (state.endCandidate && !previous.endCandidate) log("completion-candidate", state, { firstStoppedObservedAt: state.endCandidate.firstObservedAt, expectedEnd: state.endCandidate.expectedEnd, progressMs: state.observation?.progressMs, timestamp: state.observation?.timestamp });
  if (previous.endCandidate && ["transitioning", "section_complete"].includes(state.phase)) log("reset-completion-confirmed", state, { firstStoppedObservedAt: previous.endCandidate.firstObservedAt, confirmedAt: state.observation?.observedAt, expectedEnd: previous.endCandidate.expectedEnd });
  if (state.expectedEnd !== null && (previous.expectedEnd === null || Math.abs(state.expectedEnd - previous.expectedEnd) > 2000)) log("expected-end", state, { expectedEnd: state.expectedEnd });
  if (state.pending?.completionObservedAt && state.pending.completionObservedAt !== previous.pending?.completionObservedAt) log("completion-observed", state, { expectedEnd: state.pending.expectedEnd, completionObservedAt: state.pending.completionObservedAt });
  if (state.phase === "section_complete" && ["playing", "next_section_queued"].includes(previous.phase)) log("completion-observed", state, { expectedEnd: previous.expectedEnd, completionObservedAt: state.observation?.observedAt });
  if (state.transitionTiming && state.transitionTiming !== previous.transitionTiming) log("next-track-confirmed", state, state.transitionTiming);
  if (state.phase === "recovery" && previous.phase !== "recovery") log("recovery", state, { reason: state.message });
}
function failure(run: Run, error: unknown) {
  const retryAt = error instanceof SpotifyError && error.retryAfter ? Date.now() + error.retryAfter * 1000 : undefined;
  update(run, liveReducer(run.state, { type: "failure", message: error instanceof Error ? error.message : "Spotify could not be reconciled. Inspect playback before recovering.", retryAt }));
}
async function issue(run: Run) {
  clearExpiredRun();
  if (runtime.run !== run) return;
  if (run.state.phase !== "transitioning" || !run.state.pending || run.state.pending.issuedAt !== null) return;
  const target = run.state.pending.target;
  update(run, liveReducer(run.state, { type: "issued", now: Date.now() }));
  log("playback-command-issued", run.state, { target, expectedEnd: run.state.pending?.expectedEnd, completionObservedAt: run.state.pending?.completionObservedAt });
  try { await startTrack(run.owner, run.state.deviceId, run.state.event.sections[target.section].tracks[target.track].uri); }
  catch (error) { failure(run, error); }
  // An accepted command or network timeout is reconciled by reads, never retried.
}
async function observe(run: Run) {
  try {
    update(run, liveReducer(run.state, { type: "observe", playback: await getPlayback(run.owner), now: Date.now() }));
    await issue(run);
  } catch (error) { failure(run, error); }
}
function schedule(run: Run) {
  if (run.timer) clearTimeout(run.timer);
  if (runtime.run !== run) return;
  const delay = Math.max(750, observationDelay(run.state, Date.now()), store.cooldownUntil - Date.now());
  run.timer = setTimeout(() => {
    void exclusive(async () => {
      if (runtime.run !== run) return;
      if (run.owner.expiresAt <= Date.now() || !Array.from(store.sessions.values()).includes(run.owner)) {
        runtime.run = null;
        log("session-ended", run.state);
        return;
      }
      await observe(run);
      schedule(run);
    });
  }, delay);
  run.timer.unref();
}
export function liveSnapshot(owner: Session): LiveState | null {
  clearExpiredRun();
  if (!runtime.run) return null;
  if (runtime.run.owner !== owner) throw new SpotifyError(409, "LIVE_BUSY", "Another Spotify session owns live playback. End that run before starting another.");
  return runtime.run.state;
}
export async function migrateQueueGuard(owner: Session) {
  const previous = runtime.run;
  if (!previous || previous.owner !== owner || previous.queueGuardMigrated || previous.state.message !== LEGACY_QUEUE_ERROR) return;
  await exclusive(async () => {
    if (runtime.run !== previous || previous.queueGuardMigrated) return;
    if (previous.timer) clearTimeout(previous.timer);
    // Replace the run wrapper so old hot-reload timer closures cannot retain it.
    const run: Run = { owner, state: previous.state, queueGuardMigrated: true };
    runtime.run = run;
    await observe(run);
    schedule(run);
  });
}
export async function livePlayback(owner: Session) {
  clearExpiredRun();
  return runtime.run?.owner === owner ? runtime.run.state.observation : getPlayback(owner);
}
export interface LiveCommand {
  requestId: string;
  runId?: string;
  revision?: number;
  action: "start" | "cue" | "cancel" | "go_now" | "restart" | "skip" | "end" | "pause" | "play";
  event?: Event;
  section?: number;
  confirmed?: boolean;
}
export async function liveCommand(owner: Session, command: LiveCommand): Promise<LiveState | null> {
  return exclusive(async () => {
    clearExpiredRun();
    const cached = runtime.requests.get(command.requestId);
    if (cached) {
      if (cached.owner !== owner) throw new SpotifyError(409, "REQUEST_CONFLICT", "This request belongs to another session.");
      return runtime.run?.owner === owner ? runtime.run.state : cached.state;
    }
    const existing = runtime.run;
    if (existing && existing.owner !== owner) throw new SpotifyError(409, "LIVE_BUSY", "Another session owns live playback.");
    if (command.action === "start") {
      if (existing) throw new SpotifyError(409, "LIVE_BUSY", "End the current run before starting another.");
      if (!command.confirmed || !command.event || !Number.isInteger(command.section) || !command.event.sections[command.section!]?.tracks.length) throw new SpotifyError(400, "INVALID_START", "Choose a section with tracks and confirm the Spotify preparation checklist.");
      const playback = await getPlayback(owner);
      if (!playback?.device?.id) throw new SpotifyError(409, "NO_DEVICE", "Spotify has not reported an active device. In Spotify, select this computer and play a track briefly, then pause it and try Start section again. Use the same Spotify account connected to Segueway.");
      if (playback.device.restricted) throw new SpotifyError(409, "RESTRICTED_DEVICE", "Spotify reports that this device does not allow API playback controls. Choose a different device in Spotify, play a track briefly, then try again.");
      const ready = await prepareLiveDevice(owner, playback.device.id);
      const run: Run = { owner, state: createLiveState(structuredClone(command.event), command.section!, ready, randomUUID()) };
      runtime.run = run;
      await issue(run);
      schedule(run);
    } else {
      if (!existing || existing.state.runId !== command.runId || existing.state.revision !== command.revision) throw new SpotifyError(409, "STALE_LIVE_STATE", "Live playback changed. Review the latest state before trying again.");
      if (command.action === "end") {
        if (existing.timer) clearTimeout(existing.timer);
        runtime.run = null;
      } else if (command.action === "pause" || command.action === "play") {
        if (!["playing", "next_section_queued"].includes(existing.state.phase)) throw new SpotifyError(409, "LIVE_TRANSITION", "Wait for playback confirmation before using pause or resume.");
        update(existing, liveReducer(existing.state, { type: "transport", paused: command.action === "pause" }));
        try { await controlPlayback(owner, command.action); await observe(existing); } catch (error) { failure(existing, error); }
        schedule(existing);
      } else {
        if (["go_now", "restart", "skip"].includes(command.action) && !command.confirmed) throw new SpotifyError(400, "CONFIRM_REQUIRED", "Confirm this immediate playback change.");
        if (command.action === "restart" || command.action === "skip") {
          // Check whether an uncertain start already took effect before replaying.
          await observe(existing);
          if (existing.state.phase === "recovery") {
            try { await prepareLiveDevice(owner, existing.state.deviceId); }
            catch (error) { failure(existing, error); schedule(existing); return existing.state; }
          }
        }
        update(existing, liveReducer(existing.state, { type: command.action }));
        await issue(existing);
        schedule(existing);
      }
    }
    const result = runtime.run?.state ?? null;
    runtime.requests.set(command.requestId, { owner, state: result });
    if (runtime.requests.size > 200) runtime.requests.delete(runtime.requests.keys().next().value!);
    return result;
  });
}

// Existing remote controls keep their behavior. Skips explicitly relinquish
// automation; pause/resume share the runner lock and preserve a queued section.
export async function remoteControl(owner: Session, action: PlaybackAction) {
  return exclusive(async () => {
    clearExpiredRun();
    const run = runtime.run;
    if (run && run.owner !== owner) throw new SpotifyError(409, "LIVE_BUSY", "Another session owns live playback.");
    if (run) {
      if (run.state.phase === "transitioning") throw new SpotifyError(409, "LIVE_TRANSITION", "Wait for live playback confirmation.");
      if (action === "previous" || action === "next") update(run, liveReducer(run.state, { type: "suspend", message: "A manual skip suspended live automation. Inspect Spotify and recover explicitly." }));
      else update(run, liveReducer(run.state, { type: "transport", paused: action === "pause" }));
    }
    try { await controlPlayback(owner, action); if (run) await observe(run); }
    catch (error) { if (run) { failure(run, error); schedule(run); } throw error; }
    if (run) schedule(run);
  });
}
