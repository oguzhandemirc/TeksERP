// =============================================================================
// RAPOR SORGUSU STRICT — her `routes/reports/**` `router.get` sorgusu `.strict()` Zod'dan geçer; bilinmeyen anahtar 400
// =============================================================================
// NEDEN (R5a ④, 2026-09-15): 29 ucun 6'sı tanınmayan süzgeç anahtarını sessizce yutuyordu (üçünde şema yok, ikisi
// elle okuma, biri strict değil) + `operator-performance` `limit` `.catch(50)` hatalı değeri sessiz 50 yapıyordu.
// "Çeşitli filtreler" (K10) gelmeden önce zemin: yanlış adlı/yanlış değerli süzgeç 400 verir, yutulmaz.
// §1 STATİK: her handler `X.parse(req.query)` taşır ve X `.strict()` ile tanımlıdır (dosyada, `_shared`ta ya
//   da satır içi zincirde). §2 DOĞRUDAN: dışa açık şemalar bilinmeyen anahtarı reddeder, hatalı limit 400 (DB'siz).
// NEGATİF SONDALAR (2026-09-15): `emptyQuerySchema`den `.strict()` düşürüldü → §1 üç uç + §2a ❌ ·
//   `batch-search`te `.parse(req.query)` yerine elle `req.query.q` → §1 ❌ · `limit`e `.catch(50)` geri kondu → §2c ❌.
// Salt-okunur, DB yok.
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { yorumlariSok } from "./lib/regime-gate-scan";
import { compareRangeSchema, dateRangeSchema, emptyQuerySchema } from "../src/services/reports/_shared";
import { batchSearchQuerySchema, operatorPerformanceQuerySchema, travelerTraceQuerySchema } from "../src/routes/reports/production.routes";
import { productionChainQuerySchema } from "../src/routes/reports/dokuma.report.routes";
import { coreRangeQuerySchema } from "../src/services/reports/temel/_common";
import * as temelUretim from "../src/routes/reports/temel-uretim.routes";
import * as temelSatis from "../src/routes/reports/temel-satis.routes";
import * as temelDokumaFinans from "../src/routes/reports/temel-dokuma-finans.routes";
import { coreDayRangeQuerySchema } from "../src/services/reports/temel/_day-range";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "src/routes/reports");
const SHARED = yorumlariSok(readFileSync(path.join(ROOT, "src/services/reports/_shared.ts"), "utf8"));

/** `const X = <zincir>;` tanımı `.strict()` ile bitiyor mu (dosya ya da _shared). */
function strictTanimli(ad: string, kaynak: string): boolean {
  const re = new RegExp(`(?:export )?const ${ad}\\s*=\\s*([\\s\\S]*?);\\n`, "m");
  for (const metin of [kaynak, SHARED]) {
    const m = re.exec(metin);
    if (m && /\.strict\(\)\s*$/.test(m[1]!.trim())) return true;
  }
  return false;
}

console.log("=== RAPOR SORGUSU STRICT BEKÇİSİ ===\n── §1 Statik: her router.get → strict Zod ──");
const dosyalar = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
let ucSayisi = 0;
const kapisiz: string[] = [];
for (const f of dosyalar) {
  const kaynak = yorumlariSok(readFileSync(path.join(DIR, f), "utf8"));
  const bloklar = kaynak.split(/(?=router\.get\()/).slice(1);
  for (const blok of bloklar) {
    const yol = /router\.get\(\s*"([^"]+)"/.exec(blok)?.[1] ?? "?";
    ucSayisi++;
    // Handler gövdesi bir sonraki router.get'e kadar; `.parse(req.query)` var mı ve şeması strict mi?
    const inline = /\.strict\(\)\s*\.parse\(req\.query\)/.test(blok);
    const adli = [...blok.matchAll(/\b([A-Za-z_]\w*)\.parse\(req\.query\)/g)].map((m) => m[1]!);
    const ok = inline || (adli.length > 0 && adli.every((ad) => strictTanimli(ad, kaynak)));
    if (!ok) kapisiz.push(`${f} ${yol}${adli.length ? ` (${adli.join(",")} strict değil)` : " (parse yok / elle okuma)"}`);
  }
}
check("§1a körlük zemini: rapor uçları bulundu (≥ 29)", ucSayisi >= 29, `n=${ucSayisi}`);
check("§1b ⭐ HER rapor ucu strict Zod'dan geçer (sessiz yutma yok)", kapisiz.length === 0, kapisiz.length ? "KAPISIZ: " + kapisiz.join(" · ") : `${ucSayisi} uç`);
const elle = dosyalar.filter((f) => /req\.query\.\w+/.test(yorumlariSok(readFileSync(path.join(DIR, f), "utf8"))));
check("§1c elle `req.query.x` okuması YOK (tek kapı şema)", elle.length === 0, elle.join(","));

