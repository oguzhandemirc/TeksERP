// =============================================================================
// İLK KURULUM KABUL METNİ ÜRETİCİSİ — hukuk belgesi (docs/hukuk/KABUL-METNI.md, Ek-7 §2) TEK KAYNAKTIR.
// Yazar: ① protokol kataloğu `src/lib/license/protocol/kabul-katalogu.ts` (kimlik · sha256 · kutular) ve onun
// bayt-eşit aynaları (satıcı · patron sunucusu) ② backend'in güncel metni `src/lib/license/acceptance-text.generated.ts`.
// Belge değişince koşulur; katalog değiştiyse SATICI fabrikadan ÖNCE yayınlanır (yeni metni tanımayan satıcı
// etkinleştirmeyi `KABUL_GEREKLI` ile reddeder).
//   npx tsx scripts/kabul-metni-uret.ts            → yazar (+ aynalara kopya)
//   npx tsx scripts/kabul-metni-uret.ts --denetle  → yazmaz; dosyalar belgeyle uyuşmuyorsa çıkış 1
// =============================================================================
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { KATALOG_DOSYASI, METIN_DOSYASI, PROTOKOL_AYNALARI, PROTOKOL_DIZINI, beklenenCiktilar, kabulKaynagiOku } from "./lib/kabul-metni-kaynak";

function main(): void {
  const denetle = process.argv.includes("--denetle");
  const k = kabulKaynagiOku();
  const hedef = beklenenCiktilar(k);
  const farkli = [
    [KATALOG_DOSYASI, hedef.katalog],
    [METIN_DOSYASI, hedef.metin],
  ].filter(([dosya, icerik]) => readFileSync(dosya!, "utf8") !== icerik);
  console.log(`Kabul metni: ${k.kimlik} · sha256 ${k.ozet.slice(0, 16)}… · kutular ${k.kutular.join(",")}`);
  if (denetle) {
    for (const [dosya] of farkli) console.error(`❌ belgeyle uyuşmuyor: ${path.relative(process.cwd(), dosya!)}`);
    process.exit(farkli.length > 0 ? 1 : 0);
  }
  for (const [dosya, icerik] of farkli) writeFileSync(dosya!, icerik!);
  for (const ayna of PROTOKOL_AYNALARI) {
    for (const ad of readdirSync(PROTOKOL_DIZINI).filter((a) => a.endsWith(".ts"))) copyFileSync(path.join(PROTOKOL_DIZINI, ad), path.join(ayna, ad));
  }
  console.log(farkli.length === 0 ? "Değişiklik yok (aynalar yine eşitlendi)." : `${farkli.length} dosya yazıldı, protokol aynaları eşitlendi.`);
}

main();
