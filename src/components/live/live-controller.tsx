"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadLibrary } from "@/lib/events/storage";
import { emptyLibrary, type EventLibrary } from "@/lib/events/model";
import { nextSection, type LiveState } from "@/lib/live/machine";
import { useLive } from "@/lib/live/use-live";
import type { ClientCommand } from "@/lib/live/client";
import { LiveStatus } from "./live-status";
import { ConfirmAction } from "./confirm-action";

export function LiveController({ connected }: { connected: boolean }) {
  const { live, loaded, error, busy, fresh, now, command } = useLive(connected);
  const [library, setLibrary] = useState<EventLibrary>(emptyLibrary);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [eventId, setEventId] = useState("");
  const [section, setSection] = useState(0);
  const [prepared, setPrepared] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; description: string; command: ClientCommand; snapshot: LiveState | null } | null>(null);
  useEffect(() => {
    const load = () => {
      try { const saved = loadLibrary(window.localStorage); setLibrary(saved); setEventId(id => id || saved.activeEventId || saved.events[0]?.id || ""); setStorageError(null); }
      catch { setStorageError("Saved events could not be read. Open the event editor to check browser storage."); }
    };
    load(); window.addEventListener("storage", load); return () => window.removeEventListener("storage", load);
  }, []);
  if (!connected) return <section className="player-card p-8"><h2 className="track-title">Connect before going live.</h2><a className="primary-button mt-6" href="/api/auth/login">Connect with Spotify</a></section>;
  const selected = library.events.find(event => event.id === eventId);
  const disabled = busy || !fresh || !!live?.retryAt && live.retryAt > now;
  const canNext = !!live && !!nextSection(live)?.tracks.length;
  const running = live?.phase === "playing" || live?.phase === "next_section_queued";
  const ask = (action: "go_now" | "restart" | "skip") => setConfirm({
    title: action === "go_now" ? "Start the next section now?" : action === "restart" ? "Restart track" : "Skip track",
    description: action === "go_now" ? live?.phase === "section_complete" ? `Start the first track of ${nextSection(live)?.name}.` : `Replace the current track immediately with the first track of ${live && nextSection(live)?.name}.` : action === "restart" ? "Restart the intended track from the beginning. This may replace audio already playing on the original device." : "Skip this track and continue the saved running order. If a section is queued, it starts instead.",
    command: { action, confirmed: true },
    snapshot: live,
  });
  const controls = live ? <div className="live-controls">
        {live.phase === "section_complete" ? <button className="primary-button" disabled={disabled || !canNext} onClick={() => ask("go_now")}>Start next section</button> : live.cue !== null ? <div className="cue-banner"><p className="eyebrow text-[var(--green)]">Next section queued</p><p className="mt-2 text-sm text-[var(--muted)]">{live.phase === "recovery" ? "Your cue is saved. Restart or skip the track to continue." : "The current track will finish before the next section starts."}</p><button className="secondary-button mt-5" disabled={busy || !fresh} onClick={() => void command({ action: "cancel" })}>Cancel cue</button></div> : <button className="primary-button min-w-44 justify-center disabled:opacity-40" disabled={disabled || live.phase !== "playing" || !canNext} onClick={() => void command({ action: "cue" })} aria-label="CUE NEXT">Cue next</button>}
        {live.phase !== "section_complete" && <button className="secondary-button" disabled={disabled || !canNext || !["playing", "next_section_queued"].includes(live.phase)} onClick={() => ask("go_now")}>Go now</button>}
        {running && <button className="secondary-button" disabled={disabled} onClick={() => void command({ action: live.observation?.isPlaying ? "pause" : "play" })}>{live.observation?.isPlaying ? "Pause" : "Resume"}</button>}
        {live.phase === "recovery" && <><button className="secondary-button" disabled={disabled} onClick={() => ask("restart")}>Restart track</button><button className="secondary-button" disabled={disabled} onClick={() => ask("skip")}>Skip track</button></>}
        <button className="ml-auto min-h-11 text-xs underline underline-offset-4 disabled:opacity-40" disabled={busy || !fresh} onClick={() => setConfirm({ title: "End session", description: "The current track keeps playing in Spotify. Segueway will stop starting tracks or changing sections.", command: { action: "end" }, snapshot: live })}>End session</button>
      </div> : null;
  return <>
    {error && <p role="alert" className="mb-6 rounded-lg border border-amber-800/20 bg-amber-50 p-5 text-sm leading-6 text-amber-950">{error}</p>}
    {!loaded ? <p role="status">Loading live playback...</p> : !live ? <section className="player-card live-setup p-7 sm:p-10"><p className="eyebrow text-[var(--green)]">Live setup</p><h2 className="track-title mt-4">Start section playback</h2>{storageError && <p role="alert" className="mt-5 text-sm">{storageError}</p>}{!library.events.length ? <p className="mt-6 text-sm leading-7">Create an event and add tracks in the <Link href="/events" className="underline">event editor</Link> first.</p> : <>
      <label className="mt-7 grid gap-2 text-sm">Event<select className="editor-input" value={eventId} onChange={event => { setEventId(event.target.value); setSection(0); setPrepared(false); }}>{library.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
      <label className="mt-5 grid gap-2 text-sm">Starting section<select className="editor-input" value={section} onChange={event => setSection(Number(event.target.value))}>{selected?.sections.map((section, index) => <option key={section.id} value={index} disabled={!section.tracks.length}>{index + 1}. {section.name} · {section.tracks.length} tracks · {section.playbackMode}</option>)}</select></label>
      <ol className="setup-sections" aria-label="Choose starting section">{selected?.sections.map((item, index) => <li key={item.id}><button aria-pressed={section === index} disabled={!item.tracks.length} onClick={() => setSection(index)}><span className="section-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.name}</strong><small>{item.tracks.length ? `${item.tracks.length} tracks` : "Add tracks in the editor"} · {item.playbackMode === "loop" ? "Loop" : "Once"}</small></span><span className="setup-selection">{section === index ? "Start here" : ""}</span></button></li>)}</ol>
      <p className="mt-6 text-sm leading-7 text-[var(--muted)]">Choose your device in Spotify. Remove manually queued tracks and switch off Autoplay and crossfade. Upcoming album or playlist tracks can remain. Segueway starts one track at a time and sets repeat and shuffle off before starting.</p>
      <label className="mt-5 flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--green)]" checked={prepared} onChange={event => setPrepared(event.target.checked)} />I have removed manually queued tracks and disabled Autoplay and crossfade in Spotify.</label>
      <button className="primary-button mt-7 disabled:opacity-40" disabled={disabled || !prepared || !selected?.sections[section]?.tracks.length} onClick={() => void command({ action: "start", event: selected, section, confirmed: prepared })}>Start section</button>
      <p className="live-footnote">Starting replaces current Spotify playback. This run uses a snapshot of your saved event; editor changes apply to the next run.</p>
    </>}</section> : <>
      <LiveStatus live={live} now={now}>{live.message && <div role="alert" className="mt-6 rounded-lg border border-amber-800/20 bg-amber-50 p-5 text-sm leading-7 text-amber-950">{live.message}{live.retryAt && live.retryAt > now && <p>Spotify cooldown: {Math.ceil((live.retryAt - now) / 1000)} seconds.</p>}</div>}{controls}</LiveStatus>

    </>}
    {confirm && <ConfirmAction title={confirm.title} description={confirm.description} onClose={() => setConfirm(null)} onConfirm={() => { const action = confirm.command; const snapshot = confirm.snapshot; setConfirm(null); void command(action, snapshot); }} />}
  </>;
}
