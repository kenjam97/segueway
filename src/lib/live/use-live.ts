"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { liveClient, type ClientCommand } from "./client";
import type { LiveState } from "./machine";
import { PlayerError } from "@/lib/player-client";

export function useLive(connected: boolean) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [now, setNow] = useState(Date.now);
  const lock = useRef(false);
  const generation = useRef(0);
  const retryAt = useRef(0);
  const reading = useRef(false);
  const read = useCallback(async () => {
    if (lock.current || reading.current || Date.now() < retryAt.current) return;
    reading.current = true;
    const version = generation.current;
    try {
      const result = await liveClient.read();
      if (version !== generation.current) return;
      setLive(result); setLoaded(true); setFresh(true);
      setConnectionError(null);
    } catch (failure) {
      if (version !== generation.current) return;
      setFresh(false); setConnectionError(failure instanceof Error ? failure.message : "Live connection lost.");
      if (failure instanceof PlayerError && failure.retryAfter) retryAt.current = Date.now() + failure.retryAfter * 1000;
    } finally { reading.current = false; }
  }, []);
  useEffect(() => {
    if (!connected) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => { await read(); if (!disposed) timer = setTimeout(tick, document.hidden ? 5000 : 1000); };
    void tick();
    const visible = () => { if (!document.hidden) void read(); };
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); generation.current++; };
  }, [connected, read]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  const command = async (action: ClientCommand, snapshot: LiveState | null = live) => {
    if (lock.current || !fresh) return;
    lock.current = true; generation.current++; setBusy(true); setError(null);
    try { setLive(await liveClient.command(action, snapshot, crypto.randomUUID())); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The command could not be confirmed. Review Spotify before trying again."); }
    finally { lock.current = false; setBusy(false); void read(); }
  };
  return { live, loaded, error: error ?? connectionError, busy, fresh, now, command };
}
