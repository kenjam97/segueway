import type { Event, SectionTrack } from "@/lib/events/model";
import type { Playback } from "@/lib/playback";

export type LivePhase = "idle" | "playing" | "next_section_queued" | "transitioning" | "section_complete" | "recovery";
export const LEGACY_QUEUE_ERROR = "Spotify still reports upcoming tracks after the single-track start. Pause Spotify, clear manually queued tracks, then restart the track explicitly. Segueway cannot remove queue items.";
export interface Cursor { section: number; track: number; occurrence: number }
export interface PendingStart {
  target: Cursor;
  issuedAt: number | null;
  previousTimestamp: number | null;
  expectedEnd: number | null;
  completionObservedAt: number | null;
  cueAfterStart: number | null;
}
export interface LiveState {
  runId: string;
  revision: number;
  event: Event;
  phase: LivePhase;
  cursor: Cursor;
  deviceId: string;
  cue: number | null;
  observation: Playback | null;
  expectedEnd: number | null;
  burstStartedAt: number | null;
  pending: PendingStart | null;
  message: string | null;
  retryAt: number | null;
  pauseRequested: boolean;
  endCandidate?: { firstObservedAt: number; expectedEnd: number; timestamp: number | undefined } | null;
  inferenceBlockedUntil?: number | null;
  transitionTiming: { expectedEnd: number | null; completionObservedAt: number | null; commandIssuedAt: number; confirmedAt: number; approximateGapMs: number | null } | null;
}
export type LiveAction =
  | { type: "observe"; playback: Playback | null; now: number }
  | { type: "cue" | "cancel" | "go_now" | "restart" | "skip" }
  | { type: "issued"; now: number }
  | { type: "transport"; paused: boolean }
  | { type: "failure"; message: string; retryAt?: number }
  | { type: "suspend"; message: string };

export const currentTrack = (state: LiveState): SectionTrack => state.event.sections[state.cursor.section].tracks[state.cursor.track];
export const nextSection = (state: LiveState) => state.event.sections[state.cursor.section + 1];
const change = (state: LiveState, patch: Partial<LiveState>): LiveState => ({ ...state, ...patch, revision: state.revision + 1 });
const recover = (state: LiveState, message: string) => state.phase === "recovery" && state.message === message ? state : change(state, { phase: "recovery", message, cue: state.cue ?? state.pending?.cueAfterStart ?? null, expectedEnd: null, burstStartedAt: null, endCandidate: null });

function transition(state: LiveState, section: number, track: number, completedAt: number | null = null, cueAfterStart: number | null = null): LiveState {
  return change(state, {
    phase: "transitioning", cue: null, message: null, retryAt: null,
    pending: { target: { section, track, occurrence: state.cursor.occurrence + 1 }, issuedAt: null, previousTimestamp: state.observation?.timestamp ?? null, expectedEnd: state.expectedEnd, completionObservedAt: completedAt, cueAfterStart },
    expectedEnd: null, burstStartedAt: null, pauseRequested: false, endCandidate: null, inferenceBlockedUntil: null,
  });
}

function finishTrack(state: LiveState, firstObservedAt: number): LiveState {
  if (state.cue !== null) return transition(state, state.cue, 0, firstObservedAt);
  const section = state.event.sections[state.cursor.section];
  if (state.cursor.track + 1 < section.tracks.length) return transition(state, state.cursor.section, state.cursor.track + 1, firstObservedAt);
  if (section.playbackMode === "loop") return transition(state, state.cursor.section, 0, firstObservedAt);
  return finishOnceSection(state);
}

function finishOnceSection(state: LiveState): LiveState {
  return change(state, { phase: "section_complete", pending: null, cue: null, expectedEnd: null, burstStartedAt: null, endCandidate: null, retryAt: null });
}

