# Segueway — milestones 1, 2 and 3

A small personal Spotify remote and event editor built with Next.js App Router, TypeScript, and Tailwind. Authenticate, view the current music track and device, and play/pause or skip tracks on the active Spotify Connect device. Build ordered event sections populated with Spotify tracks. No database, audio streaming, or Web Playback SDK.

## Event editor

Open `/events` or select **Event editor** in the navigation. Create an event such as Wedding, then add sections. Select a section to rename it, set Once/Loop, or add tracks. **Add track** searches Spotify using the connected account; results include artwork, artists and duration. **Load more** retrieves another page. Selecting a result only adds metadata to the event; it does not play audio or change Spotify.

Drag the handles to reorder sections and track entries, or use the up/down buttons with a keyboard or touch screen. Remove tracks or delete sections, then use **Undo** to restore the most recent removal. Undo is cleared by the next edit so it cannot overwrite newer changes. The same song can appear in multiple sections or be added again in a later search dialog; every occurrence has its own local ID.

Changes autosave to the versioned `segueway.events.v1` localStorage key. Events and selected event are restored on reload. This storage belongs to the current browser/device/origin; clearing browser storage removes it. Saved configuration can be edited while Spotify is disconnected. A storage write failure shows an unsaved warning and retry action; unreadable or incompatible stored data is preserved instead of overwritten.

Once/Loop is configured here and used in the dedicated **Live mode**. Section playback, CUE NEXT and confirmed GO NOW are described below.

Editor architecture:

- `src/lib/events/model.ts`: explicit Event, Section, Track, SectionTrack, and PlaybackMode domain types, separate from live playback types.
- `src/lib/events/reducer.ts`: pure ordered event/section/track updates.
- `src/lib/events/storage.ts` and `use-events.ts`: validated browser persistence and configuration state.
- `src/components/events/*`: event editor, section list/editor, track list, name forms, and isolated search dialog.
- `src/app/api/spotify/search/route.ts`: authenticated, validated track-only search through the existing typed server Spotify service. It reuses refresh and cooldown handling without additional scopes. Search is debounced, aborts stale requests, and supports ten-result pages.

## Run locally

For free hosted testing, use the Render setup below. Local development remains on port 3000.

## Deploy to Render Free

The root `render.yaml` creates one free Node web service in Frankfurt. It builds with `npm ci --include=dev && npm run build` and runs `npm run start:render`. That command binds to `0.0.0.0` and uses Render's `PORT` environment variable. The normal local start command stays on loopback.

1. Push this project to a GitHub or GitLab repository. Keep `.env.local` out of Git; it is already ignored.
2. In Render, create a **Blueprint** from that repository and select the Free service defined in `render.yaml`. Alternatively create a **Web Service**, runtime Node, Free plan, with the build and start commands above and Node version 22.
3. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in Render's environment settings using the existing Spotify app credentials. Set `SPOTIFY_REDIRECT_URI` to the service's actual public URL followed by `/api/auth/callback`, for example `https://YOUR-SERVICE.onrender.com/api/auth/callback`. Do not use the localhost callback in production. Blueprint creation prompts for these three values; if the assigned hostname differs, update the redirect value and redeploy before logging in.
4. Add that exact HTTPS callback URL in Spotify Developer Dashboard under the app's Redirect URIs. Keep the existing local callback too. Add your friend's Spotify account to the app's development user allowlist. Playback requires their Premium account and an available Spotify Connect device.
5. Visit the deployed URL, connect Spotify, create an event and test a Loop section, Cue next, and Once completion with explicit Start next section. Saved events belong to this browser and hosted origin; events saved on localhost do not automatically transfer to the hosted site or your friend's device.

Automatic deploys are off. Deploy updates manually between live sessions. Run only one service instance: authentication and playback state are held in memory. Render Free can sleep after 15 minutes without incoming traffic and can restart at any time. A sleep, restart or redeploy loses login sessions and the live runner; reconnect and start a new live session. Event configuration stays in the browser. This free deployment is for sharing and testing.

