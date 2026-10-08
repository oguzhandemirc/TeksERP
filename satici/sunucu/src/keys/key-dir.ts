// Anahtar birimi ortak okuyucuları: dizin listesi · sertifikanın an geçerliliği · doğrulanmamış başlangıç anı.
import { readdirSync } from "node:fs";
import path from "node:path";
import { CLOCK_SKEW_MS, isoToMs, parseJws, type CertificateDoc } from "../lisans-protokol";

export function listFiles(dir: string, suffix: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(suffix))
    .sort()
    .map((n) => path.join(dir, n));
}

export function certValidAt(doc: CertificateDoc, atMs: number): boolean {
  return atMs >= isoToMs(doc.baslangic) - CLOCK_SKEW_MS && atMs <= isoToMs(doc.bitis) + CLOCK_SKEW_MS;
}

/** Doğrulanmamış sertifika yükünden yalnız başlangıç anı okunur (doğrulama o anda yapılır). */
export function parseCertificatePayload(token: string): { baslangic: string } | null {
  const parsed = parseJws(token);
  const start = parsed.ok ? parsed.value.payload.baslangic : undefined;
  return typeof start === "string" && Number.isFinite(isoToMs(start)) ? { baslangic: start } : null;
}
