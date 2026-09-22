// =============================================================================
// Bekçi: NUMARA SERİSİ (2026-09-22) — DB'siz
//   §1 Tohum biçim == BUGÜNKÜ üreteç: katalogdaki her seri, değişiklikten önceki
//      kodu BİREBİR üretmeli (Faz A'nın tek vaadi "kullanıcı hiçbir fark görmez")
//   §2 Kapı: ön ek karakter kümesi · hane aralığı · ayraç · kilitli seri
//   §3 Ön ek ÇAKIŞMASI yalnız TARAMA UZAYINDA küresel — bugünkü zararsız
//      çakışmalar (KS · IADE · P) kırmızı VERMEMELİ
//   §4 Emekli ön ek hâlâ çözülür (eski etiket okunmaya devam eder)
//   §5 Hane taşması GENİŞLER, sarmaz; tam-format doğrulaması 5 haneliyi KABUL eder
//   §6 Tarih segmenti = sıfırlama dönemi (günlük · aylık · yıllık · hiç)
//   §7 Tek kaynak: biçimlendirici `utils/code-format`ı yalnız servis import eder
//   §8 INFIX (top barkodunun faz harfi) tarih ile sıra ARASINDA eşleşir
//   §9 Okutulan serilerin TOHUM ön ekleri birbirinin başlangıcı DEĞİL
//  §10 SAYACIN KAPSAMI: biçim değişince sayaç eski rejimin kodlarını SAYMAZ,
//      ürettiği kod var olanla ÇAKIŞMAZ, ve hazır olmayan seri DÜZENLENEMEZ
// ⭐ Negatif sonda (2026-09-22, ölçüldü): katalogda `sack` ön ekini "CX" yapınca §1 ❌;
//    `assertSeriesFormatAllowed`tan çakışma döngüsü silinince §3 ❌; `matchesSeries`teki
//    `\d{digits,}` → `\d{digits}` yapılınca §5 ❌; §7'de servise ikinci import eklenince ❌;
//    katalogdaki `roll.infix` silinince §8 ❌ (6 iddia) ve `matchesSeries`ten
//    `${infix}` çıkarılınca §8 ❌ (4 iddia); ikisinde de geri alınca 34/34 yeşil.
//    Kataloğa ön eki `CVX` olan geçici bir `scanned` seri eklenince §9 ❌1 (+ §1 ❌2,
//    katalog büyüdüğü için — beklenen). §10 ÜÇ KOLLU: `nextSeriesNo`tan kapsam
//    (`since`) filtresi kalkınca ❌ · çakışma atlama döngüsü kalkınca ❌ ·
//    `updateSeriesFormat`taki `scopedCounter` kapısı kalkınca ❌.
// Çalıştır: npx tsx scripts/test_number_series.ts
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { NUMBER_SERIES_CATALOG } from "../src/constants/number-series-catalog";
import {
  assertSeriesFormatAllowed,
  formatSeriesCode,
  matchesSeries,
  resolveSeriesFormat,
  seriesClassifierTable,
  seriesPrefix,
  seriesSeqFrom,
  type NumberSeriesFormat,
} from "../src/services/number-series.service";
import { buildDailyCode, dailyCodePrefix } from "../src/utils/code-format";
import { factoryYmd } from "../src/constants/time";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
function throws(fn: () => void, code: string): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    const d = (e as { details?: { code?: string } }).details;
    return d?.code === code;
  }
}

const SRC = join(__dirname, "../src");
const AT = new Date("2026-09-22T08:00:00.000Z");