References: [Render Next.js deployment](https://render.com/docs/deploy-nextjs-app), [free service limits](https://render.com/docs/free), [Spotify redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

## Local setup

Requires Node.js 22+ and npm.

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Enable Web API. The development-mode app owner needs Spotify Premium; playback controls also require a Premium playback account.
2. Register this exact redirect URI: `http://127.0.0.1:3000/api/auth/callback`. Spotify does **not** accept `localhost` as a redirect URI.
3. In the dashboard's user management settings, add your friend's Spotify account to the allowlist. Development mode supports up to five authenticated users. Successful consent alone does not prove allowlist access: Spotify may subsequently return 403.
4. Copy `.env.example` to `.env.local`. Fill in the client ID and client secret. These are server-only values; never use a `NEXT_PUBLIC_` prefix or commit `.env.local`.
5. Run `npm install`, then `npm run dev`.
6. Open **http://127.0.0.1:3000**, connect Spotify, then open Spotify on the playback account, select a device, and start a music track.

For a production deployment, use HTTPS and set `SPOTIFY_REDIRECT_URI` to your exact registered `https://your-host/api/auth/callback`. Use one long-running Node process (`npm run build`, then `npm start`); bind/expose it through your HTTPS reverse proxy. This milestone's in-memory sessions are unsuitable for serverless functions, multiple replicas, or multiple Node workers. Register the production callback in Spotify too.

## Architecture

- `src/app/api/auth/*`: Authorization Code login, one-use random OAuth state validation, server-side code exchange, and CSRF-protected logout.
- `src/lib/server/store.ts`: process-local sessions holding access/refresh tokens, OAuth states, and a shared upstream cooldown. The browser receives a random opaque HttpOnly, SameSite=Lax cookie (Secure on HTTPS). Session IDs are hashed in the map. Sessions expire after seven days; restarting the process requires reconnecting. Secrets and tokens never enter client props, JSON responses, local storage, or browser JavaScript.
- `src/lib/server/spotify.ts`: typed Spotify API boundary. Refreshes 30 seconds before expiry, coalesces concurrent refreshes, saves rotated refresh tokens, retains the existing refresh token when Spotify omits a replacement, and retries a rejected access token once. Invalid/revoked refresh tokens require reconnecting.
- `src/app/api/playback/route.ts`: authenticated read and validated, same-origin POST controls. It returns a small normalized playback model. Commands target Spotify's active device and are serialized per session. Successful commands are not automatically repeated.
- `src/lib/player-client.ts`: typed browser-to-app boundary; the component never calls Spotify directly.
- `src/components/player.tsx`: polls every ten seconds while visible, uses a local clock for progress, disables unsupported controls, and reads authoritative state after commands. Polling slows on transient failures. No active device produces setup guidance. Ads, episodes, and missing tracks do not crash the music UI.

Only these scopes are requested:

```
user-read-playback-state
user-read-currently-playing
user-modify-playback-state
```

The playback-state endpoint already includes the current track, so there is no redundant request to the currently-playing endpoint. No profile or playlist scopes are requested.

## Errors and rate limits

401 clears the local session and offers reconnecting. 403 explains Premium, allowlisting, permission, and restricted-device checks. 404 explains how to activate a Spotify device. Network failures and upstream failures produce a retryable message without exposing upstream secrets.

429 honors `Retry-After` and blocks further calls from this server process until the cooldown expires; the UI disables controls during that period. Missing headers use a conservative 60-second fallback. `QUOTA_EXCEEDED` uses a one-hour fallback when no header exists, and stops automatic updates until manual Refresh. This fallback does not claim to know Spotify's quota reset time. Commands are never automatically replayed on 429 or network errors because skips could be duplicated.

## Verify

```
npm run typecheck
npm test
npm run build
```

Automated tests mock Spotify and cover refresh/rotation/concurrency, 401 retry bounds, revoked grants, 429 cooldown and quota errors, command methods, normalization, OAuth mismatch/denial/replay, session expiry, cookie flags, CSRF, and logout.

`tests/browser-smoke.cjs` additionally exercises the production app in a browser with test-only mocked Spotify consent and API responses: setup, all four controls, logout, no-device state, rate limits, quota exhaustion, event creation/renaming, section creation/ordering/deletion/modes, track search/pagination/addition/ordering/removal, reload persistence, and mobile overflow. Build first, ensure port 3100 is free (or set `TEST_PORT`), install Playwright separately if needed, and run `node tests/browser-smoke.cjs`. Set `PLAYWRIGHT_MODULE` to a module path and `BROWSER_EXECUTABLE` to an existing browser executable when using a bundled runtime. Screenshots go to ignored `test-results/`. Never preload `tests/mock-spotify.cjs` in a real deployment.

Live acceptance checklist (requires real credentials and a Premium Spotify account):

1. Consent requests only the three playback scopes; callback returns to the player.
2. Start a track on a Connect device; confirm name, artist, artwork, progress, and device.
3. Pause, resume, previous, and next work and converge to Spotify's state.
4. Close/stop all active devices; confirm the useful empty state.
5. Leave the session active past access-token expiry; confirm playback still refreshes.
6. Disconnect; playback API returns 401. Restarting the server also requires login again.

## Milestone 3: event live mode

Open **Live mode** (`/live`), select a saved event and starting section, prepare Spotify, then press **Start section**. Event configuration stays in localStorage; the server holds only a frozen, process-local snapshot for the active run. No database, playback SDK, or playlists have been added.

Remove manually queued tracks and disable Autoplay and crossfade in the Spotify app before starting. Segueway sets repeat and shuffle off, verifies both, and pins the active unrestricted device. These settings are not automatically restored when ending automation. Spotify's queue response does not identify the origin of upcoming tracks, so a non-empty queue does not block startup or disable live controls. Segueway submits one URI and reconciles actual playback; an unexpected playing track suspends automation. It cannot remove manually queued songs, so clear those in Spotify before a run.

The runner sends exactly one URI at a time. Loop sections wrap until cued. Once sections play their tracks in order, then stop and wait for the operator to activate the next section using **Start next section** and its confirmation. The final Once section stops at the end of the event. Empty next sections cannot be started. **Cue next** explicitly schedules the next section at the current track's confirmed end, including during Once sections. **Cancel cue** restores normal section playback and the wait at the end of a Once section. **Go now** requires confirmation and immediately replaces playback. Pause/resume preserve cues; seeking recalculates observations. Editor changes apply to the next run.

Architecture:

- `src/lib/live/machine.ts`: pure typed reducer, occurrence cursor, cue/transition/recovery guards, adaptive observation scheduling, and transition timing.
- `src/lib/server/live.ts`: one server runner, shared cached observations, a serialized command/reconciliation queue, request deduplication and run/revision checks. Existing remote skips suspend automation; pause/resume preserve it.
- `src/lib/server/spotify.ts`: typed device preparation and single-URI commands through the existing token refresh/rate-limit service.
- `/api/live`: authenticated, same-origin commands and cached state reads. Configuration uploads are validated and limited to 500KB, 100 sections, and 500 tracks per section.
- `src/lib/live/client.ts`, `use-live.ts`, and `src/components/live/`: typed browser service, live UI state, status display, setup selection, and deliberate confirmations. The editor remains separate.

Keep one persistent Node process running (`npm run dev`, or `npm run build` followed by `npm start`). The server reconciles independently of browser timers, so backgrounding or closing a tab does not stop automation. Reopening the page reads the current run. A server restart loses the run and authentication; reconnect and explicitly start a section. Multiple Node workers/serverless deployment are not supported by this process-local design. **End session** cancels future runner actions and leaves the current Spotify audio playing.

### Adaptive observations and recovery

Spotify documents a rolling 30-second API rate window, without a universal numeric allowance. Normal reconciliation is every 10 seconds. Within approximately 15 seconds of the projected end it shortens to 2 seconds; within 3 seconds it uses a 750ms burst, bounded to 8 seconds. Start confirmation reads use 750ms, with a 12-second confirmation deadline. Timers never advance tracks. Projections use actual `duration_ms`, `progress_ms`, `is_playing` and local observation times; pauses invalidate the projection, seeks recalculate it, and stale progress cannot prolong a burst indefinitely. Browser status requests read the runner cache and do not add Spotify requests.

429 immediately suspends automation and honors the shared `Retry-After` cooldown. Network/API errors suspend automation instead of advancing. Accepted or uncertain start commands are never retried automatically: the runner looks for a fresh timestamp, intended URI, playing state and reset progress. Duplicate URIs need a fresh provider timestamp to confirm the new occurrence. A late/missing confirmation enters recovery. Recovery offers an explicitly confirmed restart or advance; it checks whether an uncertain start already succeeded before sending another command.

**Completion inference:** Spotify's playback API has no explicit natural-completion event. A stopped playhead at the actual duration still commits completion directly. For devices that reset to zero, the approved inference requires a playing observation in the final 3 seconds, followed within 3 seconds by a stopped/reset observation on the same track/device near the expected boundary (750ms before to 3 seconds after). The runner reads again after 750ms: only a fresh, stable second stopped/reset observation commits completion. The confirmation window is bounded to 2.5 seconds, and the second observation must be at or after the expected end. A timer never dispatches completion. Known pauses cancel the candidate; detected seeks block reset inference for 3 seconds and recalculate the projected boundary. Changed state/track/device, stale observations and API errors discard the candidate and suspend automation when uncertain.

This is a bounded inference approved after two real natural finishes showed reset-to-zero behavior. Spotify cannot perfectly distinguish that pattern from an external pause-and-seek-to-zero at the exact boundary. An early reset still enters recovery, a normal pause retains its cue, and missing device/item or unknown progress remains recovery. Test the actual wedding device repeatedly before relying on transitions. Audible gaps depend on Spotify latency; reset confirmation adds roughly one 750ms observation interval.

### Development timing and real-device test plan

Set `SEGUEWAY_LIVE_DEBUG=1` in `.env.local`, restart `npm run dev`, and watch the **server terminal** for `[segueway:live]` records. Logging is disabled in production. Records include run/occurrence identity, projected expected end, `completion-candidate` for the first stopped/reset observation, `reset-completion-confirmed` for the corroborating observation, completion observation, command issue time, next track confirmation, and approximate gap (`Spotify's next state-change timestamp - projected expected end`, clamped to zero). This is an estimate, not an acoustic measurement; compare with what you hear. No tokens are logged.

1. Build a Wedding event with at least two tracks in a Loop section, two in a Once section, and a duplicate song occurrence. Save it in the editor.
2. Connect Premium, choose the intended speaker, remove manually queued tracks, disable Autoplay/crossfade, and start live mode. Upcoming tracks from the previous album/playlist must not block starting. Check section, actual track, artwork, progress, device and confirmation state.
3. Let tracks finish naturally: check normal track advance, loop wrap, and that Once completion waits for a confirmed Start next section action. On a reset-to-zero finish, expect a brief "Checking track end" state, then advancement after a second stopped observation. Compare timing records with audible gaps. Early/uncorroborated resets must still enter recovery.
4. Cue midway through a track: it must continue uninterrupted, with the queued banner immediately visible. The next section replaces the remaining tracks only after confirmed completion. Cancel a cue and confirm normal ordering resumes.
5. Pause/resume and seek backwards/near the end while queued. The cue must persist. Try a cue in the last seconds, and cancel near the boundary; committed transitions cannot be cancelled.
6. Open GO NOW, cancel its dialog, then confirm it. Playback should change only after confirmation. Open a second tab and ensure stale actions cannot change an already transitioned run.
7. Skip/change songs manually in Spotify, change/disconnect the device, and briefly interrupt network connectivity. Expect recovery without a guessed transition or automatic command replay. Restore the original device and recover explicitly.
8. Reload/background/close and reopen the live page while the server remains running. Confirm automation and state survive. End automation and verify no further runner commands occur; recheck the original playback remote and event editor.

`npm test` covers the required reducer cases plus runner timer behavior, stale/deduplicated commands, frozen snapshots, API security, live controls with non-empty Spotify queues, migration of the removed queue guard without restarting audio, uncertain accepted starts, cached reads and 429 backoff. The isolated browser smoke suite also covers live setup, cue/cancel, queued pause/resume, GO NOW cancellation, natural transition, Once completion and reload, alongside the Milestone 1/2 regressions. It never controls real Spotify audio.

## Documentation checked

- [Authorization Code](https://developer.spotify.com/documentation/web-api/tutorials/code-flow)
- [Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
- [Scopes](https://developer.spotify.com/documentation/web-api/concepts/scopes)
- [Playback state](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback)
- [Start/resume playback](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback)
- [Token refresh](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens) — access tokens expire in one hour; refresh tokens currently have a six-month lifetime.
- [Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
- [Development quotas and allowlisting](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)

Checked October 2, 2026. Spotify can change development quotas and platform requirements.


## Workspace interactions

The event editor keeps the section order beside the selected section. Rename controls open inline forms; Enter saves and Escape cancels. Section modes explain whether the section stops or repeats. Track search supports adding several tracks before closing the dialog. Each duplicate track remains a separate occurrence.

Live mode shows the current section and track, the saved running order, and the next section. Expand a section in the running order to inspect its tracks without changing playback. Cue, cancel, pause and confirmed Go now controls sit directly beneath the current track. End session requires confirmation and leaves Spotify audio playing.

The incoming section slides forward during the final 15 seconds when it is cued and waits for a confirmed boundary. An uncued Loop previews its next track instead. These animations use projected progress for display only. They do not issue commands, change reconciliation intervals, or advance the state machine. Pause and seek recalculate the preview; recovery suppresses it. Reduced-motion settings disable the animations.

The browser suite checks section and track drag ordering, inline renaming, Undo for tracks and sections, saved configuration after reload, and live controls at desktop and mobile widths. Presentation tests cover cue, Loop, Once, pause, seek and recovery without mutating live state.
