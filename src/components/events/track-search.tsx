"use client";
import { useEffect, useRef, useState } from "react";
import type { Track } from "@/lib/events/model";
import { formatDuration } from "@/lib/events/model";
import { searchSpotify, SearchError } from "@/lib/search-client";
import { Icon } from "../ui/icon";
import { TrackArtwork } from "./track-list";

export function TrackSearch({ sectionName, onAdd, onClose }: { sectionName: string; onAdd: (track: Track) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [pageOffset, setPageOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const cooldownRef = useRef(0);
  const unauthorized = useRef(false);
  const quota = useRef(false);

  useEffect(() => {
    dialog.current?.showModal();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const term = query.trim();
    if (!term || unauthorized.current || quota.current || cooldownRef.current > Date.now()) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await searchSpotify(term, pageOffset, controller.signal);
        if (controller.signal.aborted) return;
        setResults(previous => pageOffset === 0 ? response.tracks : [...previous, ...response.tracks.filter(track => !previous.some(item => item.spotifyId === track.spotifyId))]);
        setNextOffset(response.nextOffset); setSearched(true); setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        const failure = cause instanceof SearchError ? cause : new SearchError(0, "Search could not be completed. Try again.");
        setError(failure);
        if (failure.status === 401) unauthorized.current = true;
        if (failure.status === 429) {
          cooldownRef.current = Date.now() + Math.max(1, failure.retryAfter) * 1000;
          setUntil(cooldownRef.current); setNow(Date.now()); quota.current = failure.quotaExceeded;
        }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 350);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, pageOffset, retry]);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  return <dialog ref={dialog} onCancel={onClose} className="search-dialog" aria-labelledby="search-title">
    <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] p-6"><div className="min-w-0"><p className="eyebrow">Spotify search</p><h2 id="search-title" className="mt-3 font-serif text-3xl">Add tracks</h2><p className="mt-2 break-words text-sm text-[var(--muted)]">To {sectionName}</p></div><button className="order-button" aria-label="Close track search" onClick={onClose}><Icon name="close" /></button></div>
    <div className="p-6"><label className="text-xs text-[var(--muted)]" htmlFor="spotify-search">Search Spotify by track or artist</label><input id="spotify-search" autoFocus maxLength={200} className="editor-input mt-2 w-full" placeholder="Track name or artist" value={query} onChange={event => { setQuery(event.target.value); setPageOffset(0); setResults([]); setNextOffset(null); setSearched(false); setLoading(false); }} />
      <p role="status" className="mt-3 text-xs text-[var(--muted)]">{announcement || (loading ? "Searching Spotify..." : "Select tracks to add them to this section.")}</p>
      {error && <div role="alert" className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-950"><p>{error.message}</p>{remaining > 0 && <p className="mt-2 text-xs">Retry available in {remaining} seconds.</p>}{error.quotaExceeded && <p className="mt-2 text-xs">Spotify's quota is exhausted. Search is paused until you retry.</p>}{error.status === 401 ? <a href="/api/auth/login" className="secondary-button mt-3 inline-flex">Reconnect Spotify</a> : <button className="secondary-button mt-3" disabled={remaining > 0 || !query.trim()} onClick={() => { quota.current = false; setRetry(value => value + 1); }}>Retry search</button>}</div>}
      <ul className="mt-4 divide-y divide-[var(--line)]" aria-label="Spotify search results">{results.map(track => <li key={track.spotifyId} className="flex flex-wrap items-center gap-3 py-4"><TrackArtwork artwork={track.artwork} name={track.name} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{track.name}</p><p className="mt-1 break-words text-xs text-[var(--muted)]">{track.artists.join(", ")}</p><p className="mt-1 text-xs text-[var(--muted)]">{formatDuration(track.durationMs)}</p></div><button className="secondary-button" disabled={added.has(track.spotifyId)} aria-label={`Add ${track.name}`} onClick={() => { onAdd(track); setAdded(previous => new Set(previous).add(track.spotifyId)); setAnnouncement(`${track.name} added to ${sectionName}.`); }}>{added.has(track.spotifyId) ? "Added" : "Add"}</button></li>)}</ul>
      {searched && !results.length && !loading && !error && <p className="py-8 text-center text-sm text-[var(--muted)]">No tracks found. Try another title or artist.</p>}
      {nextOffset !== null && <button className="secondary-button mt-4 w-full" disabled={loading || remaining > 0 || !!error} onClick={() => setPageOffset(nextOffset)}>Load more</button>}
    </div>
  </dialog>;
}
