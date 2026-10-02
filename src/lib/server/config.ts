import "server-only";

export function spotifyConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Spotify configuration is missing.");
  const url = new URL(redirectUri);
  const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.hostname === "localhost" || url.pathname !== "/api/auth/callback" || url.search || url.hash || url.username || url.password) {
    throw new Error("Use HTTPS or an explicit HTTP loopback callback ending in /api/auth/callback.");
  }
  return { clientId, clientSecret, redirectUri, origin: url.origin, secure: url.protocol === "https:" };
}

export function isConfigured() {
  try { spotifyConfig(); return true; } catch { return false; }
}
