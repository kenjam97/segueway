"use client";
import Link from "next/link";
import { useState } from "react";
import { useEvents } from "@/lib/events/use-events";
import { NameForm } from "./name-form";
import { SectionList } from "./section-list";
import { SectionEditor } from "./section-editor";

export function EventEditor({ connected }: { connected: boolean }) {
  const state = useEvents();
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [creatingSection, setCreatingSection] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [selection, setSelection] = useState<{ eventId: string; sectionId: string } | null>(null);
  const event = state.library.events.find(item => item.id === state.library.activeEventId);
  const section = event?.sections.find(item => selection?.eventId === event.id && item.id === selection.sectionId) ?? event?.sections[0];
  if (state.loadError) return <div role="alert" className="player-card p-8"><p>{state.loadError}</p><button className="secondary-button mt-4" onClick={state.load}>Retry loading</button></div>;
  if (!state.loaded) return <p role="status" className="py-10 text-sm text-[var(--muted)]">Loading events...</p>;
  return <div>
    <div className="editor-toolbar"><div className="flex flex-wrap items-center gap-3">{state.library.events.length > 0 && <select className="editor-input" value={event?.id ?? ""} onChange={change => { state.dispatch({ type: "select-event", id: change.target.value }); setCreatingSection(false); setRenaming(false); }} aria-label="Your events">{state.library.events.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<button className="text-button" onClick={() => setCreatingEvent(true)}>New event</button></div><p role="status" className={`save-status ${state.saveError ? "save-error" : ""}`}>{state.saveError ? "Changes not saved" : state.saved ? "Saved in this browser" : "Saving..."}</p></div>
    {state.saveError && <div role="alert" className="notice"><p>{state.saveError}</p><button className="secondary-button mt-3" onClick={state.retrySave}>Retry saving</button></div>}
    {creatingEvent && <div className="player-card mb-6 p-6"><NameForm label="New event name" submitLabel="Create event" onCancel={() => setCreatingEvent(false)} onSave={name => { state.dispatch({ type: "create-event", id: crypto.randomUUID(), name }); setCreatingEvent(false); setCreatingSection(false); setRenaming(false); }} /></div>}
    {!event ? <div className="editor-empty player-card"><h2 className="track-title">Create an event</h2><p>Add sections, then choose the tracks for each one.</p><button className="primary-button mt-6" onClick={() => setCreatingEvent(true)}>Create your first event</button></div> : <>
      <section className="event-heading" aria-label="Event details"><div><p className="eyebrow">Event</p><h2>{event.name}</h2><p>{event.sections.length} {event.sections.length === 1 ? "section" : "sections"} · {event.sections.reduce((sum, section) => sum + section.tracks.length, 0)} tracks</p></div><div className="flex flex-wrap gap-3"><button className="text-button" onClick={() => setRenaming(true)}>Rename event</button><Link className="secondary-button" href="/live">Open live mode</Link></div>{renaming && <div className="w-full"><NameForm label="Event name" initial={event.name} onCancel={() => setRenaming(false)} onSave={name => { state.dispatch({ type: "rename-event", id: event.id, name }); setRenaming(false); }} /></div>}</section>
      <div className="editor-workspace"><aside className="editor-sidebar" aria-label="Section order"><div className="sidebar-heading"><h2>Sections</h2><button className="text-button" onClick={() => setCreatingSection(true)}>Add section</button></div>
        {creatingSection && <div className="section-create"><NameForm label="New section name" submitLabel="Create section" onCancel={() => setCreatingSection(false)} onSave={name => { const id = crypto.randomUUID(); state.dispatch({ type: "create-section", eventId: event.id, id, name }); setSelection({ eventId: event.id, sectionId: id }); setCreatingSection(false); }} /></div>}
        <SectionList sections={event.sections} selectedId={section?.id} onSelect={id => setSelection({ eventId: event.id, sectionId: id })} onReorder={(sectionId, beforeId) => state.dispatch({ type: "reorder-section", eventId: event.id, sectionId, beforeId })} onMove={(sectionId, direction) => state.dispatch({ type: "move-section", eventId: event.id, sectionId, direction })} />
        {!event.sections.length && <p className="sidebar-empty">Add a section to start planning your event.</p>}
      </aside>
      {section ? <SectionEditor key={event.id + section.id} section={section} eventId={event.id} position={event.sections.indexOf(section)} connected={connected} dispatch={state.dispatch} /> : <div className="editor-empty player-card"><h2 className="track-title">Add your first section</h2><p>For example, Guests Arriving or Ceremony Entrance.</p><button className="primary-button mt-5" onClick={() => setCreatingSection(true)}>Add section</button></div>}
      </div>
    </>}
    {state.undoLabel && <div className="undo-toast" role="status"><span>{state.undoLabel}</span><button onClick={state.undo}>Undo</button></div>}
    <p className="editor-footnote">Saved on this device. Changes apply the next time you start live mode.</p>
  </div>;
}
