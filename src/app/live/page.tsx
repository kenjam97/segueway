import Link from "next/link";
import { cookies } from "next/headers";
import { isConfigured } from "@/lib/server/config";
import { getSession, SESSION_COOKIE } from "@/lib/server/store";
import { LiveController } from "@/components/live/live-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function LivePage() {
  const connected = isConfigured() && !!getSession((await cookies()).get(SESSION_COOKIE)?.value);
  return <main className="mx-auto min-h-screen max-w-7xl px-5 pb-12 sm:px-10"><header className="flex flex-wrap items-center justify-between gap-5 border-b border-[var(--line)] py-7"><Link href="/" className="flex items-center gap-3" aria-label="Segueway home"><span className="brand-mark">s.</span><span className="text-xl font-semibold tracking-tight">segueway<span className="text-[var(--green)]">.</span></span></Link><nav aria-label="Main navigation" className="flex gap-5 text-xs"><Link href="/" className="py-3 text-[var(--muted)]">Playback</Link><Link href="/events" className="py-3 text-[var(--muted)]">Event editor</Link><Link href="/live" aria-current="page" className="border-b border-[var(--green)] py-3 font-semibold">Live mode</Link></nav></header><div className="page-heading"><h1>Live mode</h1><p>Cue the next section while the current track finishes.</p></div><LiveController connected={connected} /></main>;
}
