import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spotifyConfig } from "@/lib/server/config";

beforeEach(() => {
  vi.stubEnv("SPOTIFY_CLIENT_ID", "client");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
  vi.stubEnv("SPOTIFY_REDIRECT_URI", "");
  vi.stubEnv("RENDER", "true");
  vi.stubEnv("RENDER_EXTERNAL_URL", "https://assigned-service.onrender.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("hosted Spotify configuration", () => {
  it("derives the secure callback from Render's assigned public URL", () => {
    expect(spotifyConfig()).toMatchObject({ redirectUri: "https://assigned-service.onrender.com/api/auth/callback", origin: "https://assigned-service.onrender.com", secure: true });
  });
  it("preserves explicitly configured local or custom-domain callbacks", () => {
    vi.stubEnv("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:3000/api/auth/callback");
    expect(spotifyConfig()).toMatchObject({ redirectUri: "http://127.0.0.1:3000/api/auth/callback", secure: false });
  });
  it("does not assume Render outside its environment", () => {
    vi.stubEnv("RENDER", "");
    expect(() => spotifyConfig()).toThrow("missing");
  });
  it("still rejects insecure public callbacks", () => {
    vi.stubEnv("RENDER_EXTERNAL_URL", "http://assigned-service.onrender.com");
    expect(() => spotifyConfig()).toThrow("HTTPS");
  });
});
