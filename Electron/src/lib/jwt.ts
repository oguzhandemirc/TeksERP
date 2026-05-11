import type { JwtPayload } from "@/types/auth";

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "="));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}
