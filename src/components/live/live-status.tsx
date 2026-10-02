"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { currentTrack, type LiveState } from "@/lib/live/machine";
import { livePresentation } from "@/lib/live/presentation";
import { formatDuration } from "@/lib/events/model";
import { Icon } from "../ui/icon";

function Rundown({ live }: { live: LiveState }) {
  const [expanded, setExpanded] = useState<number | null>(live.cursor.section);
  useEffect(() => setExpanded(live.cursor.section), [live.cursor.section]);
  return <aside className="live-rundown" aria-label="Event running order"><div className="sidebar-heading"><h2>Running order</h2><span>{live.event.sections.length} sections</span></div><ol>{live.event.sections.map((section, index) => {
    const current = index === live.cursor.section;
    const queued = index === live.cue || index === live.pending?.target.section && !current;
    return <li key={section.id} className={`rundown-section ${current ? "is-current" : ""} ${queued ? "is-queued" : ""}`}><button className="rundown-select" onClick={() => setExpanded(expanded === index ? null : index)} aria-expanded={expanded === index}><span className="section-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{section.name}</strong><small>{current ? "Current section" : queued ? "Queued" : `${section.tracks.length} tracks`} · {section.playbackMode === "loop" ? "Loop" : "Once"}</small></span><Icon name="down" size={14} /></button>{expanded === index && <ol className="rundown-tracks">{section.tracks.map((track, trackIndex) => <li key={track.entryId} aria-current={current && trackIndex === live.cursor.track ? "true" : undefined}><span>{current && trackIndex === live.cursor.track ? <Icon name="play" size={12} /> : trackIndex + 1}</span><span>{track.name}</span><small>{formatDuration(track.durationMs)}</small></li>)}{!section.tracks.length && <li>No tracks</li>}</ol>}</li>;
  })}</ol><p className="rundown-note">This is the event saved when you started. Edits apply to your next session.</p></aside>;
}


function SectionRecord({ artwork, number, spinning = false }: { artwork?: string | null; number: number; spinning?: boolean }) {
  return <div className={`section-record ${spinning ? "is-spinning" : ""}`} aria-hidden="true">
    <div className="section-record-grooves"><div className="section-record-label">
      {artwork ? <img src={artwork} alt="" referrerPolicy="no-referrer" /> : <><span>segueway</span><strong>{String(number).padStart(2, "0")}</strong></>}
    </div></div>
    <span className="section-record-spindle" />
  </div>;
}

function CurrentSection({ live, now }: { live: LiveState; now: number }) {
  const section = live.event.sections[live.cursor.section];
  const observed = live.observation;
  const track = observed?.track;
  const intended = currentTrack(live);
  const view = livePresentation(live, now);
  return <section className="current-section-card" aria-label="Current section"><div className="current-section-heading"><p className="eyebrow">Current section <span>{String(live.cursor.section + 1).padStart(2, "0")}</span></p><span className="live-mode"><Icon name={section.playbackMode === "loop" ? "loop" : "arrow"} size={14} />{section.playbackMode === "loop" ? "Loop" : "Once"}</span></div><h2 className="current-section-title">{section.name}</h2>
      <div key={live.cursor.occurrence} className="live-track panel-enter"><SectionRecord artwork={track?.artwork} number={live.cursor.section + 1} spinning={!!observed?.isPlaying && live.phase !== "recovery" && live.phase !== "section_complete"} /><div className="live-track-description"><p className="eyebrow">Track {live.cursor.track + 1} of {section.tracks.length}</p><h3>{track?.name ?? "Waiting for Spotify"}</h3><p>{track?.artist ?? "No track reported"}</p></div></div>
      <div className="live-progress" role="progressbar" aria-label="Playback progress" aria-valuemin={0} aria-valuemax={view.duration || 1} aria-valuenow={view.progress} aria-valuetext={`${formatDuration(view.progress)} of ${formatDuration(view.duration)}`}><span style={{ width: `${view.duration ? view.progress / view.duration * 100 : 0}%` }} /></div><div className="live-times"><span>{formatDuration(view.progress)}</span><span>{formatDuration(view.duration)}</span></div>{view.nextTrack && !view.leavesSection && (!live.pending || live.pending.target.section === live.cursor.section) && <div className="next-track-preview"><span>Next track</span><strong>{view.nextTrack.name}</strong></div>}<div className="live-device"><span className="status-dot" />{observed?.device?.name ?? "Device unavailable"}</div>
      {live.pending && <p className="live-track-note">Starting {view.nextTrack?.name}</p>}{live.phase === "recovery" && <p className="live-track-note">Expected track: {intended.name}</p>}
    </section>;
}

