"use client";
import { useState } from "react";
import { type Section, formatDuration } from "@/lib/events/model";
import { Icon } from "../ui/icon";
import { useOrderMotion } from "../ui/use-order-motion";

export function SectionList({ sections, selectedId, onSelect, onMove, onReorder }: { sections: Section[]; selectedId?: string; onSelect: (id: string) => void; onMove: (id: string, direction: -1 | 1) => void; onReorder: (id: string, beforeId: string) => void }) {
  const root = useOrderMotion();
  const [over, setOver] = useState<string | null>(null);
  return <ol ref={root} className="section-list" aria-label="Event sections">{sections.map((section, index) => <li data-order-id={section.id} key={section.id} className={`section-row ${selectedId === section.id ? "is-selected" : ""} ${over === section.id ? "drop-before" : ""}`} onDragOver={event => { if (event.dataTransfer.types.includes("text/segueway-section")) { event.preventDefault(); setOver(section.id); } }} onDragLeave={() => setOver(null)} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("text/segueway-section"); if (id) onReorder(id, section.id); setOver(null); }}>
    <button className="drag-handle" draggable aria-label={`Drag section ${section.name}`} onDragStart={event => { event.dataTransfer.setData("text/segueway-section", section.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setOver(null)}><Icon name="grip" /></button>
    <button aria-label={`Edit section ${section.name}`} aria-current={selectedId === section.id ? "true" : undefined} onClick={() => onSelect(section.id)} className="section-select"><span className="section-number">{String(index + 1).padStart(2, "0")}</span><span className="section-label"><strong>{section.name}</strong><span>{section.tracks.length ? `${section.tracks.length} ${section.tracks.length === 1 ? "track" : "tracks"} · ${formatDuration(section.tracks.reduce((sum, track) => sum + track.durationMs, 0))}` : "No tracks yet"}</span><span className="mode-label"><Icon name={section.playbackMode === "loop" ? "loop" : "arrow"} size={13} />{section.playbackMode === "loop" ? "Loop" : "Once"}</span></span></button>
    <div className="row-actions"><button className="order-button" aria-label={`Move section ${section.name} up`} disabled={index === 0} onClick={() => onMove(section.id, -1)}><Icon name="up" /></button><button className="order-button" aria-label={`Move section ${section.name} down`} disabled={index === sections.length - 1} onClick={() => onMove(section.id, 1)}><Icon name="down" /></button></div>
  </li>)}</ol>;
}
