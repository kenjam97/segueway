"use client";
import { useEffect, useRef } from "react";

export function ConfirmAction({ title, description, onConfirm, onClose }: { title: string; description: string; onConfirm: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); const element = dialog.current; return () => element?.close(); }, []);
  return <dialog ref={dialog} className="search-dialog p-7 sm:p-10" onCancel={onClose} aria-labelledby="live-confirm-title"><h2 id="live-confirm-title" className="track-title mt-4">{title}</h2><p className="mt-5 text-sm leading-7 text-[var(--muted)]">{description}</p><div className="mt-7 flex flex-wrap gap-3"><button autoFocus className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={onConfirm}>{title === "Start the next section now?" ? "Start next section" : title}</button></div></dialog>;
}
