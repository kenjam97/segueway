import { describe, expect, it } from "vitest";
import type { Event, SectionTrack } from "@/lib/events/model";
import type { Playback } from "@/lib/playback";
import { createLiveState, LEGACY_QUEUE_ERROR, liveReducer, observationDelay, type LiveState } from "@/lib/live/machine";

const song = (id: string, entryId = id): SectionTrack => ({ entryId, spotifyId: id, uri: `spotify:track:${id}`, name: id, artists: ["Artist"], albumName: "Album", artwork: null, durationMs: 60_000 });
const event: Event = { id: "wedding", name: "Wedding", sections: [
  { id: "waiting", name: "Waiting", playbackMode: "loop", tracks: [song("a"), song("b")] },
  { id: "entrance", name: "Entrance", playbackMode: "once", tracks: [song("c"), song("d")] },
] };
function playback(uri = "spotify:track:a", progressMs = 0, isPlaying = true, observedAt = 1000, timestamp = 1000): Playback {
  return { isPlaying, progressMs, observedAt, timestamp, repeatState: "off", shuffleState: false, device: { id: "speaker", name: "Speaker", type: "Speaker", restricted: false }, track: { uri, name: uri, artist: "Artist", durationMs: 60_000, artwork: null, url: null }, disallowed: {} };
}
function playing(config = event, section = 0): LiveState {
  let state = createLiveState(config, section, playback("spotify:track:old", 0, true, 0, 0), "run");
  state = liveReducer(state, { type: "issued", now: 1000 });
  return liveReducer(state, { type: "observe", playback: playback(config.sections[section].tracks[0].uri), now: 1000 });
}
function observe(state: LiveState, progress: number, isPlaying = true, now = 1000 + progress): LiveState {
  return liveReducer(state, { type: "observe", playback: playback(state.event.sections[state.cursor.section].tracks[state.cursor.track].uri, progress, isPlaying, now), now });
}
const ended = (state: LiveState) => observe(observe(state, 59_000), 60_000, false);
function confirm(state: LiveState, now = 62_000): LiveState {
  const uri = state.event.sections[state.pending!.target.section].tracks[state.pending!.target.track].uri;
  return liveReducer(liveReducer(state, { type: "issued", now }), { type: "observe", playback: playback(uri, 0, true, now + 750, now), now: now + 750 });
}

