export type PlaybackAction = "play" | "pause" | "previous" | "next";

export interface Playback {
  isPlaying: boolean;
  progressMs: number;
  observedAt: number;
  timestamp?: number;
  progressAvailable?: boolean;
  repeatState?: string;
  shuffleState?: boolean;
  device: { id?: string | null; name: string; type: string; restricted: boolean } | null;
  track: { uri?: string; spotifyId?: string; name: string; artist: string; artwork: string | null; durationMs: number; url: string | null } | null;
  disallowed: Partial<Record<"pausing" | "resuming" | "skipping_prev" | "skipping_next", boolean>>;
}

export interface ApiErrorBody {
  error: { message: string; code: string; retryAfter?: number; quotaExceeded?: boolean };
}
