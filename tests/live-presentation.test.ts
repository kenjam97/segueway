import { describe, expect, it } from "vitest";
import { createLiveState, liveReducer, type LiveState } from "@/lib/live/machine";
import { livePresentation } from "@/lib/live/presentation";
import type { Playback } from "@/lib/playback";
import type { Event } from "@/lib/events/model";
const track = { entryId: "a", spotifyId: "a", uri: "spotify:track:a", name: "A", artists: ["Artist"], albumName: "Album", artwork: null, durationMs: 60000 };
const event: Event = { id: "event", name: "Event", sections: [{ id: "first", name: "First", playbackMode: "loop", tracks: [track] }, { id: "second", name: "Second", playbackMode: "once", tracks: [{ ...track, entryId: "b", uri: "spotify:track:b" }] }] };
const observation: Playback = { isPlaying: true, progressMs: 45000, observedAt: 1000, repeatState: "off", shuffleState: false, device: { id: "device", name: "Device", type: "Speaker", restricted: false }, track: { uri: track.uri, name: "A", artist: "Artist", artwork: null, durationMs: 60000, url: null }, disallowed: {} };
function state(): LiveState { return { ...createLiveState(event, 0, observation, "run"), phase: "playing", pending: null, observation }; }
describe("live presentation", () => {
  it("does not suggest a section change near the end of an uncued Loop", () => {
    const live = state(); const before = JSON.stringify(live);
    expect(livePresentation(live, 60000).imminent).toBe(false);
    expect(livePresentation(live, 60000).nextTrack?.entryId).toBe("a");
    expect(JSON.stringify(live)).toBe(before);
  });
  it("stages a cued section near the expected boundary without committing playback", () => {
    const live = liveReducer(state(), { type: "cue" });
    expect(livePresentation(live, 1000).imminent).toBe(true);
    expect(livePresentation(live, 60000).progress).toBe(60000);
    expect(live.phase).toBe("next_section_queued"); expect(live.pending).toBeNull();
  });
  it("recalculates on pause and seek and hides approach during recovery", () => {
    const live = liveReducer(state(), { type: "cue" });
    const paused = { ...live, observation: { ...observation, isPlaying: false } };
    expect(livePresentation(paused, 60000).progress).toBe(45000);
    expect(livePresentation(paused, 60000).imminent).toBe(false);
    expect(livePresentation({ ...live, observation: { ...observation, progressMs: 1000 } }, 1000).imminent).toBe(false);
    expect(livePresentation({ ...live, phase: "recovery" }, 60000).imminent).toBe(false);
  });
  it("does not preview automatic advance at a Once final track", () => {
    const live = state(); live.event = { ...event, sections: [{ ...event.sections[0], playbackMode: "once", tracks: [track, { ...track, entryId: "duplicate" }] }, event.sections[1]] };
    expect(livePresentation(live, 1000).imminent).toBe(false);
    const last = { ...live, cursor: { ...live.cursor, track: 1 } };
    expect(livePresentation(last, 1000).imminent).toBe(false);
    expect(livePresentation(last, 1000).nextTrack).toBeUndefined();
    expect(livePresentation(liveReducer(last, { type: "cue" }), 1000).imminent).toBe(true);
  });
});
