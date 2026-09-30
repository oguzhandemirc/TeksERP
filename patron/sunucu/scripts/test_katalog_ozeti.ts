// =============================================================================
// BULUT KATALOĞU STATİK ÖZETİ — `src/catalog/katalog-ozeti.json` kataloğun (`permissions.ts` · `projections.ts`
// · `reports.ts`) ÜRETİLMİŞ görüntüsüdür. Başka projeler kataloğu YALNIZ bu dosyadan statik okur: sunucu kaynağını
// içe aktarmaz, sunucunun `node_modules`üne uzanmaz (katalog zod'lu tel sözleşmesine bağlı; içe aktaran fabrika
// bekçisi ile uygulama tip denetimi, sunucu bağımlılığı kurulu olmayan CI işlerinde `Cannot find module 'zod'` verdi).
//   §1 özet var ve canlı katalogdan üretilenle BAYT-EŞİT (bayatsa: `npx tsx scripts/test_katalog_ozeti.ts --yaz`)
//   §2 özet boş değil (izin ≥ 10 · kök projeksiyon ≥ 20 · projeksiyon izni ≥ kök sayısı · rapor ailesi ≥ 1)
//   §3 okuyucular özeti okur, sunucu kataloğunu İÇE AKTARMAZ (fabrika `test_bulut_tel_aynasi` · uygulama `mirror.test`)
// ⭐ KALICI SONDA (her koşumda): tek izni düşmüş özet §1 karşılaştırıcısında ısırır, özdeş susar · katalog içe
//   aktaran satır §3 yükleminde ısırır, özeti `readFileSync` ile okuyan satır susar.
// Koşum: npx tsx scripts/test_katalog_ozeti.ts [--yaz]   (DB GEREKMEZ)
// =============================================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLOUD_PERMISSIONS } from "../src/catalog/permissions";
import { PROJECTION_CATALOG, ROOT_PROJECTIONS } from "../src/catalog/projections";
import { REPORT_FAMILY_PERMISSION, REPORTS_NOT_IN_CLOUD } from "../src/catalog/reports";

const KOK = path.resolve(__dirname, "..", "..", "..");
export const OZET = "patron/sunucu/src/catalog/katalog-ozeti.json";
const OKUYUCULAR: readonly string[] = ["Teks-Erp/scripts/test_bulut_tel_aynasi.ts", "patron/uygulama/__tests__/mirror.test.ts"];

let gecti = 0;
let kaldi = 0;
function kontrol(ad: string, kosul: boolean, ayrinti = ""): void {
  if (kosul) gecti++;
  else kaldi++;
  console.log(`  ${kosul ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

export interface KatalogOzeti {
  readonly _aciklama: string;
  readonly CLOUD_PERMISSIONS: readonly string[];
  readonly ROOT_PROJECTIONS: readonly unknown[];
  readonly PROJECTION_PERMISSIONS: Readonly<Record<string, readonly string[]>>;
  readonly REPORT_FAMILY_PERMISSION: Readonly<Record<string, string>>;
  readonly REPORTS_NOT_IN_CLOUD: readonly string[];
}

function canliOzet(): KatalogOzeti {
  return {
    _aciklama: "ÜRETİLMİŞ — elle düzenlenmez. Tek kaynak patron/sunucu/src/catalog/*.ts; yeniden üret: cd patron/sunucu && npx tsx scripts/test_katalog_ozeti.ts --yaz",
    CLOUD_PERMISSIONS: [...CLOUD_PERMISSIONS],
    ROOT_PROJECTIONS,
    PROJECTION_PERMISSIONS: Object.fromEntries([...PROJECTION_CATALOG].map(([ad, d]) => [ad, [...d.permissions]])),
    REPORT_FAMILY_PERMISSION,
    REPORTS_NOT_IN_CLOUD: [...REPORTS_NOT_IN_CLOUD],
  };
}

/** Özetin dosya metni — saf (sonda sentetik özetle çağırır). */
export function ozetMetni(o: KatalogOzeti): string {
  return `${JSON.stringify(o, null, 2)}\n`;
}

/** Sunucu kataloğunu içe aktaran satırlar (statik `import`/`require`/dinamik `import(`; yalnız okuma serbest). */
export function katalogIceAktarimi(src: string): string[] {
  return src.split("\n").filter((s) => /\b(import|require)\b[^\n]*sunucu\/src\/catalog\//.test(s) && !/readFileSync/.test(s));
}

const dosya = path.join(KOK, OZET);
const beklenen = ozetMetni(canliOzet());

if (process.argv.includes("--yaz")) {
  writeFileSync(dosya, beklenen);
  console.log(`✍️  ${OZET} yazıldı (${beklenen.length} bayt)`);
  process.exit(0);
}

console.log("§1 özet canlı katalogla bayt-eşit");
const var_ = existsSync(dosya);
kontrol(`§1a özet var (${OZET})`, var_);
kontrol("§1b ⭐ özet canlı katalogdan üretilenle BAYT-EŞİT", var_ && readFileSync(dosya, "utf8") === beklenen, "bayatsa: npx tsx scripts/test_katalog_ozeti.ts --yaz");

console.log("\n§2 özet boş değil");
const o = canliOzet();
const izinli = Object.keys(o.PROJECTION_PERMISSIONS).length;
kontrol(
  "§2a izin ≥ 10 · kök projeksiyon ≥ 20 · projeksiyon izni ≥ kök · rapor ailesi ≥ 1",
  o.CLOUD_PERMISSIONS.length >= 10 && o.ROOT_PROJECTIONS.length >= 20 && izinli >= o.ROOT_PROJECTIONS.length && Object.keys(o.REPORT_FAMILY_PERMISSION).length >= 1,
  `${o.CLOUD_PERMISSIONS.length} · ${o.ROOT_PROJECTIONS.length} · ${izinli}`,
);

console.log("\n§3 okuyucular özeti okur, kataloğu içe aktarmaz");
for (const r of OKUYUCULAR) {
  const p = path.join(KOK, r);
  const src = existsSync(p) ? readFileSync(p, "utf8") : "";
  kontrol(`§3a ${r} özeti okur`, src.includes("katalog-ozeti.json"));
  const ihlal = katalogIceAktarimi(src);
  kontrol(`§3b ⭐ ${r} sunucu kataloğunu içe aktarmaz`, src.length > 0 && ihlal.length === 0, ihlal.slice(0, 3).join(" · "));
}

console.log("\n✓K kalıcı sondalar (sentetik)");
const eksik: KatalogOzeti = { ...o, CLOUD_PERMISSIONS: o.CLOUD_PERMISSIONS.slice(1) };
kontrol("✓K1 tek izni düşmüş özet ısırır · özdeş susar", ozetMetni(eksik) !== beklenen && ozetMetni(canliOzet()) === beklenen);
kontrol(
  "✓K2 katalog içe aktarımı ısırır (statik · dinamik) · readFileSync ile okuma susar",
  katalogIceAktarimi('import { projectionDef } from "../../sunucu/src/catalog/projections";').length === 1 &&
    katalogIceAktarimi('await import(path.join(KOK, "patron/sunucu/src/catalog/projections.ts"));').length === 1 &&
    katalogIceAktarimi('JSON.parse(readFileSync(path.join(KOK, "patron/sunucu/src/catalog/katalog-ozeti.json"), "utf8"));').length === 0,
);

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi > 0 ? 1 : 0);
