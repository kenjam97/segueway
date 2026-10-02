import { emptyLibrary, type EventLibrary } from "./model";

export const EVENT_STORAGE_KEY = "segueway.events.v1";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const id = (value: unknown): value is string => text(value) && value.length > 0;
const uniqueIds = (values: ObjectValue[], field: string) => new Set(values.map(value => value[field])).size === values.length;

export function parseLibrary(raw: string): EventLibrary {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.version !== 1 || !Array.isArray(value.events)) throw new Error("Unsupported event data");
  for (const event of value.events) {
    if (!object(event) || !id(event.id) || !text(event.name) || !Array.isArray(event.sections)) throw new Error("Invalid event");
    for (const section of event.sections) {
      if (!object(section) || !id(section.id) || !text(section.name) || !["once", "loop"].includes(String(section.playbackMode)) || !Array.isArray(section.tracks)) throw new Error("Invalid section");
      for (const track of section.tracks) {
        if (!object(track) || !id(track.entryId) || !id(track.spotifyId) || !text(track.uri) || track.uri !== `spotify:track:${track.spotifyId}` || !text(track.name) || !Array.isArray(track.artists) || !track.artists.every(text) || !text(track.albumName) || !(track.artwork === null || (text(track.artwork) && track.artwork.startsWith("https://"))) || typeof track.durationMs !== "number" || !Number.isFinite(track.durationMs) || track.durationMs < 0) throw new Error("Invalid track");
      }
      if (!uniqueIds(section.tracks, "entryId")) throw new Error("Duplicate track entries");
    }
    if (!uniqueIds(event.sections, "id")) throw new Error("Duplicate sections");
  }
  if (!uniqueIds(value.events, "id") || !(value.activeEventId === null || (id(value.activeEventId) && value.events.some(event => event.id === value.activeEventId)))) throw new Error("Invalid event selection");
  return value as unknown as EventLibrary;
}

export function loadLibrary(storage: Pick<Storage, "getItem">): EventLibrary {
  const raw = storage.getItem(EVENT_STORAGE_KEY);
  return raw === null ? emptyLibrary() : parseLibrary(raw);
}
export function saveLibrary(storage: Pick<Storage, "setItem">, state: EventLibrary) {
  storage.setItem(EVENT_STORAGE_KEY, JSON.stringify(state));
}