console.log("\n── §2 Doğrudan: bilinmeyen anahtar → red (400) ──");
const red = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => !s.safeParse(v).success;
check("§2a parametresiz uçlar (`emptyQuerySchema`): {} geçer, {zzz:'1'} red", !red(emptyQuerySchema, {}) && red(emptyQuerySchema, { zzz: "1" }));
check("§2b batch-search: {q:'P01'} geçer, {q, sunucu:'x'} red, 101 karakter red", !red(batchSearchQuerySchema, { q: "P01" }) && red(batchSearchQuerySchema, { q: "P01", sunucu: "x" }) && red(batchSearchQuerySchema, { q: "a".repeat(101) }));
check("§2c ⭐ operator-performance: limit 'abc' → RED (sessiz 50 YOK); limit yok → geçer; 201 red; bilinmeyen anahtar red", red(operatorPerformanceQuerySchema, { limit: "abc" }) && !red(operatorPerformanceQuerySchema, {}) && red(operatorPerformanceQuerySchema, { limit: "201" }) && red(operatorPerformanceQuerySchema, { foo: "1" }) && operatorPerformanceQuerySchema.parse({ limit: "25" }).limit === 25);
check("§2d traveler-trace: rollId zorunlu uuid, fazladan anahtar red", red(travelerTraceQuerySchema, {}) && red(travelerTraceQuerySchema, { rollId: "x" }) && red(travelerTraceQuerySchema, { rollId: "11111111-1111-4111-8111-111111111111", foo: "1" }) && !red(travelerTraceQuerySchema, { rollId: "11111111-1111-4111-8111-111111111111" }));
check("§2e zincir (Z3): süzgeçsiz geçer, durum kapalı enum, gecikmis yalnız 'true', fazladan anahtar red", !red(productionChainQuerySchema, {}) && !red(productionChainQuerySchema, { durum: "GECIKMIS", gecikmis: "true" }) && red(productionChainQuerySchema, { durum: "YOK" }) && red(productionChainQuerySchema, { gecikmis: "false" }) && red(productionChainQuerySchema, { from: "2026-01-01" }));
check("§2e ortak şemalar strict: dateRangeSchema/compareRangeSchema bilinmeyen anahtarı reddeder", red(dateRangeSchema, { installationId: "1" }) && red(compareRangeSchema, { installationId: "1" }));

// §3 K-TEL (2026-10-24): panelin rapor v2 isteğindeki tarih + kıyas anahtarları = ortak sorgu şemasının kümesi.
// NEGATİF SONDA 2026-10-24: `_common.ts`te `kiyas` → `compare` yapıldı → §3a + §3b ❌; geri alındı → ✅.
// NEGATİF SONDA 2026-10-25 (R0-RAPA): `temel-satis` termin şeması `compareRangeSchema`ya döndürüldü → §3b ❌; geri alındı → ✅.
console.log("\n── §3 K-TEL: panel ↔ uç tel anahtarı eşitliği (rapor v2) ──");
const PANEL = path.resolve(ROOT, "../Electron/src/pages/Reports");
const kiyasAd = /export const COMPARE_PARAM = "(\w+)"/.exec(readFileSync(path.join(PANEL, "_v2/request-params.ts"), "utf8"))?.[1];
const isoGovde = /export function rangeIsoParams\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(readFileSync(path.join(PANEL, "_lib/report-date.ts"), "utf8"))?.[1] ?? "";
const panelKume = [...[...isoGovde.matchAll(/(\w+):/g)].map((m) => m[1]!), kiyasAd ?? "?"].sort();
const ucKume = Object.keys(coreRangeQuerySchema.shape).sort();
check("§3a panel {tarih (aralik-iso) + COMPARE_PARAM} = coreRangeQuerySchema anahtarları", panelKume.join(",") === ucKume.join(","), `panel ${panelKume.join(",")} · uç ${ucKume.join(",")}`);
const v2Semalar = [...Object.entries(temelUretim), ...Object.entries(temelSatis)].filter(([ad]) => /^core\w+QuerySchema$/.test(ad)) as [string, { safeParse: (v: unknown) => { success: boolean }; shape: object }][];
const kiyasli = v2Semalar.filter(([, s]) => "dateFrom" in s.shape);
check("§3b her aralıklı v2 ucu `kiyas` kabul eder, `compare` reddeder", kiyasli.length >= 8 && kiyasli.every(([, s]) => !red(s, { kiyas: "prevYear" }) && red(s, { compare: "prev" })), kiyasli.map(([a]) => a).join(","));

