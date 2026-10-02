import Link from "next/link";
import { cookies } from "next/headers";
import { isConfigured } from "@/lib/server/config";
import { getSession, SESSION_COOKIE } from "@/lib/server/store";
import { EventEditor } from "@/components/events/event-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function EventsPage() {
  const connected = isConfigured() && !!getSession((await cookies()).get(SESSION_COOKIE)?.value);
  return <main className="mx-auto min-h-screen max-w-7xl px-5 pb-10 sm:px-10"><header className="flex flex-wrap items-center justify-between gap-5 border-b border-[var(--line)] py-7"><Link href="/" className="flex items-center gap-3" aria-label="Segueway home"><span className="brand-mark">s.</span><span className="text-xl font-semibold tracking-tight">segueway<span className="text-[var(--green)]">.</span></span></Link><nav aria-label="Main navigation" className="flex gap-6 text-xs"><Link href="/" className="py-3 text-[var(--muted)]">Playback</Link><Link href="/events" aria-current="page" className="border-b border-[var(--green)] py-3 font-semibold">Event editor</Link><Link href="/live" className="py-3 text-[var(--muted)]">Live mode</Link></nav></header><div className="page-heading"><h1>Events</h1><p>Arrange sections and choose their tracks.</p></div><EventEditor connected={connected} /></main>;
}
