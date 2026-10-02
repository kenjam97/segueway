"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Playback, PlaybackAction } from "@/lib/playback";
import { playerClient, PlayerError } from "@/lib/player-client";

function Icon({ kind, className = "h-5 w-5" }: { kind: "play" | "pause" | "previous" | "next" | "device" | "music" | "refresh"; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "play" && <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none" />}
    {kind === "pause" && <><path d="M8 5v14M16 5v14" strokeWidth="4" /></>}
    {kind === "previous" && <><path d="M5 5v14" /><path d="m19 5-11 7 11 7Z" fill="currentColor" stroke="none" /></>}
    {kind === "next" && <><path d="M19 5v14" /><path d="m5 5 11 7-11 7Z" fill="currentColor" stroke="none" /></>}
    {kind === "device" && <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>}
    {kind === "music" && <><path d="M9 17V6l11-2v11M9 9l11-2" /><ellipse cx="6" cy="17" rx="3" ry="2" /><ellipse cx="17" cy="15" rx="3" ry="2" /></>}
    {kind === "refresh" && <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>}
  </svg>;
}

function time(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function Player() {
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PlayerError | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [cooldown, setCooldown] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const gate = useRef({ inFlight: false, until: 0, stopped: false, failures: 0 });
  const refreshRef = useRef<() => void>(() => {});

  const handleError = useCallback((cause: unknown) => {
    const failure = cause instanceof PlayerError ? cause : new PlayerError(0, "UNKNOWN", "Unable to update playback. Try again.");
    setError(failure);
    gate.current.failures += 1;
    if (failure.status === 429) {
      gate.current.until = Date.now() + Math.max(1, failure.retryAfter) * 1000;
      setCooldown(gate.current.until);
      if (failure.quotaExceeded) gate.current.stopped = true;
    }
    if (failure.status === 401) { gate.current.stopped = true; setSignedOut(true); setPlayback(null); }
    if (failure.code === "NO_DEVICE") setPlayback(null);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (delay: number) => { clearTimeout(timer); if (active) timer = setTimeout(() => void read(), delay); };
    async function read() {
      if (!active) return;
      if (document.hidden || gate.current.inFlight) { schedule(1000); return; }
      if (gate.current.stopped) return;
      if (gate.current.until > Date.now()) { schedule(gate.current.until - Date.now()); return; }
      gate.current.inFlight = true;
      try {
        const state = await playerClient.read();
        if (active) { setPlayback(state); setError(null); setCooldown(0); gate.current.failures = 0; }
      } catch (cause) { if (active) handleError(cause); }
      finally {
        gate.current.inFlight = false;
        if (active) {
          setLoading(false);
          if (!gate.current.stopped) schedule(Math.max(10_000, Math.min(60_000, 5000 * 2 ** Math.min(gate.current.failures, 4)), gate.current.until - Date.now()));
        }
      }
    }
    refreshRef.current = () => {
      if (signedOut) return;
      gate.current.stopped = false;
      schedule(Math.max(0, gate.current.until - Date.now()));
    };
    const visible = () => { if (!document.hidden && !gate.current.stopped) schedule(0); };
    document.addEventListener("visibilitychange", visible);
    void read();
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [handleError, signedOut]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function control(action: PlaybackAction) {
    if (gate.current.inFlight || gate.current.until > Date.now() || gate.current.stopped) return;
    gate.current.inFlight = true;
    setBusy(true);
    try { await playerClient.control(action); setError(null); gate.current.failures = 0; }
    catch (cause) { handleError(cause); }
    finally {
      gate.current.inFlight = false;
      setBusy(false);
      // Give Spotify time to propagate the command before reading authoritative state.
      if (!gate.current.stopped) setTimeout(() => refreshRef.current(), 700);
    }
  }

  const remaining = Math.max(0, Math.ceil((cooldown - now) / 1000));
  const track = playback?.track;
  const hasDevice = !!playback?.device;
  const disabled = loading || busy || !hasDevice || playback?.device?.restricted || remaining > 0 || signedOut || gate.current.stopped;
  const progress = track ? Math.min(track.durationMs, (playback?.progressMs ?? 0) + (playback?.isPlaying && !error ? Math.max(0, now - playback.observedAt) : 0)) : 0;
  const playing = playback?.isPlaying ?? false;

  return <section aria-label="Spotify playback" className="player-card">
    <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-6 py-5 sm:px-8">
      <span className="eyebrow">Now playing</span>
      <span className="flex items-center gap-2 text-xs text-[var(--muted)]"><span className={`h-1.5 w-1.5 rounded-full ${playing ? "bg-[var(--green)]" : "bg-[var(--muted)]"}`} />{loading ? "Connecting…" : signedOut ? "Disconnected" : playing ? "Playing on Spotify" : hasDevice ? "Paused" : "Waiting for a device"}</span>
    </div>

    <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-12">
      <div className="artwork relative flex aspect-square items-center justify-center overflow-hidden rounded-xl">
        {track?.artwork ? /* Spotify artwork is rendered unchanged and directly from its supplied URL. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={track.artwork} alt={`Album artwork for ${track.name}`} className="h-full w-full object-contain" referrerPolicy="no-referrer" /> : <div className="flex flex-col items-center gap-4 text-[var(--green)]"><span className="flex h-24 w-24 items-center justify-center rounded-full border border-[var(--green)]/20"><Icon kind="music" className="h-10 w-10" /></span><span className="eyebrow text-[var(--green)]">No album artwork</span></div>}
      </div>

      <div className="flex min-w-0 flex-col justify-center">
        {loading ? <div role="status" className="py-6"><h2 className="track-title">Loading playback...</h2><p className="mt-3 text-[var(--muted)]">Checking your Spotify playback.</p></div> : signedOut ? <><span className="eyebrow">Reconnect</span><h2 className="track-title mt-4">Reconnect Spotify</h2><p className="mt-4 text-sm leading-6 text-[var(--muted)]">Your session has ended. Connect to Spotify to return to your music.</p><a className="primary-button mt-6 self-start" href="/api/auth/login">Connect with Spotify ↗</a></> : track ? <><span className="eyebrow">{playing ? "Now playing" : "Paused"}</span><h2 className="track-title mt-4 break-words">{track.name}</h2><p className="mt-3 text-lg text-[var(--muted)]">{track.artist}</p>{track.url && <a href={track.url} target="_blank" rel="noreferrer" className="mt-4 self-start text-xs underline decoration-[var(--muted)]/40 underline-offset-4">Open in Spotify ↗</a>}</> : <><span className="eyebrow">{hasDevice ? "Spotify is connected" : "No active device"}</span><h2 className="track-title mt-4">{hasDevice ? "No track to show." : "Choose a Spotify device"}</h2><p className="mt-4 text-sm leading-6 text-[var(--muted)]">{hasDevice ? "Spotify may be playing an ad or another type of audio. Choose a music track in Spotify to see it here." : "Open Spotify on your phone, computer, or speaker. Choose your device and start a track to see it here."}</p></>}

        <div className="mt-8">
          <div role="progressbar" aria-label="Playback progress" aria-valuemin={0} aria-valuemax={track?.durationMs ?? 1} aria-valuenow={progress} aria-valuetext={`${time(progress)} of ${time(track?.durationMs ?? 0)}`} className="h-1 overflow-hidden rounded-full bg-[var(--line)]"><div className="h-full rounded-full bg-[var(--green)] transition-[width] duration-700" style={{ width: `${track?.durationMs ? progress / track.durationMs * 100 : 0}%` }} /></div>
          <div className="mt-2 flex justify-between text-xs tabular-nums text-[var(--muted)]"><span>{time(progress)}</span><span>{time(track?.durationMs ?? 0)}</span></div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-6" aria-label="Playback controls">
          <button className="transport-button" aria-label="Previous track" disabled={disabled || playback?.disallowed.skipping_prev} onClick={() => void control("previous")}><Icon kind="previous" className="h-6 w-6" /></button>
          <button className="play-button" aria-label={playing ? "Pause" : "Play"} disabled={disabled || (playing ? playback?.disallowed.pausing : playback?.disallowed.resuming)} onClick={() => void control(playing ? "pause" : "play")}><Icon kind={playing ? "pause" : "play"} className="h-7 w-7" /></button>
          <button className="transport-button" aria-label="Next track" disabled={disabled || playback?.disallowed.skipping_next} onClick={() => void control("next")}><Icon kind="next" className="h-6 w-6" /></button>
        </div>
        <p role="status" className="mt-3 h-4 text-center text-xs text-[var(--muted)]">{busy ? "Sending to Spotify…" : playback?.device?.restricted ? "This Spotify device does not allow remote controls." : ""}</p>
      </div>
    </div>

    {error && !signedOut && <div role="alert" className="mx-6 mb-6 rounded-lg border border-amber-800/15 bg-amber-50 p-4 text-sm text-amber-950 sm:mx-8"><p>{error.message}</p>{remaining > 0 && <p className="mt-1 text-xs">Try again in {remaining} seconds.</p>}{error.quotaExceeded && <p className="mt-1 text-xs">Automatic updates are paused. Use Refresh after the quota becomes available.</p>}</div>}

    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] px-6 py-5 sm:px-8">
      <div className="flex items-center gap-3"><Icon kind="device" /><div><p className="text-sm font-medium">{playback?.device?.name ?? "No active device"}</p><p className="mt-0.5 text-xs text-[var(--muted)]">{playback?.device?.type ?? "Playback happens in Spotify"}</p></div></div>
      <button className="flex min-h-10 items-center gap-2 text-xs text-[var(--green)] disabled:opacity-40" disabled={busy || remaining > 0 || signedOut || loading} onClick={() => refreshRef.current()}><Icon kind="refresh" className="h-4 w-4" />Refresh</button>
    </div>
  </section>;
}
