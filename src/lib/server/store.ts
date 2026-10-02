import "server-only";
import { randomBytes, createHash } from "node:crypto";

export const SESSION_COOKIE = "segueway_session";
export const STATE_COOKIE = "segueway_oauth";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
export const SCOPES = ["user-read-playback-state", "user-read-currently-playing", "user-modify-playback-state"] as const;

export interface Tokens { accessToken: string; refreshToken: string; expiresAt: number }
export interface Session {
  tokens: Tokens;
  expiresAt: number;
  refresh?: Promise<void>;
  commands?: Promise<void>;
}

interface Store {
  sessions: Map<string, Session>;
  states: Map<string, number>;
  cooldownUntil: number;
  quotaExceeded: boolean;
}
// One process, shared across route bundles and development hot reloads.
const globalStore = globalThis as typeof globalThis & { seguewayStore?: Store };
export const store = globalStore.seguewayStore ??= {
  sessions: new Map(), states: new Map(), cooldownUntil: 0, quotaExceeded: false,
};
const key = (id: string) => createHash("sha256").update(id).digest("hex");

function cleanup() {
  const now = Date.now();
  for (const [id, session] of store.sessions) if (session.expiresAt <= now) store.sessions.delete(id);
  for (const [id, expiry] of store.states) if (expiry <= now) store.states.delete(id);
}

export function createState() {
  cleanup();
  if (store.states.size >= 1000) throw new Error("Too many pending logins.");
  const state = randomBytes(32).toString("base64url");
  store.states.set(key(state), Date.now() + 600_000);
  return state;
}

export function consumeState(state: string) {
  const id = key(state);
  const expiry = store.states.get(id);
  store.states.delete(id);
  return !!expiry && expiry > Date.now();
}

export function createSession(tokens: Tokens) {
  cleanup();
  if (store.sessions.size >= 1000) throw new Error("Too many sessions.");
  const id = randomBytes(32).toString("base64url");
  store.sessions.set(key(id), { tokens, expiresAt: Date.now() + SESSION_SECONDS * 1000 });
  return id;
}

export function getSession(id?: string): Session | null {
  if (!id) return null;
  const session = store.sessions.get(key(id));
  if (!session || session.expiresAt <= Date.now()) { store.sessions.delete(key(id)); return null; }
  return session;
}

export function deleteSession(id?: string) { if (id) store.sessions.delete(key(id)); }

export function cookieOptions(secure: boolean, maxAge = SESSION_SECONDS) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge };
}
