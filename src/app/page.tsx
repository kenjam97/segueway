import { cookies } from "next/headers";
import { isConfigured } from "@/lib/server/config";
import { getSession, SESSION_COOKIE } from "@/lib/server/store";
import { Player } from "@/components/player";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const authErrors: Record<string, string> = {
  denied: "Spotify connection was cancelled. You can try again whenever you're ready.",
  state: "That login link expired or could not be verified. Start a new connection below.",
  failed: "We couldn't connect to Spotify. Check the app credentials and callback URL, then try again.",
  rate: "Spotify is limiting requests. Wait a little before connecting again.",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ authError?: string }> }) {
  const configured = isConfigured();
  const connected = configured && !!getSession((await cookies()).get(SESSION_COOKIE)?.value);
  const params = await searchParams;
  const authError = params.authError ? authErrors[params.authError] : null;
  return <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 sm:px-10">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] py-7">
      <a href="/" className="flex items-center gap-3" aria-label="Segueway home"><span className="brand-mark">s.</span><span className="text-xl font-semibold tracking-tight">segueway<span className="text-[var(--green)]">.</span></span></a>
      <div className="flex flex-wrap items-center gap-5"><nav aria-label="Main navigation" className="flex gap-5 text-xs"><Link href="/" aria-current="page" className="border-b border-[var(--green)] py-3 font-semibold">Playback</Link><Link href="/events" className="py-3 text-[var(--muted)]">Event editor</Link><Link href="/live" className="py-3 text-[var(--muted)]">Live mode</Link></nav>{connected && <form action="/api/auth/logout" method="post"><button className="min-h-10 text-xs text-[var(--muted)] underline-offset-4 hover:underline">Disconnect Spotify</button></form>}</div>
    </header>

    <div className="page-heading"><h1>Spotify playback</h1><p>Control playback on your connected Spotify device.</p></div>

    {authError && <p role="alert" className="mb-5 rounded-lg border border-amber-800/15 bg-amber-50 p-4 text-sm text-amber-950">{authError}</p>}
    {connected ? <Player /> : <section className="player-card grid overflow-hidden md:grid-cols-[1fr_1.1fr]">
      <div className="welcome-art flex min-h-72 items-center justify-center p-10"><div className="record"><div className="record-label"><span className="font-serif text-5xl italic">s.</span><span className="mt-2 text-[9px] uppercase tracking-[0.2em]">Segueway</span></div></div></div>
      <div className="flex flex-col justify-center p-8 sm:p-12"><span className="eyebrow">Spotify account</span><h2 className="track-title mt-4">Connect Spotify</h2><p className="mt-5 text-sm leading-7 text-[var(--muted)]">Connect your Spotify account to see what's playing and control the music on your existing device.</p>{configured ? <a className="primary-button mt-7 self-start" href="/api/auth/login"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="11" /><path d="M6 9c4-1.2 8-1 12 1M7 12c3.5-.8 6.5-.5 10 1M8 15c2.5-.5 5-.2 8 .7" fill="none" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" /></svg>Connect with Spotify<span aria-hidden="true">↗</span></a> : <div role="status" className="mt-7 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-4"><p className="text-sm font-medium">Spotify setup needed</p><p className="mt-2 text-xs leading-6 text-[var(--muted)]">Add your Spotify app credentials to .env.local using .env.example, then restart the app. The README walks you through setup.</p></div>}<p className="mt-4 text-xs text-[var(--muted)]">Spotify Premium required for playback controls.</p></div>
    </section>}

    <div className="mt-6 flex items-start gap-3 px-1 text-xs leading-6 text-[var(--muted)]"><span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[10px]">i</span><p>Choose your speaker or device in Spotify. Segueway follows the active device and keeps playback in Spotify.</p></div>
    <footer className="mt-auto flex flex-wrap justify-between gap-3 pb-7 pt-12 text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]"><span>Segueway</span><a href="https://www.spotify.com" target="_blank" rel="noreferrer" className="hover:text-[var(--green)]">Music via Spotify ↗</a></footer>
  </main>;
}