type SectionSnapshot = { live: LiveState; now: number };

function SectionDeck({ live, now }: SectionSnapshot) {
  const last = useRef<SectionSnapshot>({ live, now });
  const [outgoing, setOutgoing] = useState<SectionSnapshot | null>(null);
  // Keep the last confirmed section underneath the incoming one. Polling, cues,
  // and track changes within a section must not replay the section entrance.
  useLayoutEffect(() => {
    if (last.current.live.runId !== live.runId) setOutgoing(null);
    else if (last.current.live.cursor.section !== live.cursor.section) {
      setOutgoing(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? null : last.current);
    }
    last.current = { live, now };
  }, [live, now]);
  useEffect(() => {
    if (!outgoing) return;
    // Also clean up if animations are disabled or the tab is backgrounded.
    const timer = window.setTimeout(() => setOutgoing(null), 1400);
    return () => window.clearTimeout(timer);
  }, [outgoing]);
  return <div className={`section-deck ${outgoing ? "is-changing" : ""}`}>
    {outgoing && <div key={`out-${outgoing.live.cursor.section}`} className="section-deck-outgoing" aria-hidden="true" inert><CurrentSection {...outgoing} /></div>}
    <div key={`${live.runId}-${live.cursor.section}`} className="section-deck-current" onAnimationEnd={event => {
      if (event.target === event.currentTarget && event.animationName === "jukebox-section-in") setOutgoing(null);
    }}><CurrentSection live={live} now={now} /></div>
  </div>;
}

export function LiveStatus({ live, now, children }: { live: LiveState; now: number; children?: ReactNode }) {
  const section = live.event.sections[live.cursor.section];
  const observed = live.observation;
  const view = livePresentation(live, now);
  const stateText = live.endCandidate ? "Checking track end" : live.phase === "next_section_queued" ? "Next section queued" : live.phase === "playing" ? observed?.isPlaying ? "Playing" : "Paused" : live.phase === "section_complete" ? "Section complete" : live.phase === "transitioning" ? "Starting next track" : live.phase === "recovery" ? "Playback needs attention" : "Ready";
  return <><div className="live-event-heading"><h2>{live.event.name}</h2><span role="status" className={`live-state ${live.phase === "recovery" ? "needs-attention" : ""}`}><span className="status-dot" />{stateText}</span></div><div className="live-workspace"><Rundown live={live} /><div className="live-stage">
    <SectionDeck live={live} now={now} />
    {children}
    <section className={`incoming-section ${view.imminent ? "is-approaching" : ""} ${live.cue !== null ? "is-cued" : ""}`} aria-label="Next section"><div className="incoming-accent" />{view.incoming && <div className="incoming-record"><SectionRecord artwork={view.incoming.tracks[0]?.artwork} number={live.event.sections.indexOf(view.incoming) + 1} /></div>}<div className="incoming-content"><div className="incoming-label"><p className="eyebrow">{live.cue !== null ? "Queued section" : "Next section"}</p><span>{view.imminent ? live.pending || live.endCandidate ? "Starting shortly" : "After this track" : view.incoming ? String(live.event.sections.indexOf(view.incoming!) + 1).padStart(2, "0") : ""}</span></div><h2>{view.incoming?.name ?? "End of event"}</h2><p>{!view.incoming ? "Playback stops after the final track." : live.phase === "recovery" ? "Recover playback before continuing." : live.cue !== null ? "Starts when the current track finishes." : section.playbackMode === "loop" ? "Cue this section when you are ready." : "Start this section when you are ready."}</p></div><Icon name="arrow" size={24} /></section>
  </div></div></>;
}