// ── §1 Tohum biçim == bugünkü üreteç ───────────────────────────────────────
// Bugünkü kalıp `PREFIX + GGAAYY + NNNN` (ya da ayraçlı/tarihsiz varyantı). Seri
// tablosu boşken `resolveSeriesFormat` tohuma düşer; ürettiği kod ESKİ üreteçle
// birebir aynı olmalı, yoksa Faz A davranış değiştirmiş demektir.
const ymd = factoryYmd(AT);
const yymm = `${ymd.slice(2, 4)}${ymd.slice(5, 7)}`;
const BEKLENEN: Record<string, string> = {
  sack: `${buildDailyCode("CV", 1, AT)}`,
  shipment: `${buildDailyCode("SVK", 1, AT)}`,
  swatch: `${buildDailyCode("KRT", 1, AT)}`,
  roll: `${dailyCodePrefix("T", AT)}0001`,
  workOrder: `${buildDailyCode("IE", 1, AT)}`,
  order: `${buildDailyCode("SIP", 1, AT)}`,
  manifest: `${buildDailyCode("CL", 1, AT)}`,
  goodsReceipt: `${buildDailyCode("MK", 1, AT)}`,
  purchaseOrder: `${buildDailyCode("AS", 1, AT)}`,
  warehouseTransfer: `${buildDailyCode("DT", 1, AT)}`,
  stockCount: `${buildDailyCode("SAY", 1, AT)}`,
  freeDocument: `${buildDailyCode("SB", 1, AT)}`,
  subcontractorDispatch: `${buildDailyCode("FS", 1, AT)}`,
  subcontractorReceipt: `${buildDailyCode("FK", 1, AT)}`,
  kartelaDispatch: `${buildDailyCode("KS", 1, AT)}`,
  kartelaReceipt: `${buildDailyCode("KK", 1, AT)}`,
  directShipment: `${buildDailyCode("DSK", 1, AT)}`,
  weavingOrder: `${buildDailyCode("DK", 1, AT)}`,
  warpBeam: `${buildDailyCode("LV", 1, AT)}`,
  doffEvent: `${buildDailyCode("DF", 1, AT)}`,
  cashTransaction: `${buildDailyCode("KH", 1, AT)}`,
  invoiceSales: `${buildDailyCode("SF", 1, AT)}`,
  invoicePurchase: `${buildDailyCode("AF", 1, AT)}`,
  invoiceSalesReturn: `${buildDailyCode("SI", 1, AT)}`,
  invoicePurchaseReturn: `${buildDailyCode("AI", 1, AT)}`,
  paymentIn: `${buildDailyCode("TH", 1, AT)}`,
  paymentOut: `${buildDailyCode("OD", 1, AT)}`,
  chequeReceived: `${buildDailyCode("CKA", 1, AT)}`,
  chequeIssued: `${buildDailyCode("CKV", 1, AT)}`,
  noteReceived: `${buildDailyCode("SNA", 1, AT)}`,
  noteIssued: `${buildDailyCode("SNV", 1, AT)}`,
  chequeDeliveryNote: `${buildDailyCode("BRD", 1, AT)}`,
  reconciliationLetter: `${buildDailyCode("MBT", 1, AT)}`,
  customer: `${buildDailyCode("MUS", 1, AT)}`,
  subcontractor: `${buildDailyCode("FSN", 1, AT)}`,
  subcontractorCategory: `${buildDailyCode("KAT", 1, AT)}`,
  fabricProperty: `${buildDailyCode("OZL", 1, AT)}`,
  color: `${buildDailyCode("RNK", 1, AT)}`,
  station: `${buildDailyCode("IST", 1, AT)}`,
  machine: `${buildDailyCode("MAK", 1, AT)}`,
  cashAccount: `${buildDailyCode("KS", 1, AT)}`,
  bankAccount: `${buildDailyCode("BN", 1, AT)}`,
  returnReason: `${buildDailyCode("IADE", 1, AT)}`,
  productRecipe: `${buildDailyCode("REC", 1, AT)}`,
  defectType: `${buildDailyCode("HATA", 1, AT)}`,
  warehouse: `${buildDailyCode("DP", 1, AT)}`,
  routeTemplate: `${buildDailyCode("ROT", 1, AT)}`,
  // Kalıp dışı üçlü — elle yazılır ki "aynı formülle ölçüp aynı formülü doğrulama"
  // tuzağına düşmeyelim (araç gözlenenin içinde olamaz).
  packingLotCode: `PRT-${yymm}-0001`,
  packingLotName: "P-1",
  batchDaily: `P${ymd.slice(8, 10)}${ymd.slice(5, 7)}${ymd.slice(2, 4)}1`,
  returnDoc: `IADE-${ymd.slice(8, 10)}${ymd.slice(5, 7)}${ymd.slice(2, 4)}-000001`,
  item: "STK-000001",
};

