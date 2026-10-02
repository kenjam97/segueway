"use client";
import { useState } from "react";

export function NameForm({ label, initial = "", submitLabel = "Save name", onSave, onCancel }: { label: string; initial?: string; submitLabel?: string; onSave: (name: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState(initial);
  return <form onSubmit={event => { event.preventDefault(); if (name.trim()) onSave(name.trim()); }} className="flex flex-wrap items-end gap-3">
    <label className="min-w-0 flex-1 text-xs text-[var(--muted)]">{label}<input autoFocus className="editor-input mt-2 w-full" value={name} onKeyDown={event => { if (event.key === "Escape" && onCancel) { event.preventDefault(); onCancel(); } }} onChange={event => setName(event.target.value)} required maxLength={120} /></label>
    <button className="secondary-button" disabled={!name.trim() || (!onCancel && name.trim() === initial)}>{submitLabel}</button>
    {onCancel && <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>}
  </form>;
}
