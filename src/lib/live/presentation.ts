import type { LiveState } from "./machine";

// These projections drive presentation only. They never dispatch playback commands.
export function livePresentation(live: LiveState, now: number) {
  const section = live.event.sections[live.cursor.section];
  const observed = live.observation;
  const duration = observed?.track?.durationMs ?? 0;
  const progress = Math.min(duration, Math.max(0, (observed?.progressMs ?? 0) + (observed?.isPlaying ? Math.max(0, now - observed.observedAt) : 0)));
  const leavesSection = live.cue !== null || !!live.pending && live.pending.target.section !== live.cursor.section;
  const incomingIndex = live.pending && live.pending.target.section !== live.cursor.section ? live.pending.target.section : live.cue ?? live.cursor.section + 1;
  const incoming = live.event.sections[incomingIndex];
  const imminent = !!incoming && live.phase !== "recovery" && live.phase !== "section_complete" && (live.pending?.target.section !== undefined && live.pending.target.section !== live.cursor.section || leavesSection && (live.endCandidate !== null && live.endCandidate !== undefined || !!observed?.isPlaying && duration > 0 && duration - progress <= 15000));
  const nextTrack = live.pending ? live.event.sections[live.pending.target.section].tracks[live.pending.target.track] : live.cue !== null ? incoming?.tracks[0] : section.tracks[live.cursor.track + 1] ?? (section.playbackMode === "loop" ? section.tracks[0] : undefined);
  return { progress, duration, incoming, imminent, nextTrack, leavesSection };
}