let uyum = 0;
for (const e of NUMBER_SERIES_CATALOG) {
  const beklenen = BEKLENEN[e.key];
  if (beklenen === undefined) {
    check(`§1 ${e.key} — beklenen kod yazılmamış (katalog büyüdü, bekçi güncellenmedi)`, false);
    continue;
  }
  const uretilen = formatSeriesCode(resolveSeriesFormat(e.key), 1, AT);
  if (uretilen === beklenen) uyum++;
  else check(`§1 ${e.key}`, false, `beklenen ${beklenen}, üretilen ${uretilen}`);
}
check("§1 ⭐ tohum biçim bugünkü üreteçle birebir", uyum === NUMBER_SERIES_CATALOG.length, `${uyum}/${NUMBER_SERIES_CATALOG.length} seri`);
// Körlük zemini: katalog boşalırsa yukarıdaki döngü sessizce yeşil kalırdı.
check("§1 katalog boş değil", NUMBER_SERIES_CATALOG.length >= 40, `${NUMBER_SERIES_CATALOG.length} seri`);

// ── §2 Kapı ────────────────────────────────────────────────────────────────
const sackFmt = resolveSeriesFormat("sack");
const f = (over: Partial<NumberSeriesFormat>): NumberSeriesFormat => ({ ...sackFmt, ...over });

check("§2 Türkçe harfli ön ek okutulan seride reddedilir",
  throws(() => assertSeriesFormatAllowed("sack", f({ prefix: "ÇV" })), "NUMBER_SERIES_PREFIX_INVALID"));
check("§2 7 karakterlik ön ek reddedilir",
  throws(() => assertSeriesFormatAllowed("sack", f({ prefix: "ABCDEFG" })), "NUMBER_SERIES_PREFIX_INVALID"));
check("§2 hane 0 ve 9 reddedilir",
  throws(() => assertSeriesFormatAllowed("sack", f({ prefix: "PKT", digits: 0 })), "NUMBER_SERIES_DIGITS_INVALID") &&
  throws(() => assertSeriesFormatAllowed("sack", f({ prefix: "PKT", digits: 9 })), "NUMBER_SERIES_DIGITS_INVALID"));
check("§2 tanınmayan ayraç reddedilir",
  throws(() => assertSeriesFormatAllowed("sack", f({ prefix: "PKT", separator: "*" })), "NUMBER_SERIES_SEPARATOR_INVALID"));
check("§2 ⭐ kilitli seri (top barkodu · parti no · iade) değiştirilemez",
  throws(() => assertSeriesFormatAllowed("roll", f({ prefix: "TP" })), "NUMBER_SERIES_LOCKED") &&
  throws(() => assertSeriesFormatAllowed("batchDaily", f({ prefix: "PT" })), "NUMBER_SERIES_LOCKED") &&
  throws(() => assertSeriesFormatAllowed("returnDoc", f({ prefix: "IAD" })), "NUMBER_SERIES_LOCKED"));
let temizGecti = true;
try {
  assertSeriesFormatAllowed("sack", f({ prefix: "PKT" }));
} catch {
  temizGecti = false;
}
check("§2 geçerli biçim kabul edilir (kapı her şeyi reddetmiyor)", temizGecti);

// ── §3 Çakışma — yalnız tarama uzayında ────────────────────────────────────
check("§3 okutulan seride ön ekin ÖN EKİ olan yeni ön ek reddedilir (CV ↔ CV2)",
  throws(() => assertSeriesFormatAllowed("shipment", f({ prefix: "CV2" })), "NUMBER_SERIES_PREFIX_COLLISION"));
check("§3 birebir aynı ön ek reddedilir",
  throws(() => assertSeriesFormatAllowed("shipment", f({ prefix: "CV" })), "NUMBER_SERIES_PREFIX_COLLISION"));