describe("live state machine", () => {
  it("advances normally only after Spotify confirms a terminal playhead", () => {
    const state = playing();
    expect(observe(state, 59_999).phase).toBe("playing");
    const advanced = ended(state);
    expect(advanced.phase).toBe("transitioning");
    expect(advanced.pending?.target).toEqual({ section: 0, track: 1, occurrence: 2 });
    expect(confirm(advanced).cursor.track).toBe(1);
  });
  it("wraps a Loop section", () => {
    const last = confirm(ended(playing()));
    expect(ended(last).pending?.target).toMatchObject({ section: 0, track: 0, occurrence: 3 });
  });
  it("the final Once section completes and stops at the end of the event", () => {
    const last = confirm(ended(playing(event, 1)));
    const complete = ended(last);
    expect(complete.phase).toBe("section_complete"); expect(complete.pending).toBeNull();
  });
  it.each(["once", "loop"] as const)("a Once section waits before the following %s section", (mode) => {
    const config: Event = { ...event, sections: [{ ...event.sections[1], tracks: [song("c"), song("d")] }, { ...event.sections[0], playbackMode: mode }] };
    const firstEnded = ended(playing(config));
    expect(firstEnded.pending?.target).toMatchObject({ section: 0, track: 1 });
    const finalEnded = ended(confirm(firstEnded));
    expect(finalEnded.phase).toBe("section_complete"); expect(finalEnded.pending).toBeNull();
    expect(observe(finalEnded, 0, false, 300_000).phase).toBe("section_complete");
    expect(liveReducer(finalEnded, { type: "go_now" }).pending?.target).toMatchObject({ section: 1, track: 0 });
  });
  it("consecutive Once sections each require activation", () => {
    const config: Event = { ...event, sections: ["a", "b", "c"].map(id => ({ id, name: id, playbackMode: "once", tracks: [song(id)] })) };
    let state = playing(config);
    for (let index = 0; index < 3; index++) {
      state = ended(state); expect(state.phase).toBe("section_complete"); expect(state.pending).toBeNull();
      expect(state.cursor.section).toBe(index);
      if (index < 2) state = confirm(liveReducer(state, { type: "go_now" }), 62_000 + index * 61_000);
    }
    expect(liveReducer(state, { type: "go_now" })).toBe(state);
  });
  it("confirmed reset completion waits at a Once boundary", () => {
    const config: Event = { ...event, sections: [{ ...event.sections[0], playbackMode: "once", tracks: [song("a")] }, event.sections[1]] };
    const candidate = observe(observe(playing(config), 59_000), 0, false, 61_000);
    const state = observe(candidate, 0, false, 61_750);
    expect(state.phase).toBe("section_complete"); expect(state.pending).toBeNull();
  });
  it("an explicit cue on a Once section still starts the next section", () => {
    const config: Event = { ...event, sections: [{ ...event.sections[0], playbackMode: "once" }, event.sections[1]] };
    expect(ended(liveReducer(playing(config), { type: "cue" })).pending?.target).toMatchObject({ section: 1, track: 0 });
  });
  it("cancel cue restores Once track order and the wait at its end", () => {
    const config: Event = { ...event, sections: [{ ...event.sections[0], playbackMode: "once" }, event.sections[1]] };
    const state = liveReducer(liveReducer(playing(config), { type: "cue" }), { type: "cancel" });
    expect(ended(state).pending?.target).toMatchObject({ section: 0, track: 1 });
    const last = confirm(ended(state));
    const cancelledAtEnd = liveReducer(liveReducer(observe(last, 59_999), { type: "cue" }), { type: "cancel" });
    const complete = observe(cancelledAtEnd, 60_000, false);
    expect(complete.phase).toBe("section_complete"); expect(complete.pending).toBeNull();
  });
  it("waits before an empty following section and prevents starting it", () => {
    const config: Event = { ...event, sections: [{ ...event.sections[0], playbackMode: "once", tracks: [song("a")] }, { id: "empty", name: "Empty entrance", playbackMode: "once", tracks: [] }, event.sections[1]] };
    const state = ended(playing(config));
    expect(state.phase).toBe("section_complete"); expect(state.pending).toBeNull();
    expect(liveReducer(state, { type: "go_now" })).toBe(state);
  });
  it("skipping a recovered Once final track completes the section and waits", () => {
    const config: Event = { ...event, sections: [{ ...event.sections[0], playbackMode: "once", tracks: [song("a")] }, event.sections[1]] };
    const recovered = liveReducer(playing(config), { type: "failure", message: "Unknown completion" });
    const state = liveReducer(recovered, { type: "skip" });
    expect(state.phase).toBe("section_complete"); expect(state.pending).toBeNull(); expect(state.message).toBeNull();
  });
  it("cues the next section without interrupting the current track", () => {
    const state = playing(); const queued = liveReducer(state, { type: "cue" });
    expect(queued.phase).toBe("next_section_queued"); expect(queued.cursor).toEqual(state.cursor); expect(queued.pending).toBeNull();
    expect(ended(queued).pending?.target).toMatchObject({ section: 1, track: 0 });
  });
  it("cancel cue restores normal track advance", () => {
    const state = liveReducer(liveReducer(playing(), { type: "cue" }), { type: "cancel" });
    expect(state.cue).toBeNull(); expect(ended(state).pending?.target.track).toBe(1);
  });
  it("accepts a cue at the final milliseconds before a boundary is committed", () => {
    const queued = liveReducer(observe(playing(), 59_999), { type: "cue" });
    expect(observe(queued, 60_000, false).pending?.target.section).toBe(1);
  });
  it("GO NOW commits the next section immediately", () => {
    const state = liveReducer(playing(), { type: "go_now" });
    expect(state.phase).toBe("transitioning"); expect(state.pending?.target).toMatchObject({ section: 1, track: 0 });
    expect(state.pending?.completionObservedAt).toBeNull();
  });
  it("pause while queued preserves cue and invalidates the boundary", () => {
    const queued = liveReducer(playing(), { type: "cue" });
    const paused = observe(queued, 20_000, false);
    expect(paused.phase).toBe("next_section_queued"); expect(paused.cue).toBe(1); expect(paused.expectedEnd).toBeNull();
    const resumed = observe(paused, 20_000, true, 100_000);
    expect(resumed.expectedEnd).toBe(140_000); expect(resumed.cue).toBe(1);
  });
  it("seek while queued recalculates the boundary and ends an old polling burst", () => {
    let state = observe(liveReducer(playing(), { type: "cue" }), 59_000);
    expect(state.burstStartedAt).not.toBeNull();
    state = observe(state, 10_000, true, 61_000);
    expect(state.expectedEnd).toBe(111_000); expect(state.burstStartedAt).toBeNull(); expect(state.cue).toBe(1);
  });
  it("a deliberate pause at the boundary keeps the cue, including delayed Spotify acknowledgement", () => {
    let state = liveReducer(observe(liveReducer(playing(), { type: "cue" }), 59_999), { type: "transport", paused: true });
    state = observe(state, 60_000, true);
    expect(state.pauseRequested).toBe(true);
    state = observe(state, 60_000, false, 62_000);
    expect(state.phase).toBe("next_section_queued"); expect(state.pending).toBeNull(); expect(state.cue).toBe(1);
  });
  it("unknown progress is API uncertainty and cannot confirm a start or boundary", () => {
    const state = liveReducer(playing(), { type: "observe", playback: { ...playback(), progressAvailable: false }, now: 2000 });
    expect(state.phase).toBe("recovery"); expect(state.pending).toBeNull();
  });
  it("external track changes suspend automation and preserve cue", () => {
    const state = liveReducer(liveReducer(playing(), { type: "cue" }), { type: "observe", playback: playback("spotify:track:external"), now: 2000 });
    expect(state.phase).toBe("recovery"); expect(state.cue).toBe(1); expect(state.pending).toBeNull();
  });
  it("only clears the obsolete queue guard when the managed track is actually playing", () => {
    const suspended = liveReducer(playing(), { type: "failure", message: LEGACY_QUEUE_ERROR });
    expect(observe(suspended, 5000).phase).toBe("playing");
    expect(observe(suspended, 5000, false).phase).toBe("recovery");
    expect(liveReducer(suspended, { type: "observe", playback: playback("spotify:track:external"), now: 2000 }).phase).toBe("recovery");
    const realError = liveReducer(playing(), { type: "failure", message: "API unavailable" });
    expect(observe(realError, 5000).phase).toBe("recovery");
  });
  it("can cancel a suspended cue without restarting automation", () => {
    const state = liveReducer(liveReducer(liveReducer(playing(), { type: "cue" }), { type: "failure", message: "Rate limited", retryAt: 31_000 }), { type: "cancel" });
    expect(state.cue).toBeNull(); expect(state.phase).toBe("recovery"); expect(state.retryAt).toBe(31_000);
  });
  it("explicitly restarting a recovered track preserves its suspended cue", () => {
    let state = liveReducer(liveReducer(playing(), { type: "cue" }), { type: "failure", message: "Temporary API error" });
    state = liveReducer(state, { type: "restart" });
    const confirmed = confirm(state);
    expect(confirmed.phase).toBe("next_section_queued"); expect(confirmed.cue).toBe(1);
  });
  it("cancellation cannot be undone by confirmation of an uncertain recovery start", () => {
    let state = liveReducer(liveReducer(playing(), { type: "cue" }), { type: "failure", message: "API error" });
    state = liveReducer(liveReducer(state, { type: "restart" }), { type: "issued", now: 62_000 });
    state = liveReducer(state, { type: "failure", message: "Lost start response" });
    expect(state.cue).toBe(1);
    state = liveReducer(state, { type: "cancel" });
    state = liveReducer(state, { type: "observe", playback: playback("spotify:track:a", 1000, true, 63_000, 62_000), now: 63_000 });
    expect(state.phase).toBe("playing"); expect(state.cue).toBeNull();
  });
  it.each([null, { ...playback(), device: null }, { ...playback(), device: { ...playback().device!, id: "other" } }])("device loss or change enters recovery", (observation) => {
    expect(liveReducer(playing(), { type: "observe", playback: observation, now: 2000 }).phase).toBe("recovery");
  });
  it("distinguishes duplicate track occurrences and rejects stale confirmation", () => {
    const duplicates: Event = { ...event, sections: [{ ...event.sections[0], tracks: [song("a", "first"), song("a", "second")] }] };
    const state = liveReducer(ended(playing(duplicates)), { type: "issued", now: 62_000 });
    const stale = liveReducer(state, { type: "observe", playback: playback("spotify:track:a", 0, true, 62_750, 1000), now: 62_750 });
    expect(stale.phase).toBe("transitioning");
    const confirmed = liveReducer(state, { type: "observe", playback: playback("spotify:track:a", 0, true, 62_750, 62_000), now: 62_750 });
    expect(confirmed.cursor).toMatchObject({ track: 1, occurrence: 2 });
  });
  it("timeout after accepted start enters recovery without retrying", () => {
    const state = liveReducer(ended(playing()), { type: "issued", now: 62_000 });
    const timedOut = liveReducer(state, { type: "observe", playback: playback("spotify:track:a", 60_000, false, 74_000), now: 74_000 });
    expect(timedOut.phase).toBe("recovery"); expect(timedOut.pending?.issuedAt).toBe(62_000);
    expect(liveReducer(timedOut, { type: "issued", now: 75_000 }).pending?.issuedAt).toBe(62_000);
  });
  it("reconciles an uncertain command that actually started, rather than replaying it", () => {
    let state = liveReducer(ended(playing()), { type: "issued", now: 62_000 });
    state = liveReducer(state, { type: "failure", message: "Network timeout" });
    const confirmed = liveReducer(state, { type: "observe", playback: playback("spotify:track:b", 3000, true, 65_000, 62_000), now: 65_000 });
    expect(confirmed.phase).toBe("playing"); expect(confirmed.pending).toBeNull();
  });
  it("cancel/transition race is resolved by the first committed action", () => {
    const queued = liveReducer(playing(), { type: "cue" });
    expect(ended(liveReducer(queued, { type: "cancel" })).pending?.target.section).toBe(0);
    const committed = ended(queued);
    expect(liveReducer(committed, { type: "cancel" })).toEqual(committed);
    expect(committed.pending?.target.section).toBe(1);
  });
  it("a paused playhead before duration never completes, even when a timer expires", () => {
    const state = observe(playing(), 59_999, false, 90_000);
    expect(state.phase).toBe("playing"); expect(state.pending).toBeNull(); expect(state.expectedEnd).toBeNull();
  });
  it("an early stopped reset playhead remains ambiguous and enters recovery", () => {
    expect(observe(observe(playing(), 40_000), 0, false, 42_000).phase).toBe("recovery");
  });
  it("requires two fresh stopped/reset observations before normal advancement", () => {
    const candidate = observe(observe(playing(), 59_000), 0, false, 61_000);
    expect(candidate.phase).toBe("playing"); expect(candidate.pending).toBeNull();
    expect(candidate.endCandidate?.firstObservedAt).toBe(61_000);
    expect(observationDelay(candidate, 61_000)).toBe(750);
    const advanced = observe(candidate, 0, false, 61_750);
    expect(advanced.pending?.target).toMatchObject({ section: 0, track: 1 });
    expect(advanced.pending?.completionObservedAt).toBe(61_000);
    expect(advanced.pending?.expectedEnd).toBe(61_000);
    expect(advanced.endCandidate).toBeNull();
  });
  it.each(["loop", "once"] as const)("handles a reset completion at a %s boundary", (mode) => {
    const config: Event = { ...event, sections: [{ ...event.sections[0], playbackMode: mode, tracks: [song("a")] }] };
    const candidate = observe(observe(playing(config), 59_000), 0, false, 61_000);
    const completed = observe(candidate, 0, false, 61_750);
    if (mode === "loop") expect(completed.pending?.target).toMatchObject({ section: 0, track: 0, occurrence: 2 });
    else { expect(completed.phase).toBe("section_complete"); expect(completed.pending).toBeNull(); }
  });
  it("cue and cancellation remain effective between the two reset observations", () => {
    const candidate = observe(observe(liveReducer(playing(), { type: "cue" }), 59_000), 0, false, 61_000);
    expect(observe(candidate, 0, false, 61_750).pending?.target.section).toBe(1);
    const cancelled = liveReducer(candidate, { type: "cancel" });
    expect(observe(cancelled, 0, false, 61_750).pending?.target).toMatchObject({ section: 0, track: 1 });
  });
  it("a pause request cancels a reset candidate and preserves the cue", () => {
    let state = observe(observe(liveReducer(playing(), { type: "cue" }), 59_000), 0, false, 61_000);
    state = liveReducer(state, { type: "transport", paused: true });
    state = observe(state, 0, false, 61_750);
    expect(state.endCandidate).toBeNull(); expect(state.phase).toBe("next_section_queued"); expect(state.pending).toBeNull();
  });
  it("resuming or seeking during confirmation invalidates the candidate", () => {
    const candidate = observe(observe(playing(), 59_000), 0, false, 61_000);
    const resumed = observe(candidate, 5000, true, 61_750);
    expect(resumed.endCandidate).toBeNull(); expect(resumed.pending).toBeNull();
    expect(resumed.expectedEnd).toBe(116_750);
    const pausedSeek = observe(candidate, 5000, false, 61_750);
    expect(pausedSeek.endCandidate).toBeNull(); expect(pausedSeek.pending).toBeNull();
  });
  it("a recent seek into the last moments blocks reset inference", () => {
    const seeked = observe(playing(), 59_000, true, 2000);
    expect(seeked.inferenceBlockedUntil).toBe(5000);
    const reset = observe(seeked, 0, false, 3000);
    expect(reset.phase).toBe("recovery"); expect(reset.pending).toBeNull();
  });
  it("stale, repeated, or changing reset observations cannot commit completion", () => {
    const candidate = observe(observe(playing(), 59_000), 0, false, 61_000);
    expect(observe(candidate, 0, false, 61_000).pending).toBeNull();
    expect(observe(candidate, 0, false, 64_000).phase).toBe("recovery");
    const changed = liveReducer(candidate, { type: "observe", playback: playback("spotify:track:a", 0, false, 61_750, 61_750), now: 61_750 });
    expect(changed.phase).toBe("recovery");
    const delayed = observe(observe(playing(), 59_000), 0, false, 66_000);
    expect(delayed.phase).toBe("recovery");
  });
  it("API errors and external changes discard an unconfirmed reset boundary", () => {
    const candidate = observe(observe(playing(), 59_000), 0, false, 61_000);
    const failed = liveReducer(candidate, { type: "failure", message: "Rate limited", retryAt: 91_000 });
    expect(failed.endCandidate).toBeNull(); expect(observe(failed, 0, false, 61_750).phase).toBe("recovery");
    const external = liveReducer(candidate, { type: "observe", playback: playback("spotify:track:external", 0, false, 61_750), now: 61_750 });
    expect(external.phase).toBe("recovery"); expect(external.endCandidate).toBeNull();
  });
  it("uses bounded adaptive reads, never a timer-triggered advance", () => {
    let state = playing(); expect(observationDelay(state, 1000)).toBe(10_000);
    state = observe(state, 46_000); expect(observationDelay(state, 47_000)).toBe(2000);
    state = observe(state, 58_000); expect(observationDelay(state, 59_000)).toBe(750);
    expect(state.pending).toBeNull();
    const stalled = observe(state, 58_000, true, 67_000);
    expect(stalled.phase).toBe("recovery"); expect(observationDelay(stalled, 67_000)).toBe(10_000);
  });
  it("rate limiting suspends automation and respects the cooldown", () => {
    const state = liveReducer(playing(), { type: "failure", message: "Rate limited", retryAt: 31_000 });
    expect(state.phase).toBe("recovery"); expect(observationDelay(state, 1000)).toBe(30_000);
  });
  it("records transition timing from observations and command confirmation", () => {
    const state = confirm(ended(playing()));
    expect(state.transitionTiming).toMatchObject({ expectedEnd: 61_000, completionObservedAt: 61_000, commandIssuedAt: 62_000, confirmedAt: 62_750, approximateGapMs: 1000 });
  });
});
