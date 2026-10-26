// Panel hub karo dosyaları — `pages/<Hub>/tile-config.ts` + `pages/<Hub>/tiles/*.ts` (UX-2 bölünmesi, 2026-10-26).
// Karo dosyasını yoldan okuyan HER bekçi listeyi buradan alır: tek dosyaya bakan tarayıcı bölünmede sessizce körleşir.
import * as fs from "node:fs";
import * as path from "node:path";

/** Yan menü kökü olan hub'lar (`pages/<Hub>`). Raporlar kategori dosyaları ayrı (`Reports/<Kategori>/tile-config.ts`). */
export const KARO_HUBLARI = ["Operations", "Definitions", "System", "Access", "Finance", "Reports", "Cost", "Quality", "Documents"] as const;
export type KaroHub = (typeof KARO_HUBLARI)[number];

/** Hub'ın karo dosyaları, `Electron/src`e göreli (tile-config önce, ardından `tiles/*.ts` alfabetik). */
export function hubKaroDosyalari(electronSrc: string, hub: string): string[] {
  const out: string[] = [];
  const ana = `pages/${hub}/tile-config.ts`;
  if (fs.existsSync(path.join(electronSrc, ana))) out.push(ana);
  const dizin = path.join(electronSrc, "pages", hub, "tiles");
  if (fs.existsSync(dizin)) {
    for (const f of fs.readdirSync(dizin).sort()) {
      if (f.endsWith(".ts") && !f.endsWith(".test.ts")) out.push(`pages/${hub}/tiles/${f}`);
    }
  }
  return out;
}

/** Bütün hub'ların karo dosyaları. */
export function tumKaroDosyalari(electronSrc: string, hublar: readonly string[] = KARO_HUBLARI): string[] {
  return hublar.flatMap((h) => hubKaroDosyalari(electronSrc, h));
}

/** Hub'ın karo dosyalarının birleşik metni (metin tarayıcıları için). */
export function hubKaroMetni(electronSrc: string, hub: string): string {
  return hubKaroDosyalari(electronSrc, hub).map((f) => fs.readFileSync(path.join(electronSrc, f), "utf8")).join("\n");
}