check("§3 EMEKLİ ön ekle çakışma da reddedilir (workOrder'ın RK'si)",
  throws(() => assertSeriesFormatAllowed("shipment", f({ prefix: "RK" })), "NUMBER_SERIES_PREFIX_COLLISION"));
// ⚠️ Bu üçü BUGÜN çakışıyor ve zararsız: ayrı tablolarda yaşıyorlar ve OKUTULMUYORLAR.
// Kapı küresel olsaydı doğduğu gün üç yanlış kırmızı verirdi.
let bugunkuCakismalarTemiz = true;
for (const key of ["cashAccount", "returnReason", "packingLotName", "batchDaily"]) {
  try {
    const fmt = resolveSeriesFormat(key);
    if (key !== "batchDaily") assertSeriesFormatAllowed(key, fmt);
  } catch {
    bugunkuCakismalarTemiz = false;
  }
}
check("§3 ⭐ okutulmayan serilerin bugünkü zararsız çakışmaları (KS · IADE · P) KIRMIZI VERMEZ", bugunkuCakismalarTemiz);

// ── §4 Emekli ön ek ────────────────────────────────────────────────────────
const wo = resolveSeriesFormat("workOrder");
check("§4 yürürlükteki ön ekli kod tanınır", matchesSeries(wo, buildDailyCode("IE", 7, AT)));
check("§4 ⭐ EMEKLİ ön ekli (RK) eski kart kodu hâlâ tanınır", matchesSeries(wo, buildDailyCode("RK", 7, AT)));
check("§4 ilgisiz kod tanınmaz", !matchesSeries(wo, buildDailyCode("CV", 7, AT)));
check("§4 sınıflandırma tablosu emekli ön ekleri taşır",
  seriesClassifierTable().find((r) => r.key === "workOrder")?.prefixes.includes("RK") === true);
check("§4 sınıflandırma tablosu yalnız okutulan serileri içerir",
  seriesClassifierTable().every((r) => NUMBER_SERIES_CATALOG.find((e) => e.key === r.key)?.kind !== undefined) &&
  seriesClassifierTable().length === NUMBER_SERIES_CATALOG.filter((e) => e.kind).length);

// ── §5 Hane taşması ────────────────────────────────────────────────────────
check("§5 9999 → 4 hane", formatSeriesCode(sackFmt, 9999, AT).endsWith("9999"));
check("§5 ⭐ 10000 GENİŞLER (sarmaz)", formatSeriesCode(sackFmt, 10000, AT).endsWith("10000"));
check("§5 ⭐ 5 haneli kod tam-format doğrulamasından GEÇER (bugünkü isDailyCode reddediyordu)",
  matchesSeries(sackFmt, formatSeriesCode(sackFmt, 10000, AT)));
check("§5 eksik haneli kod reddedilir", !matchesSeries(sackFmt, `${dailyCodePrefix("CV", AT)}001`));

// ── §6 Tarih segmenti = sıfırlama dönemi ───────────────────────────────────
const gun1 = new Date("2026-09-22T08:00:00.000Z");
const gun2 = new Date("2026-09-23T08:00:00.000Z");
const ay2 = new Date("2026-10-05T08:00:00.000Z");
const yil2 = new Date("2027-02-05T08:00:00.000Z");
check("§6 GÜNLÜK: gün değişince sayaç kapsamı değişir",
  seriesPrefix(sackFmt, gun1) !== seriesPrefix(sackFmt, gun2));
const lot = resolveSeriesFormat("packingLotCode");
check("§6 AYLIK: aynı ayın iki günü AYNI kapsam, sonraki ay farklı",
  seriesPrefix(lot, gun1) === seriesPrefix(lot, gun2) && seriesPrefix(lot, gun1) !== seriesPrefix(lot, ay2));
const stk = resolveSeriesFormat("item");
check("§6 ⭐ TARİHSİZ: kapsam hiç değişmez (sayaç hiç sıfırlanmaz)",
  seriesPrefix(stk, gun1) === seriesPrefix(stk, yil2) && seriesPrefix(stk, gun1) === "STK-");