// §3c K-TEL gün sözleşmesi (R0-RAPC, `tarih:"aralik-gun"`): panel `rangeDayParams` gövdesi + COMPARE_PARAM = gün şeması.
// NEGATİF SONDA 2026-10-25: `_day-range.ts`te `from` → `fromDay` yapıldı → §3c + §3d ❌; geri alındı → ✅.
const gunGovde = /export function rangeDayParams\([^)]*\)[^\n]*\n\s*return \{([^}]*)\}/.exec(readFileSync(path.join(PANEL, "_lib/report-date.ts"), "utf8"))?.[1] ?? "";
const panelGun = [...[...gunGovde.matchAll(/(\w+):/g)].map((m) => m[1]!), kiyasAd ?? "?"].sort();
const ucGun = Object.keys(coreDayRangeQuerySchema.shape).sort();
check("§3c panel {tarih (aralik-gun) + COMPARE_PARAM} = coreDayRangeQuerySchema anahtarları", panelGun.join(",") === ucGun.join(","), `panel ${panelGun.join(",")} · uç ${ucGun.join(",")}`);
const gunSemalar = Object.entries(temelDokumaFinans).filter(([ad]) => /^core\w+QuerySchema$/.test(ad)) as [string, { safeParse: (v: unknown) => { success: boolean }; shape: object }][];
const gunKiyasli = gunSemalar.filter(([, s]) => "from" in s.shape);
check("§3d her gün aralıklı v2 ucu `kiyas` kabul eder, `compare` reddeder", gunKiyasli.length >= 3 && gunKiyasli.every(([, s]) => !red(s, { from: "2026-10-01", to: "2026-10-07", kiyas: "prevYear" }) && red(s, { compare: "prev" })), gunKiyasli.map(([a]) => a).join(","));

// §4 R1-VARYANT (2026-10-25): `varyant` yalnız ucun BEYANLI boyutundan (katalogda olup kaynağı süzemeyen boyut dahil
// dışı 400), `donemler` "birim:adet" (2–12). NEGATİF SONDA 2026-10-25: `variantQueryKeys` enum'u katalogun TÜM
// boyutlarına açıldı → §4b ❌; geri alındı → ✅.
console.log("\n── §4 R1-VARYANT: varyant + dönem anahtarları ──");
const tumV2 = [...Object.entries(temelUretim), ...Object.entries(temelSatis), ...Object.entries(temelDokumaFinans)]
  .filter(([ad]) => /^core\w+QuerySchema$/.test(ad)) as [string, { safeParse: (v: unknown) => { success: boolean } }][];
const donemsiz = tumV2.filter(([, sch]) => red(sch, { donemler: "ay:6" }) || !red(sch, { donemler: "ay:13" }) || !red(sch, { donemler: "yil:2" }));
check("§4a her v2 ucu `donemler=ay:6` kabul eder, ay:13 / yil:2 reddeder", tumV2.length >= 14 && donemsiz.length === 0, donemsiz.map(([a]) => a).join(",") || `${tumV2.length} şema`);
const kirilim = [
  ["siparis-talep musteri ✓ · renk ✗", !red(temelSatis.coreOrderDemandQuerySchema, { varyant: "musteri" }) && red(temelSatis.coreOrderDemandQuerySchema, { varyant: "renk" })],
  ["vazgecilen-is her varyant ✗", red(temelSatis.coreLostWorkQuerySchema, { varyant: "musteri" })],
  ["fasoncular fasoncu ✓ · renk ✗", !red(temelUretim.coreSubcontractorsQuerySchema, { varyant: "fasoncu" }) && red(temelUretim.coreSubcontractorsQuerySchema, { varyant: "renk" })],
  ["duruslar vardiya ✓ · tezgah ✗", !red(temelDokumaFinans.coreLoomStopsQuerySchema, { varyant: "vardiya" }) && red(temelDokumaFinans.coreLoomStopsQuerySchema, { varyant: "tezgah" })],
  ["depo her varyant ✗", red(temelUretim.coreWarehouseQuerySchema, { varyant: "urun" })],
] as const;
check("§4b ⭐ beyanda olmayan kırılım 400 (katalogda olsa bile kaynak süzemiyorsa)", kirilim.every(([, ok]) => ok), kirilim.filter(([, ok]) => !ok).map(([a]) => a).join(" · ") || "beşi de doğru");
check("§4c görünüm anlamlı `varyant` (üretim akışı/kalite) korunur", !red(temelUretim.coreProductionFlowQuerySchema, { varyant: "operator" }) && red(temelUretim.coreProductionFlowQuerySchema, { varyant: "musteri" }));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
