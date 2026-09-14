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
check("§2e ortak şemalar strict: dateRangeSchema/compareRangeSchema bilinmeyen anahtarı reddeder", red(dateRangeSchema, { installationId: "1" }) && red(compareRangeSchema, { installationId: "1" }));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