// ── §7 Tek kaynak ──────────────────────────────────────────────────────────
// `utils/code-format.ts`in BİÇİMLENDİRİCİLERİNİ (ön ek kuran üçlü) yalnız
// `number-series.service.ts` import etmeli; başka dosya import ederse ön ek
// literal olarak yazılabilir ve seri tablosu SESSİZCE devre dışı kalır.
const BICIMLENDIRICILER = ["dailyCodePrefix", "buildDailyCode", "nextDailySeq"];
function tsDosyalari(dir: string, out: string[] = []): string[] {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) tsDosyalari(p, out);
    else if (d.name.endsWith(".ts")) out.push(p);
  }
  return out;
}
const ihlaller: string[] = [];
for (const dosya of tsDosyalari(SRC)) {
  if (dosya.endsWith("utils/code-format.ts") || dosya.endsWith("services/number-series.service.ts")) continue;
  const metin = readFileSync(dosya, "utf-8");
  const imp = metin.match(/import \{[^}]*\} from "[^"]*code-format";/gs) ?? [];
  if (imp.some((blok) => BICIMLENDIRICILER.some((n) => new RegExp(`\\b${n}\\b`).test(blok)))) {
    ihlaller.push(dosya.slice(SRC.length + 1));
  }
}
check("§7 ⭐ biçimlendiricileri yalnız numara serisi servisi import eder", ihlaller.length === 0, ihlaller.join(", ") || "0 ihlal");
check("§7 tarama gerçekten dosya gördü (körlük zemini)", tsDosyalari(SRC).length > 300, `${tsDosyalari(SRC).length} dosya`);

// ── §8 Infix — tarih ile sıra ARASINDAKİ yapısal parça ─────────────────────
// Top barkodu `T + GGAAYY + [H|F] + NNNN`: faz harfi biçim AYARI değil serinin
// yapısıdır, bu yüzden katalogda yaşar ve `matchesSeries` onu atlayamaz. Bu
// olmadan Faz B'nin tek eşleştiricisi SAHADAKİ HER TOP BARKODUNU reddederdi.
const rollFmt = resolveSeriesFormat("roll");
const rollGun = dailyCodePrefix("T", AT);
check("§8 ⭐ faz harfli top barkodu (H) tanınır", matchesSeries(rollFmt, `${rollGun}H0001`));
check("§8 ⭐ faz harfli top barkodu (F) tanınır", matchesSeries(rollFmt, `${rollGun}F0123`));
check("§8 ⭐ faz harfsiz kod REDDEDİLİR (infix atlanamaz)", !matchesSeries(rollFmt, `${rollGun}0001`));
check("§8 geçersiz faz harfi reddedilir", !matchesSeries(rollFmt, `${rollGun}X0001`));
check("§8 top serisinde 5 haneli kod da tanınır (hane esnekliği infix'le birlikte çalışır)",
  matchesSeries(rollFmt, `${rollGun}H10000`));
check("§8 sınıflandırma tablosu infix'i taşır (Faz B istemcisi regex'i bundan kurar)",
  seriesClassifierTable().find((r) => r.key === "roll")?.infix === "[HF]");
check("§8 ⭐ infix'siz seriler ETKİLENMEDİ (çuval · kart · sevkiyat bugünkü gibi)",
  matchesSeries(sackFmt, buildDailyCode("CV", 7, AT)) &&
  matchesSeries(wo, buildDailyCode("IE", 7, AT)) &&
  matchesSeries(resolveSeriesFormat("shipment"), buildDailyCode("SVK", 7, AT)) &&
  seriesClassifierTable().filter((r) => r.infix !== undefined).length === 1);
check("§8 infix veri-sahipli DEĞİL: `number_series` şemasında böyle bir kolon yok",
  !readFileSync(join(SRC, "..", "prisma", "schema.prisma"), "utf-8")
    .split("model NumberSeries")[1]
    ?.split("}")[0]
    ?.includes("infix"));

