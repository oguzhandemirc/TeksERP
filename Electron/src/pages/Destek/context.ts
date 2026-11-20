// Talebe OTOMATİK eklenen bağlam — kullanıcıya sorulmaz. Sözleşme §5.2 `context` (katı şema; bilinmeyen alan 400).
// ⚠️ Parola, token, kullanıcı kimliği, IP buraya GİRMEZ: kimliği backend oturumdan kurar. Son istemci hatası
// yalnız yöntem + yol (sorgu metni ATILIR: arama kutusuna yazılan müşteri adı gibi veri sızmasın) + durumdur.
import type { NetSample } from "@/services/netStats";
import type { SupportContext } from "./types";

const LAST_ERROR_WINDOW_MS = 10 * 60 * 1000;

export function describeOs(ua: string): string {
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Linux/i.test(ua)) return "Linux";
  return "Bilinmiyor";
}

/** Son başarısız istek (destek uçları hariç — kendi hatası bağlam olmaz). */
export function lastClientError(samples: readonly NetSample[], now: number): string | null {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const s = samples[i]!;
    if (now - s.at > LAST_ERROR_WINDOW_MS) return null;
    const failed = typeof s.status !== "number" || s.status >= 400;
    const path = s.url.split("?")[0] ?? s.url;
    if (failed && !path.includes("/api/etkili-destek")) return `${s.method} ${path} → ${s.status}`;
  }
  return null;
}

export interface ContextInput {
  screen: string;
  path: string;
  isElectron: boolean;
  samples: readonly NetSample[];
  win: { innerWidth: number; innerHeight: number; devicePixelRatio: number; navigator: { userAgent: string; language: string } };
  now: number;
}

export function buildSupportContext(i: ContextInput): SupportContext {
  const ua = i.win.navigator.userAgent;
  const technical: Record<string, unknown> = {
    windowSize: `${i.win.innerWidth}x${i.win.innerHeight}`,
    pixelRatio: i.win.devicePixelRatio,
  };
  const lastError = lastClientError(i.samples, i.now);
  if (lastError) technical.lastError = lastError;
  return {
    screen: i.screen.slice(0, 200),
    path: i.path.slice(0, 500),
    client: {
      userAgent: ua.slice(0, 500),
      os: describeOs(ua),
      device: i.isElectron ? "Masaüstü paneli" : "Web paneli",
      locale: i.win.navigator.language.slice(0, 20),
    },
    technical,
  };
}
