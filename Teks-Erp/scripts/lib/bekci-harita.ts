// =============================================================================
// BEKÇİ HARİTASI OKUYUCUSU — dizin (`BEKCI-HARITASI.md`) + alan dosyaları (`bekci-harita/<alan>.md`)
// =============================================================================
// NEDEN (2026-11-03): harita 1,6 MB tek dosyaydı; alan başına bölündü, dizin ≤ 10 KB kaldı.
// Haritayı okuyan bekçiler (identity_ledger · harita_sonda_atfi) dosya kümesini TEK yerden alır —
// küme iki bekçide ayrı yazılırsa biri yeni dosyayı görür, öteki görmez.
// =============================================================================
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Repo köküne göre yollar. */
export const HARITA_DIZINI_DOSYASI = "Teks-Erp/docs/BEKCI-HARITASI.md";
export const HARITA_ALAN_DIZINI = "Teks-Erp/docs/bekci-harita";

/** Alan dosyaları (repo-göreli, sıralı). Dizin yoksa boş — çağıran körlük zeminini kendisi ölçer. */
export function haritaAlanDosyalari(kok: string): string[] {
  const d = join(kok, HARITA_ALAN_DIZINI);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `${HARITA_ALAN_DIZINI}/${f}`);
}

/** Bütün alan dosyalarının birleşik metni (ağaçtan) — bölüm başlıkları dosyaların içindedir. */
export function haritaMetni(kok: string): string {
  return haritaAlanDosyalari(kok)
    .map((rel) => readFileSync(join(kok, rel), "utf8"))
    .join("\n");
}

/**
 * Dizin ↔ alan dosyası tazeliği (saf yüklem). Her alan dosyası `## <başlık>` ile başlar ve dizinde
 * AYNI başlığın altında ona bağlantı vardır; dizindeki her bağlantının dosyası vardır.
 * `dosyalar`: dosya adı (`lisans.md`) → metin.
 */
export function dizinHatalari(dizinMetni: string, dosyalar: Map<string, string>): string[] {
  const hatalar: string[] = [];
  const dizinBag = new Map<string, string>(); // dosya adı → dizindeki başlık
  let baslik: string | null = null;
  for (const satir of dizinMetni.split("\n")) {
    if (satir.startsWith("## ")) { baslik = satir; continue; }
    for (const m of satir.matchAll(/\]\(bekci-harita\/([^)\s]+\.md)\)/g)) {
      if (!baslik) { hatalar.push(`dizin: ${m[1]} bağlantısı bir \`## \` başlığı altında değil`); continue; }
      if (dizinBag.has(m[1])) hatalar.push(`dizin: ${m[1]} iki kez bağlanmış`);
      dizinBag.set(m[1], baslik);
    }
  }
  for (const [ad, metin] of dosyalar) {
    const ilk = metin.split("\n")[0] ?? "";
    if (!ilk.startsWith("## ")) { hatalar.push(`${ad}: ilk satır \`## <alan>\` başlığı değil`); continue; }
    const bag = dizinBag.get(ad);
    if (!bag) hatalar.push(`${ad}: dizinde (${HARITA_DIZINI_DOSYASI}) bağlantısı YOK`);
    else if (bag !== ilk) hatalar.push(`${ad}: dizin başlığı "${bag}" ≠ dosya başlığı "${ilk}"`);
  }
  for (const ad of dizinBag.keys()) if (!dosyalar.has(ad)) hatalar.push(`dizin: ${ad} bağlantısının dosyası YOK`);
  return hatalar;
}