export function createLiveState(event: Event, section: number, playback: Playback, runId: string): LiveState {
  if (!playback.device?.id || playback.device.restricted || !event.sections[section]?.tracks.length) throw new Error("A playable section and active device are required.");
  const state: LiveState = {
    runId, revision: 0, event, phase: "idle", cursor: { section, track: 0, occurrence: 0 }, deviceId: playback.device.id,
    cue: null, observation: playback, expectedEnd: null, burstStartedAt: null, pending: null, message: null, retryAt: null, pauseRequested: false, transitionTiming: null,
  };
  return transition(state, section, 0);
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  if (action.type === "failure") return { ...recover(state, action.message), retryAt: action.retryAt ?? null };
  if (action.type === "suspend") return recover({ ...state, pending: null }, action.message);
  if (action.type === "transport") return { ...state, pauseRequested: action.paused, expectedEnd: null, burstStartedAt: null, endCandidate: null };
  if (action.type === "issued") return state.pending && state.pending.issuedAt === null ? { ...state, pending: { ...state.pending, issuedAt: action.now } } : state;
  if (action.type === "cue") {
    if (state.phase !== "playing" || !nextSection(state)?.tracks.length) return state;
    return change(state, { phase: "next_section_queued", cue: state.cursor.section + 1 });
  }
  if (action.type === "cancel") {
    // A committed transition owns its destination. Late cancellation cannot undo it.
    if (state.phase === "recovery" && state.cue !== null) return change(state, { cue: null, pending: state.pending ? { ...state.pending, cueAfterStart: null } : null });
    return state.phase === "next_section_queued" ? change(state, { phase: "playing", cue: null }) : state;
  }
  if (action.type === "go_now") {
    if (!["playing", "next_section_queued", "section_complete"].includes(state.phase) || !nextSection(state)?.tracks.length) return state;
    return transition(state, state.cursor.section + 1, 0);
  }
  if (action.type === "restart") return state.phase === "recovery" ? transition(state, state.pending?.target.section ?? state.cursor.section, state.pending?.target.track ?? state.cursor.track, null, state.cue ?? state.pending?.cueAfterStart ?? null) : state;
  if (action.type === "skip") {
    if (state.phase !== "recovery") return state;
    const cursor = state.pending?.target ?? state.cursor;
    const section = state.event.sections[cursor.section];
    if (state.cue !== null) return transition(state, state.cue, 0);
    if (cursor.track + 1 < section.tracks.length) return transition(state, cursor.section, cursor.track + 1);
    if (section.playbackMode === "loop") return transition(state, cursor.section, 0);
    return finishOnceSection({ ...state, cursor, pending: null, cue: null, message: null, endCandidate: null });
  }

  if (action.type !== "observe") return state;
  const playback = action.playback;
  const previous = state.observation;
  state = { ...state, observation: playback };
  if (!playback?.device?.id || playback.device.id !== state.deviceId || playback.device.restricted) return recover(state, "Spotify device lost or changed. Choose the original device before explicitly restarting.");
  if (playback.repeatState !== "off" || playback.shuffleState !== false) return recover(state, "Spotify repeat or shuffle changed. Turn both off before explicitly restarting.");
  if (playback.progressAvailable === false || !Number.isFinite(playback.progressMs) || !playback.track || !Number.isFinite(playback.track.durationMs) || playback.track.durationMs <= 0) return recover(state, "Spotify did not report a usable track playhead. Inspect playback before recovering.");
  if (state.pending?.issuedAt !== null && state.pending) {
    const pending = state.pending;
    const desired = state.event.sections[pending.target.section].tracks[pending.target.track];
    // Fresh provider state and progress near zero distinguish repeated URIs from
    // the preceding occurrence. A successful HTTP response alone is insufficient.
    const freshStart = playback.timestamp !== undefined && playback.timestamp > (pending.previousTimestamp ?? -1) && playback.timestamp >= pending.issuedAt! - 1000 && playback.timestamp <= pending.issuedAt! + 12_000;
    const elapsed = action.now - pending.issuedAt!;
    if (playback.track?.uri === desired.uri && playback.isPlaying && playback.progressMs <= Math.min(10_000, elapsed + 2000) && freshStart) {
      const timing = { expectedEnd: pending.expectedEnd, completionObservedAt: pending.completionObservedAt, commandIssuedAt: pending.issuedAt!, confirmedAt: action.now, approximateGapMs: pending.expectedEnd === null ? null : Math.max(0, playback.timestamp! - pending.expectedEnd) };
      return change(state, { cursor: pending.target, phase: pending.cueAfterStart === null ? "playing" : "next_section_queued", cue: pending.cueAfterStart, pending: null, message: null, retryAt: null, expectedEnd: playback.observedAt + playback.track.durationMs - playback.progressMs, burstStartedAt: null, transitionTiming: timing });
    }
    if (elapsed >= 12_000) return recover(state, "Start was not confirmed. It may have succeeded; inspect Spotify before explicitly restarting. No command has been retried.");
    return state;
  }
  // Upgrade only the removed queue guard, after a fresh authoritative read.
  // Genuine playback/device/API recovery remains explicitly operator-controlled.
  if (state.phase === "recovery" && state.message === LEGACY_QUEUE_ERROR && !state.pending && playback.track.uri === currentTrack(state).uri && playback.isPlaying && playback.progressMs < playback.track.durationMs) {
    return change(state, { phase: state.cue === null ? "playing" : "next_section_queued", message: null, retryAt: null, expectedEnd: playback.observedAt + playback.track.durationMs - playback.progressMs, burstStartedAt: null });
  }
  if (state.phase === "recovery" || state.phase === "section_complete" || state.phase === "idle" || state.phase === "transitioning") return state;
  if (playback.track?.uri !== currentTrack(state).uri) return recover(state, "Spotify changed tracks outside Segueway. Automation is suspended; your cue is preserved.");

  // A reset is inferred only from two fresh, stable stopped samples after a
  // recent near-end playing sample. Projection alone never completes a track.
  const candidate = state.endCandidate;
  if (candidate) {
    const age = playback.observedAt - candidate.firstObservedAt;
    if (age < 0 || age > 2500 || playback.observedAt > action.now || action.now - playback.observedAt > 2000) return recover(state, "Track completion observations became stale. Confirm the next track explicitly.");
    if (state.pauseRequested || playback.isPlaying || playback.progressMs !== 0) state = { ...state, endCandidate: null };
    else if (playback.timestamp !== candidate.timestamp) return recover(state, "Spotify changed state while track completion was being confirmed. Confirm the next track explicitly.");
    else if (age >= 500 && playback.observedAt >= candidate.expectedEnd) return finishTrack(state, candidate.firstObservedAt);
    else return state;
  }
  if (!state.pauseRequested && !playback.isPlaying && playback.progressMs >= playback.track.durationMs && playback.track.durationMs > 0 && previous?.isPlaying) {
    return finishTrack(state, playback.observedAt);
  }
  if (!state.pauseRequested && previous?.isPlaying && !playback.isPlaying && playback.progressMs === 0 && previous.progressMs > 0) {
    const expectedEnd = state.expectedEnd;
    const remaining = (previous.track?.durationMs ?? Infinity) - previous.progressMs;
    const age = playback.observedAt - previous.observedAt;
    const fresh = age > 0 && age <= 3000 && playback.observedAt <= action.now && action.now - playback.observedAt <= 2000;
    const atBoundary = expectedEnd !== null && playback.observedAt >= expectedEnd - 750 && playback.observedAt <= expectedEnd + 3000;
    const sameTrack = previous.track?.uri === playback.track.uri && previous.device?.id === state.deviceId;
    if (fresh && sameTrack && remaining >= 0 && remaining <= 3000 && atBoundary && action.now >= (state.inferenceBlockedUntil ?? 0)) {
      return { ...state, endCandidate: { firstObservedAt: playback.observedAt, expectedEnd: expectedEnd!, timestamp: playback.timestamp } };
    }
    return recover(state, "Spotify stopped and reset its playhead without enough fresh boundary evidence. Confirm the next track explicitly.");
  }
  const projectedPrevious = previous?.isPlaying ? previous.progressMs + playback.observedAt - previous.observedAt : previous?.progressMs;
  const seeked = projectedPrevious !== undefined && Math.abs(playback.progressMs - projectedPrevious) > 2000 && (playback.timestamp !== previous?.timestamp || playback.progressMs < (previous?.progressMs ?? 0) - 2000 || playback.progressMs > projectedPrevious + 2000);
  const expectedEnd = playback.isPlaying ? playback.observedAt + Math.max(0, playback.track.durationMs - playback.progressMs) : null;
  const remaining = expectedEnd === null ? Infinity : expectedEnd - action.now;
  const burstStartedAt = !playback.isPlaying || seeked ? null : remaining <= 3000 ? state.burstStartedAt ?? action.now : null;
  if (burstStartedAt !== null && action.now - burstStartedAt >= 8000) return recover(state, "Spotify has not provided a clear track boundary. Automation is suspended; confirm the next track explicitly.");
  return { ...state, expectedEnd, burstStartedAt, inferenceBlockedUntil: seeked ? action.now + 3000 : state.inferenceBlockedUntil, pauseRequested: state.pauseRequested && !(playback.isPlaying && previous && !previous.isPlaying) };
}

// Projection controls observation frequency only. It never dispatches a boundary.
export function observationDelay(state: LiveState, now: number): number {
  if (state.retryAt && state.retryAt > now) return state.retryAt - now;
  if (state.endCandidate) return 750;
  if (state.pending?.issuedAt !== null && state.pending && state.phase === "transitioning") return 750;
  if (!["playing", "next_section_queued"].includes(state.phase) || !state.observation?.isPlaying || state.expectedEnd === null) return 10_000;
  const remaining = state.expectedEnd - now;
  if (remaining <= 3000 && (state.burstStartedAt === null || now - state.burstStartedAt < 8000)) return 750;
  if (remaining <= 15_000) return Math.max(750, Math.min(2000, remaining - 3000));
  return Math.max(2000, Math.min(10_000, remaining - 15_000));
}
