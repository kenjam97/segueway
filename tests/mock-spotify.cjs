// Test-only preload. Never load this module in a real deployment.
const originalFetch = globalThis.fetch;
let playing = true;
let index = 0;
let liveUri = 'spotify:track:old';
let liveStart = 0;
let liveProgress = 0;
let liveTimestamp = Date.now() - 1000;
globalThis.fetch = async (url, options = {}) => {
  const address = typeof url === 'string' || url instanceof URL ? String(url) : url.url;
  const method = options.method || url.method || 'GET';
  if (address === 'https://accounts.spotify.com/api/token') {
    return Response.json({ access_token: 'mock-access', refresh_token: 'mock-refresh', expires_in: 3600, scope: 'user-read-playback-state user-read-currently-playing user-modify-playback-state' });
  }
  if (address.startsWith('https://api.spotify.com/v1/search?')) {
    const offset = Number(new URL(address).searchParams.get('offset'));
    return Response.json({ tracks: { items: [0, 1].map(index => ({ id: `mock${offset + index}`, uri: `spotify:track:mock${offset + index}`, name: `Wedding Song ${offset + index + 1}`, artists: [{ name: 'The Evening Band' }], album: { name: 'Wedding Album', images: [{ url: 'https://i.scdn.co/image/mock' }] }, duration_ms: 180000 + index * 1000 })), next: offset === 0 ? 'https://api.spotify.com/v1/search?offset=10' : null } });
  }
  if (address.startsWith('https://api.spotify.com/v1/me/player')) {
    const action = new URL(address).pathname.split('/').at(-1);
    if (method !== 'GET') {
      if (process.env.MOCK_SCENARIO === 'live') {
        const body = options.body ? JSON.parse(String(options.body)) : typeof url.clone === 'function' ? await url.clone().json().catch(() => null) : null;
        if (action === 'play' && body?.uris) { liveUri = body.uris[0]; liveStart = Date.now(); liveProgress = 0; liveTimestamp = Date.now(); }
        if (action === 'pause') { liveProgress = Math.min(liveUri.endsWith('entrance') || liveUri.endsWith('exit') ? 3000 : 6000, liveProgress + Date.now() - liveStart); liveTimestamp = Date.now(); }
        if (action === 'play' && !body?.uris) { liveStart = Date.now(); liveTimestamp = Date.now(); }
      }
      if (action === 'play') playing = true;
      if (action === 'pause') playing = false;
      if (action === 'next') index++;
      if (action === 'previous') index--;
      return new Response(null, { status: 200 });
    }
    if (action === 'queue') return Response.json({ queue: [] });
    if (process.env.MOCK_SCENARIO === 'empty') return new Response(null, { status: 204 });
    if (process.env.MOCK_SCENARIO === 'rate') return Response.json({ error: { status: 429 } }, { status: 429, headers: { 'Retry-After': '3' } });
    if (process.env.MOCK_SCENARIO === 'quota') return Response.json({ error: { status: 429, reason: 'QUOTA_EXCEEDED' } }, { status: 429 });
    if (process.env.MOCK_SCENARIO === 'live') {
      const duration = liveUri.endsWith('entrance') || liveUri.endsWith('exit') ? 3000 : 6000;
      const progress = liveStart ? Math.min(duration, liveProgress + (playing ? Date.now() - liveStart : 0)) : 0;
      return Response.json({ is_playing: playing && progress < duration, progress_ms: progress >= duration ? 0 : progress, timestamp: liveTimestamp, repeat_state: 'off', shuffle_state: false, device: { id: 'mock-speaker', name: 'Reception speaker', type: 'Speaker', is_restricted: false }, item: { type: 'track', id: liveUri.split(':').at(-1), uri: liveUri, name: liveUri.endsWith('entrance') ? 'Entrance Track' : liveUri.endsWith('exit') ? 'Exit Track' : 'Waiting Track', duration_ms: duration, artists: [{ name: 'The Evening Band' }], album: { images: [] } }, actions: { disallows: {} } });
    }
    return Response.json({ is_playing: playing, progress_ms: 42000, timestamp: Date.now(), repeat_state: 'off', shuffle_state: false, device: { id: 'mock-speaker', name: 'Reception speaker', type: 'Speaker', is_restricted: false }, item: { type: 'track', name: index === 0 ? 'A Lovely Day' : 'The Next Moment', duration_ms: 210000, artists: [{ name: 'The Evening Band' }], album: { images: [] }, external_urls: { spotify: 'https://open.spotify.com/track/mock' } }, actions: { disallows: {} } });
  }
  return originalFetch(url, options);
};
