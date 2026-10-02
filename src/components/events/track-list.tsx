"use client";
import { useState } from "react";
import type { SectionTrack } from "@/lib/events/model";
import { formatDuration } from "@/lib/events/model";
import { Icon } from "../ui/icon";
import { useOrderMotion } from "../ui/use-order-motion";

export function TrackArtwork({ artwork, name }: { artwork: string | null; name: string }) {
  return artwork ? <img src={artwork} alt={`Album artwork for ${name}`} className="track-art" referrerPolicy="no-referrer" /> : <span aria-hidden="true" className="track-art art-placeholder"><Icon name="play" /></span>;
}
export function TrackList({ tracks, onMove, onRemove, onReorder }: { tracks: SectionTrack[]; onMove: (id: string, direction: -1 | 1) => void; onRemove: (id: string) => void; onReorder: (id: string, beforeId: string) => void }) {
  const root = useOrderMotion();
  const [over, setOver] = useState<string | null>(null);
  if (!tracks.length) return <div className="editor-empty"><Icon name="plus" size={24} /><h3>No tracks in this section</h3><p>Search Spotify to add your first track.</p></div>;
  return <ol ref={root} className="track-list" aria-label="Section tracks">{tracks.map((track, index) => <li data-order-id={track.entryId} key={track.entryId} className={`track-row ${over === track.entryId ? "drop-before" : ""}`} onDragOver={event => { if (event.dataTransfer.types.includes("text/segueway-track")) { event.preventDefault(); setOver(track.entryId); } }} onDragLeave={() => setOver(null)} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("text/segueway-track"); if (id) onReorder(id, track.entryId); setOver(null); }}>
    <button className="drag-handle" draggable aria-label={`Drag ${track.name}`} onDragStart={event => { event.dataTransfer.setData("text/segueway-track", track.entryId); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setOver(null)}><Icon name="grip" /></button><span className="track-number">{index + 1}</span><TrackArtwork artwork={track.artwork} name={track.name} />
    <div className="track-description"><strong>{track.name}</strong><span>{track.artists.join(", ")}</span><span className="track-album">{track.albumName}</span></div><span className="track-duration">{formatDuration(track.durationMs)}</span>
    <div className="row-actions"><button className="order-button" aria-label={`Move ${track.name} up`} disabled={index === 0} onClick={() => onMove(track.entryId, -1)}><Icon name="up" /></button><button className="order-button" aria-label={`Move ${track.name} down`} disabled={index === tracks.length - 1} onClick={() => onMove(track.entryId, 1)}><Icon name="down" /></button><button className="order-button remove-button" aria-label={`Remove ${track.name}`} onClick={() => onRemove(track.entryId)}><Icon name="close" /></button></div>
  </li>)}</ol>;
}
