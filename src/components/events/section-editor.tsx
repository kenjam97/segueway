"use client";
import { useState } from "react";
import type { Section } from "@/lib/events/model";
import { formatDuration } from "@/lib/events/model";
import type { EventAction } from "@/lib/events/reducer";
import { NameForm } from "./name-form";
import { TrackList } from "./track-list";
import { TrackSearch } from "./track-search";
import { Icon } from "../ui/icon";

export function SectionEditor({ section, eventId, position, connected, dispatch }: { section: Section; eventId: string; position: number; connected: boolean; dispatch: (action: EventAction) => void }) {
  const [searching, setSearching] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const address = { eventId, sectionId: section.id };
  return <section className="section-editor panel-enter" aria-label="Section editor">
    <header className="section-editor-header"><div><p className="eyebrow">Section {String(position + 1).padStart(2, "0")}</p><h2 className="track-title mt-3 break-words">{section.name}</h2><p className="section-meta">{section.tracks.length} {section.tracks.length === 1 ? "track" : "tracks"} · {formatDuration(section.tracks.reduce((total, track) => total + track.durationMs, 0))}</p></div><button className="text-button" onClick={() => setRenaming(true)}>Rename section</button></header>
    {renaming && <div className="rename-form"><NameForm label="Section name" initial={section.name} onCancel={() => setRenaming(false)} onSave={name => { dispatch({ type: "rename-section", ...address, name }); setRenaming(false); }} /></div>}
    <fieldset className="mode-picker"><legend>After this section</legend><div className="mode-options">{(["once", "loop"] as const).map(mode => <label key={mode} className={`mode-option ${section.playbackMode === mode ? "is-selected" : ""}`}><input type="radio" aria-label={mode === "once" ? "Once" : "Loop"} name={`mode-${section.id}`} value={mode} checked={section.playbackMode === mode} onChange={() => dispatch({ type: "set-mode", ...address, mode })} /><span><strong>{mode === "once" ? "Once" : "Loop"}</strong><span>{mode === "once" ? "Stop after the final track" : "Repeat until you cue the next section"}</span></span><Icon name={mode === "loop" ? "loop" : "arrow"} /></label>)}</div></fieldset>
    <div className="tracks-heading"><h3>Tracks <span>{section.tracks.length}</span></h3>{connected ? <button className="primary-button" onClick={() => setSearching(true)}><Icon name="plus" />Add track</button> : <a href="/api/auth/login" className="secondary-button">Connect Spotify to add tracks</a>}</div>
    <TrackList tracks={section.tracks} onReorder={(entryId, beforeId) => dispatch({ type: "reorder-track", ...address, entryId, beforeId })} onMove={(entryId, direction) => dispatch({ type: "move-track", ...address, entryId, direction })} onRemove={entryId => dispatch({ type: "remove-track", ...address, entryId })} />
    <footer className="section-editor-footer"><span>Drag to reorder, or use the arrows.</span><button className="text-button danger-text" onClick={() => dispatch({ type: "delete-section", ...address })}>Delete section</button></footer>
    {searching && <TrackSearch sectionName={section.name} onClose={() => setSearching(false)} onAdd={track => dispatch({ type: "add-track", ...address, track: { ...track, entryId: crypto.randomUUID() } })} />}
  </section>;
}
