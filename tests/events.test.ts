import { describe, expect, it, vi } from "vitest";
import { emptyLibrary, type EventLibrary, type SectionTrack } from "@/lib/events/model";
import { eventReducer, editorHistoryReducer } from "@/lib/events/reducer";
import { EVENT_STORAGE_KEY, loadLibrary, parseLibrary, saveLibrary } from "@/lib/events/storage";

const track = (entryId: string): SectionTrack => ({ entryId, spotifyId: "song", uri: "spotify:track:song", name: "Song", artists: ["Artist"], albumName: "Album", artwork: null, durationMs: 180000 });
function fixture() {
  let state = eventReducer(emptyLibrary(), { type: "create-event", id: "wedding", name: "Wedding" });
  state = eventReducer(state, { type: "create-section", eventId: "wedding", id: "guests", name: "Guests Arriving" });
  return state;
}
describe("event configuration", () => {
  it("creates and renames events and sections, keeping separate events", () => {
    let state = fixture();
    state = eventReducer(state, { type: "rename-event", id: "wedding", name: "Our Wedding" });
    state = eventReducer(state, { type: "rename-section", eventId: "wedding", sectionId: "guests", name: "Arrival" });
    state = eventReducer(state, { type: "create-event", id: "party", name: "Party" });
    expect(state.events[0]).toMatchObject({ name: "Our Wedding", sections: [{ name: "Arrival" }] });
    expect(state.activeEventId).toBe("party");
    state = eventReducer(state, { type: "select-event", id: "wedding" });
    expect(state.activeEventId).toBe("wedding");
    expect(eventReducer(state, { type: "rename-event", id: "wedding", name: " " }).events[0].name).toBe("Our Wedding");
  });
  it("orders sections, sets modes and deletes the intended section", () => {
    let state = eventReducer(fixture(), { type: "create-section", eventId: "wedding", id: "entrance", name: "Ceremony Entrance" });
    const original = state;
    state = eventReducer(state, { type: "set-mode", eventId: "wedding", sectionId: "guests", mode: "loop" });
    state = eventReducer(state, { type: "move-section", eventId: "wedding", sectionId: "entrance", direction: -1 });
    expect(state.events[0].sections.map(section => section.id)).toEqual(["entrance", "guests"]);
    expect(state.events[0].sections[1].playbackMode).toBe("loop");
    expect(original.events[0].sections[0].playbackMode).toBe("once");
    state = eventReducer(state, { type: "delete-section", eventId: "wedding", sectionId: "entrance" });
    expect(state.events[0].sections.map(section => section.id)).toEqual(["guests"]);
  });
  it("preserves duplicate songs as independently ordered/removable entries", () => {
    let state = fixture();
    for (const id of ["first", "second"]) state = eventReducer(state, { type: "add-track", eventId: "wedding", sectionId: "guests", track: track(id) });
    state = eventReducer(state, { type: "move-track", eventId: "wedding", sectionId: "guests", entryId: "second", direction: -1 });
    expect(state.events[0].sections[0].tracks.map(track => track.entryId)).toEqual(["second", "first"]);
    state = eventReducer(state, { type: "remove-track", eventId: "wedding", sectionId: "guests", entryId: "first" });
    expect(state.events[0].sections[0].tracks.map(track => track.entryId)).toEqual(["second"]);
  });
  it("ignores out-of-bounds moves", () => {
    const state = fixture();
    expect(eventReducer(state, { type: "move-section", eventId: "wedding", sectionId: "guests", direction: -1 })).toEqual(state);
  });
  it("saves and restores the full event configuration and selection", () => {
    const state = eventReducer(fixture(), { type: "add-track", eventId: "wedding", sectionId: "guests", track: track("first") });
    let raw = "";
    const storage = { getItem: vi.fn(() => raw || null), setItem: vi.fn((_key, value) => { raw = value; }) };
    expect(loadLibrary(storage)).toEqual(emptyLibrary());
    saveLibrary(storage, state);
    expect(storage.setItem).toHaveBeenCalledWith(EVENT_STORAGE_KEY, JSON.stringify(state));
    expect(loadLibrary(storage)).toEqual(state);
  });
  it("rejects corrupt, incompatible and invalid data without writing to storage", () => {
    for (const raw of ["broken", '{"version":2,"events":[]}', JSON.stringify({ ...fixture(), activeEventId: "missing" })]) {
      const storage = { getItem: () => raw, setItem: vi.fn() };
      expect(() => loadLibrary(storage)).toThrow(); expect(storage.setItem).not.toHaveBeenCalled();
    }
    const state: EventLibrary = eventReducer(fixture(), { type: "add-track", eventId: "wedding", sectionId: "guests", track: { ...track("first"), durationMs: -1 } });
    expect(() => parseLibrary(JSON.stringify(state))).toThrow();
  });
  it("surfaces storage write failures", () => {
    expect(() => saveLibrary({ setItem: () => { throw new Error("QuotaExceededError"); } }, fixture())).toThrow();
  });
});


describe("editor ordering and undo", () => {
  it("drag reorders duplicate Spotify tracks by occurrence ID and leaves the original untouched", () => {
    let state = fixture();
    for (const id of ["a", "b", "c"]) state = eventReducer(state, { type: "add-track", eventId: "wedding", sectionId: "guests", track: track(id) });
    const reordered = eventReducer(state, { type: "reorder-track", eventId: "wedding", sectionId: "guests", entryId: "c", beforeId: "a" });
    expect(reordered.events[0].sections[0].tracks.map(t => t.entryId)).toEqual(["c", "a", "b"]);
    expect(state.events[0].sections[0].tracks.map(t => t.entryId)).toEqual(["a", "b", "c"]);
    expect(eventReducer(state, { type: "reorder-track", eventId: "wedding", sectionId: "guests", entryId: "missing", beforeId: "a" })).toEqual(state);
  });
  it("drag reorders sections without changing their tracks or modes", () => {
    const state = eventReducer(fixture(), { type: "create-section", eventId: "wedding", id: "entrance", name: "Entrance" });
    expect(eventReducer(state, { type: "reorder-section", eventId: "wedding", sectionId: "entrance", beforeId: "guests" }).events[0].sections).toEqual([...state.events[0].sections].reverse());
  });
  it("undo restores a deleted section and its tracks in their original positions", () => {
    const library = eventReducer(fixture(), { type: "add-track", eventId: "wedding", sectionId: "guests", track: track("a") });
    const removed = editorHistoryReducer({ library, undo: null }, { type: "delete-section", eventId: "wedding", sectionId: "guests" });
    expect(removed.library.events[0].sections).toEqual([]);
    expect(editorHistoryReducer(removed, { type: "undo" })).toEqual({ library, undo: null });
  });
  it("undo restores only the removed duplicate occurrence and cannot overwrite a later edit", () => {
    let library = fixture();
    for (const id of ["a", "b"]) library = eventReducer(library, { type: "add-track", eventId: "wedding", sectionId: "guests", track: track(id) });
    const removed = editorHistoryReducer({ library, undo: null }, { type: "remove-track", eventId: "wedding", sectionId: "guests", entryId: "a" });
    expect(editorHistoryReducer(removed, { type: "undo" }).library).toEqual(library);
    const renamed = editorHistoryReducer(removed, { type: "rename-event", id: "wedding", name: "New name" });
    expect(renamed.undo).toBeNull();
    expect(editorHistoryReducer(renamed, { type: "undo" })).toEqual(renamed);
  });
});
