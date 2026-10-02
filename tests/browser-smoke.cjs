// Uses a local test server and mocks Spotify OAuth consent; no Spotify credentials needed.
// Set PLAYWRIGHT_MODULE to an installed Playwright module path before running.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const port = process.env.TEST_PORT || '3100';
const base = `http://127.0.0.1:${port}`;
const output = path.join(__dirname, '..', 'test-results');
fs.mkdirSync(output, { recursive: true });

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Test server did not start');
}

async function run(scenario, browser) {
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  Object.assign(env, { SPOTIFY_CLIENT_ID: '', SPOTIFY_CLIENT_SECRET: '', SPOTIFY_REDIRECT_URI: '' });
  if (scenario !== 'setup') Object.assign(env, { SPOTIFY_CLIENT_ID: 'mock', SPOTIFY_CLIENT_SECRET: 'mock', SPOTIFY_REDIRECT_URI: base + '/api/auth/callback', MOCK_SCENARIO: scenario });
  const server = spawn(process.execPath, ['--require', './tests/mock-spotify.cjs', './node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { cwd: path.join(__dirname, '..'), env, stdio: 'pipe', windowsHide: true });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await waitForServer();
    await page.goto(base);
    await page.getByRole('heading', { name: 'Spotify playback', exact: true }).waitFor();
    if (scenario === 'setup') {
      await page.getByText('Spotify setup needed').waitFor();
      await page.screenshot({ path: path.join(output, 'setup-desktop.png'), fullPage: true });
    } else {
      await context.route(base + '/api/auth/login', async route => {
        const response = await route.fetch({ maxRedirects: 0 });
        const auth = new URL(response.headers().location);
        assert.equal(auth.searchParams.get('scope'), 'user-read-playback-state user-read-currently-playing user-modify-playback-state');
        await route.fulfill({ response, status: 302, headers: { ...response.headers(), location: `${base}/api/auth/callback?code=mock-code&state=${auth.searchParams.get('state')}` }, body: '' });
      });
      await page.getByRole('link', { name: /Connect with Spotify/ }).click();
      await page.getByRole('region', { name: 'Spotify playback' }).waitFor();
      if (scenario === 'normal') {
        await page.getByRole('heading', { name: 'A Lovely Day' }).waitFor();
        await page.getByText('Reception speaker', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Next track' }).click();
        await page.getByRole('heading', { name: 'The Next Moment' }).waitFor();
        await page.getByRole('button', { name: 'Previous track' }).click();
        await page.getByRole('heading', { name: 'A Lovely Day' }).waitFor();
        assert.equal(await page.getByRole('region', { name: 'Spotify playback' }).getByRole('alert').count(), 0);
        await page.screenshot({ path: path.join(output, 'player-desktop.png'), fullPage: true });
      } else if (scenario === 'editor') {
        await context.route('https://i.scdn.co/image/mock', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#30654f"/></svg>' }));
        await page.goto(base + '/events');
        await page.getByRole('button', { name: 'Create your first event' }).click();
        await page.getByLabel('New event name').fill('Wedding');
        await page.getByRole('button', { name: 'Create event', exact: true }).click();
        for (const name of ['Guests Arriving', 'Ceremony Entrance', 'Signing', 'Exit']) {
          await page.getByRole('button', { name: 'Add section' }).first().click();
          await page.getByLabel('New section name').fill(name);
          await page.getByRole('button', { name: 'Create section', exact: true }).click();
        }
        await page.getByRole('button', { name: 'Edit section Guests Arriving', exact: true }).click();
        await page.getByRole('radio', { name: 'Loop', exact: true }).check();
        await page.getByRole('button', { name: 'Add track' }).click();
        await page.getByLabel('Search Spotify by track or artist').fill('wedding');
        await page.getByRole('button', { name: 'Add Wedding Song 1', exact: true }).click();
        await page.getByRole('button', { name: 'Add Wedding Song 2', exact: true }).click();
        await page.getByRole('button', { name: 'Load more' }).click();
        await page.getByRole('button', { name: 'Add Wedding Song 11', exact: true }).click();
        await page.getByRole('button', { name: 'Close track search' }).click();
        await page.getByRole('button', { name: 'Move Wedding Song 2 up', exact: true }).click();
        await page.getByRole('button', { name: 'Remove Wedding Song 11', exact: true }).click();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.getByRole('button', { name: 'Remove Wedding Song 11', exact: true }).click();
        await page.getByRole('button', { name: 'Drag Wedding Song 1', exact: true }).dragTo(page.getByRole('button', { name: 'Drag Wedding Song 2', exact: true }));
        assert.equal(await page.getByRole('list', { name: 'Section tracks' }).getByRole('listitem').first().innerText().then(t => t.includes('Wedding Song 1')), true);
        await page.getByRole('button', { name: 'Move Wedding Song 2 up', exact: true }).click();
        await page.getByRole('button', { name: 'Drag section Signing', exact: true }).dragTo(page.getByRole('button', { name: 'Drag section Ceremony Entrance', exact: true }));
        await page.reload();
        await page.getByRole('heading', { name: 'Wedding', exact: true }).waitFor();
        const library = await page.evaluate(() => JSON.parse(localStorage.getItem('segueway.events.v1')));
        assert.deepEqual(library.events[0].sections.map(section => section.name), ['Guests Arriving', 'Signing', 'Ceremony Entrance', 'Exit']);
        assert.equal(library.events[0].sections[0].playbackMode, 'loop');
        assert.deepEqual(library.events[0].sections[0].tracks.map(track => track.name), ['Wedding Song 2', 'Wedding Song 1']);
        await page.getByRole('button', { name: 'Rename event', exact: true }).click();
        await page.getByLabel('Event name', { exact: true }).fill('Our Wedding');
        await page.getByRole('region', { name: 'Event details' }).getByRole('button', { name: 'Save name' }).click();
        await page.getByRole('button', { name: 'Rename section', exact: true }).click();
        await page.getByLabel('Section name', { exact: true }).fill('Welcome');
        await page.getByRole('region', { name: 'Section editor' }).getByRole('button', { name: 'Save name' }).click();
        await page.getByRole('button', { name: 'Edit section Exit', exact: true }).click();
        
        await page.getByRole('button', { name: 'Delete section', exact: true }).click();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.getByRole('button', { name: 'Edit section Exit', exact: true }).click();
        await page.getByRole('button', { name: 'Delete section', exact: true }).click();
        await page.reload();
        await page.getByRole('heading', { name: 'Our Wedding', exact: true }).waitFor();
        assert.equal(await page.getByRole('list', { name: 'Event sections' }).getByRole('listitem').count(), 3);
        await page.screenshot({ path: path.join(output, 'editor-desktop.png'), fullPage: true });
      } else if (scenario === 'live') {
        await page.evaluate(() => {
          const track = id => ({ entryId: id, spotifyId: id, uri: `spotify:track:${id}`, name: id, artists: ['The Evening Band'], albumName: 'Wedding', artwork: null, durationMs: ['entrance', 'exit'].includes(id) ? 3000 : 6000 });
          localStorage.setItem('segueway.events.v1', JSON.stringify({ version: 1, activeEventId: 'wedding', events: [{ id: 'wedding', name: 'Wedding', sections: [
            { id: 'waiting', name: 'Waiting Music', playbackMode: 'loop', tracks: [track('waiting'), track('waiting2')] },
            { id: 'entrance', name: 'Ceremony Entrance', playbackMode: 'once', tracks: [track('entrance')] },
            { id: 'exit', name: 'Exit', playbackMode: 'once', tracks: [track('exit')] },
          ] }] }));
        });
        await page.getByRole('link', { name: 'Live mode', exact: true }).click();
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Start section', exact: true }).click();
        await page.getByRole('status').filter({ hasText: /^Playing$/ }).waitFor();
        await page.getByRole('button', { name: 'CUE NEXT', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel cue', exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, 'live-queued-desktop.png'), fullPage: true });
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        await page.getByRole('status').filter({ hasText: /^Next section queued$/ }).waitFor();
        await page.getByRole('button', { name: 'Resume', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel cue', exact: true }).click();
        await page.getByRole('button', { name: 'Go now', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
        await page.getByRole('button', { name: 'CUE NEXT', exact: true }).click();
        await page.getByRole('heading', { name: 'Entrance Track', exact: true }).waitFor();
        await page.getByRole('status').filter({ hasText: /^Section complete/ }).waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Exit Track', exact: true }).count(), 0);
        await page.reload();
        await page.getByRole('status').filter({ hasText: /^Section complete/ }).waitFor();
        await page.getByRole('button', { name: 'Start next section', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await page.getByRole('heading', { name: 'Exit Track', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Start next section', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Start next section', exact: true }).click();
        await page.getByRole('heading', { name: 'Exit Track', exact: true }).waitFor();
        await page.getByRole('status').filter({ hasText: /^Section complete/ }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Start next section', exact: true }).isDisabled(), true);
        await page.screenshot({ path: path.join(output, 'live-desktop.png'), fullPage: true });
        await page.reload();
        await page.getByRole('status').filter({ hasText: /^Section complete/ }).waitFor();
      } else if (scenario === 'empty') {
        await page.getByRole('heading', { name: 'Choose a Spotify device' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).isDisabled(), true);
      } else {
        await page.getByRole('region', { name: 'Spotify playback' }).getByRole('alert').waitFor();
        assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).isDisabled(), true);
        if (scenario === 'quota') await page.getByText(/Automatic updates are paused/).waitFor();
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow on mobile');
    await page.screenshot({ path: path.join(output, `${scenario}-mobile.png`), fullPage: true });
    if (scenario === 'normal') {
      await page.getByRole('button', { name: 'Disconnect Spotify' }).click();
      await page.getByRole('link', { name: /Connect with Spotify/ }).waitFor();
      assert.equal((await context.request.get(base + '/api/playback')).status(), 401);
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log(`PASS browser ${scenario}: desktop/mobile, no runtime errors`);
  } catch (error) { await page.screenshot({ path: path.join(output, `${scenario}-failure.png`), fullPage: true }); console.error('Browser URL:', page.url(), 'Page:', (await page.locator('body').innerText()).slice(0, 1600)); console.error(serverLog); throw error; }
  finally { await context.close(); server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try { for (const scenario of ['setup', 'normal', 'editor', 'live', 'empty', 'rate', 'quota']) await run(scenario, browser); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