// ── §9 Okutma uzayında ön-ek-içinde-ön-ek YOK ──────────────────────────────
// `classifyScannedCode` seri tablosunu SIRAYLA gezer; sıranın sonucu
// etkilememesi "hiçbir ön ek ötekinin başlangıcı değil"e bağlıdır.
// ⚠️ `assertSeriesFormatAllowed ③` bunu yalnız PANELDEN YAZMA yolunda ölçer —
// katalog TOHUMLARI o kapıdan hiç geçmez, bu yüzden burada ölçülür.
const okutulanOnekler: Array<{ key: string; prefix: string }> = [];
for (const e of NUMBER_SERIES_CATALOG) {
  if (!e.kind) continue;
  const fmt = resolveSeriesFormat(e.key);
  for (const onek of [fmt.prefix, ...fmt.retiredPrefixes]) okutulanOnekler.push({ key: e.key, prefix: onek });
}
const cakisanCiftler: string[] = [];
let karsilastirilanCift = 0;
for (let i = 0; i < okutulanOnekler.length; i++) {
  for (let j = i + 1; j < okutulanOnekler.length; j++) {
    const a = okutulanOnekler[i]!;
    const b = okutulanOnekler[j]!;
    if (a.key === b.key) continue; // aynı serinin iki ön eki aynı sonuca çözülür
    karsilastirilanCift++;
    if (a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix)) {
      cakisanCiftler.push(`${a.key}:${a.prefix} ↔ ${b.key}:${b.prefix}`);
    }
  }
}
check("§9 ⭐ tohum ön ekleri okutma uzayında çakışmıyor (sınıflandırma sırası bu yüzden önemsiz)",
  cakisanCiftler.length === 0, cakisanCiftler.join(" · ") || `${karsilastirilanCift} çift temiz`);
check("§9 körlük zemini: karşılaştırma gerçekten koştu", karsilastirilanCift >= 30,
  `${okutulanOnekler.length} ön ek · ${karsilastirilanCift} çift`);

// ── §10 Sayacın kapsamı — ARIZANIN KENDİSİ (Faz C ön koşulu C0) ───────────
// ⚠️ BU DOSYA DB'SİZ: §10 burada yalnız arızanın GERÇEK olduğunu ve "matchesSeries
// ile ele" sahte çözümünün neden işlemediğini kilitler. Davranışın kendisi
// (kapsam uygulanıyor mu · çakışma atlanıyor mu · hazır olmayan seri reddediliyor
// mu) `formatChangedAt` satırını GERÇEKTEN yazmayı gerektirir ⇒ ayrı DB'li bekçi:
// `scripts/test_number_series_scope.ts`. Bölme bilinçli; ikisi birbirine atıf yapar.
const ESKI_KODLAR = ["CV2209260001", "CV2209260002", "CV2209260003"];
const cvTarihsiz: NumberSeriesFormat = {
  prefix: "CV", dateSegment: "NONE", digits: 4, separator: "", retiredPrefixes: [],
};

check("§10a bugünkü (tarihli) biçimde sayaç doğru: eski üç kod → sıra 4",
  seriesSeqFrom(ESKI_KODLAR, dailyCodePrefix("CV", AT)) === 4);

const tarihsizBas = seriesPrefix(cvTarihsiz, AT);
const tarihsizSira = seriesSeqFrom(ESKI_KODLAR, tarihsizBas);
check("§10b ⭐ ARIZA GERÇEK: tarih segmenti düşünce sabit baş kısalır ve eski kodlar sayaca girer",
  tarihsizBas === "CV" && tarihsizSira === 2_209_260_004,
  `sabit baş "${tarihsizBas}" → sıra ${tarihsizSira} (beklenen 4 değil)`);
check("§10b ⭐ `matchesSeries` bu kodları ELEYEMEZ — 'matchesSeries ile filtrele' SAHTE çözümdür",
  ESKI_KODLAR.every((k) => matchesSeries(cvTarihsiz, k)),
  "hane taşması kuralı gereği on haneli kuyruk da meşru, ve bu DOĞRU");

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
