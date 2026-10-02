export type PlaybackMode = "once" | "loop";

export interface Track {
  spotifyId: string;
  uri: string;
  name: string;
  artists: string[];
  albumName: string;
  artwork: string | null;
  durationMs: number;
}

// An occurrence ID allows the same song to appear more than once independently.
export interface SectionTrack extends Track { entryId: string }
export interface Section { id: string; name: string; tracks: SectionTrack[]; playbackMode: PlaybackMode }
export interface Event { id: string; name: string; sections: Section[] }
export interface EventLibrary { version: 1; events: Event[]; activeEventId: string | null }
export const emptyLibrary = (): EventLibrary => ({ version: 1, events: [], activeEventId: null });

export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
