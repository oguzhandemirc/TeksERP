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
//  §13 EMEKLİ BİÇİMLER: hane/segment değişiminden sonra eski kod hâlâ tanınır
//      (boş listede davranış bugünküyle birebir; ekleme ÜST KÜMEDİR)
//  §12 SAYAÇ ÇEKİRDEĞİ: ayar yokken bugünkü davranış · başlangıç · adım · üst
//      sınır · taşma haneyi genişletir
//  §14 YENİ TARİH SEGMENTLERİ (DDMMYYYY · MMYY · YYYYMMDD) + İKİNCİ AYRAÇ:
//      her segment ÜRET + EŞLEŞTİR birlikte · `separator2` yok/null iken
//      davranış BAYT BAYT bugünküyle aynı · `NONE`da ikinci eklem yok
//  §11 ÜRETEÇ SERİYİ SÜRÜYOR: ön eki seriden alıp HANEYİ literal yazan üreteç
//      yok (a: yapısal · b: ölçülmüş literal şekil) · beyanlı istisna kilitli
//      olmak zorunda (c) · ön ek ile kod AYNI tarihten doğar (d, "iki tarih")
// ⭐ §14 negatif sondaları (2026-09-23, D5②; her biri geri alınıp `cmp`lendi):
//    ⑦ üreteç ikinci eklemde `sep1` kullanınca §14b ❌2 + §14f ❌1 · ⑧ eşleştirici
//    `sepB` yerine `sep` kurunca §14b ❌1 · ⑨ `DDMMYYYY` sırası ters çevrilince
//    §14a ❌1 · ⑩b tarih boşken `sep2` kullanılınca §14d ❌1.
//    ⚠️ BİR SONDA ISIRMADI ve bu bir BULGUYDU: `seriesJoints` içindeki
//    `dateSegment === "NONE" ? sep1` dalını kaldırdım, HİÇBİR iddia kırmızı
//    vermedi — çünkü üreteç de eşleştirici de tarih boşken ikinci eklemi zaten
//    hiç kurmuyor, yani o dal ÖLÜ KODDU. Dal kaldırıldı; §14d artık gerçekten
//    ulaşılan yolu (`dt === ""` kolu) ölçüyor ve ⑩b ile ısırdığı doğrulandı.
//    ⇒ Sonda ısırmayınca ilk soru "sonda mı zayıf" değil, "korunan davranış
//    GERÇEKTEN o kodda mı yaşıyor" olmalı.
// ⭐ Negatif sonda (2026-09-22, ölçüldü): katalogda `sack` ön ekini "CX" yapınca §1 ❌;
//    `assertSeriesFormatAllowed`tan çakışma döngüsü silinince §3 ❌; `matchesSeries`teki
//    `\d{digits,}` → `\d{digits}` yapılınca §5 ❌; §7'de servise ikinci import eklenince ❌;
//    katalogdaki `roll.infix` silinince §8 ❌ (6 iddia) ve `matchesSeries`ten
//    `${infix}` çıkarılınca §8 ❌ (4 iddia); ikisinde de geri alınca 34/34 yeşil.
//    Kataloğa ön eki `CVX` olan geçici bir `scanned` seri eklenince §9 ❌1 (+ §1 ❌2,
//    katalog büyüdüğü için — beklenen). §10 ÜÇ KOLLU: `nextSeriesNo`tan kapsam
//    (`since`) filtresi kalkınca ❌ · çakışma atlama döngüsü kalkınca ❌ ·
//    `updateSeriesFormat`taki `scopedCounter` kapısı kalkınca ❌.
// ⭐ Negatif sonda §11 (2026-09-23, ölçüldü — İKİ YÖNLÜ): `customer.service`teki
//    `buildSeriesCode("customer", seq, now)` eski literale (`${prefix}${String(seq)
//    .padStart(4,"0")}`) geri çevrilince §11a ❌1 ve §11b ❌1 · katalogdaki
//    `roll.uretecBagi` silinince §11b ❌1 (muafiyet beyandan okunuyor, gömülü
//    listeden değil) · `roll.lockedReason` silinince §11c ❌1 · `base.service`te
//    `buildSeriesCode(cfg.series, seq, now)` → `(cfg.series, seq)` yapılınca §11d ❌1.
//    Hepsinde geri alınca yeşil (POZİTİF yön: ihlal düzelince taban DÜŞÜYOR).
// Çalıştır: npx tsx scripts/test_number_series.ts
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { NUMBER_SERIES_CATALOG } from "../src/constants/number-series-catalog";
import { formatSeriesCode, matchesSeries, resolveSeriesFormat, seriesClassifierTable, seriesPrefix, seriesSeqFrom, type NumberSeriesFormat } from "../src/services/number-series.service";
import { assertSeriesFormatAllowed } from "../src/services/helpers/series-write.helper";
import { buildDailyCode, dailyCodePrefix } from "../src/utils/code-format";
import {
  nextCounterCandidate,
  nextCounterSeq,
  type SeriesCounterSettings,
} from "../src/services/helpers/series-counter.helper";
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
// ⚠️ `returnDoc` bu listeden ÇIKTI (Faz C2): kilidin gerekçesi "sayaç YOK,
// numara `id`den türetiliyor" idi; `returnNo` kolonu doğup geçmiş geri
// doldurulunca gerekçe ORTADAN KALKTI. Kilit gerekçesiyle birlikte kalkar —
// gerekçesi çürüyen bir kilit, kilit değil kalıntıdır.
check("§2 ⭐ YAPISAL kilitli seri (top barkodu · parti no) değiştirilemez",
  throws(() => assertSeriesFormatAllowed("roll", f({ prefix: "TP" })), "NUMBER_SERIES_LOCKED") &&
  throws(() => assertSeriesFormatAllowed("batchDaily", f({ prefix: "PT" })), "NUMBER_SERIES_LOCKED"));
check("§2 ⭐ `returnDoc` ARTIK yapısal kilitli DEĞİL (kolon doğdu, gerekçe çürüdü)",
  !throws(() => assertSeriesFormatAllowed("returnDoc", f({ prefix: "IAD", digits: 6, separator: "-" })), "NUMBER_SERIES_LOCKED"));
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
  seriesSeqFrom(sackFmt, ESKI_KODLAR, dailyCodePrefix("CV", AT)) === 4);

const tarihsizBas = seriesPrefix(cvTarihsiz, AT);
const tarihsizSira = seriesSeqFrom(cvTarihsiz, ESKI_KODLAR, tarihsizBas);
check("§10b ⭐ ARIZA GERÇEK: tarih segmenti düşünce sabit baş kısalır ve eski kodlar sayaca girer",
  tarihsizBas === "CV" && tarihsizSira === 2_209_260_004,
  `sabit baş "${tarihsizBas}" → sıra ${tarihsizSira} (beklenen 4 değil)`);
check("§10b ⭐ `matchesSeries` bu kodları ELEYEMEZ — 'matchesSeries ile filtrele' SAHTE çözümdür",
  ESKI_KODLAR.every((k) => matchesSeries(cvTarihsiz, k)),
  "hane taşması kuralı gereği on haneli kuyruk da meşru, ve bu DOĞRU");

// ── §11 Üreteç seriyi SÜRÜYOR mu? ─────────────────────────────────────────
// Faz A'nın vaadi "ön ek/tarih/hane artık VERİ". §7 bu vaadi bir yönden korur
// (kimse `code-format`ın biçimlendiricisini import etmesin). Ama ÖLÇÜLDÜ
// (2026-09-23): üç üreteç `seriesCodePrefix`i çağırıp ön eki seriden alıyor,
// sonra kuyruğu `String(seq).padStart(4, "0")` ile KENDİ kuruyordu. Yani ön ek
// veriden, HANE koddan geliyordu. Fabrika haneyi 5 yapsaydı önizleme 5, yazılan
// kod 4 hane olurdu — kullanıcının değişmezinin ("programdaki ile çıktı aynı
// olmalı") birebir ihlali, üstelik SESSİZ.
//
// ⚠️ İKİ KOL BİRDEN gerekiyor ve biri ötekinin yerine geçmez:
//   a) YAPISAL — SIRA HESAPLAYAN dosya kodu da AYNI biçimden kurmalı. Yazım
//      biçiminden bağımsız; `padStart` yerine `pad()` yazan sapmayı da yakalar.
//      ⚠️ ANTECEDENT `seriesSeqFrom(`, `seriesPrefix(` DEĞİL — ve bu SINIR
//      ÖLÇÜLEREK daraltıldı (2026-09-23): ön eki alan her dosya üreteç değildir.
//      `series-exhaustion.helper` ön eki TARAMA PENCERESİ için, `series-write.helper`
//      UZUNLUK ÖLÇMEK için alıyor; ikisi de kod ÜRETMİYOR. Geniş yüklem bu iki
//      dosyayı yanlış kırmızıya soktu; "ön eki alan = üreteç" beyansız bir
//      varsayımdı. Üreteç olmanın ölçülebilir imzası SIRAYI HESAPLAMAKTIR.
//   b) ŞEKİL — ölçülmüş literal kalıbı. (a)'yı geçen bir dosyada TEK bir
//      fonksiyon hâlâ elle kuruyorsa (dosyada başka yerde `buildSeriesCode`
//      varken) yalnız bu kol görür.
const SERI_SIRASI = "seriesSeqFrom(";
const SERI_ONEKI = "seriesPrefix(";
const SERI_KODU = "formatSeriesCode(";
/**
 * ⚠️ YORUMLAR SOYULUR — bu bekçi ilk yazımında ÜÇ YANLIŞ KIRMIZI verdi: §11a,
 * §11d ve §11e, kuralın KENDİSİNİ anlatan yorum cümlelerini kod sanmıştı
 * (`series-panel.helper.ts`te "…`seriesPrefix()` değil `fmt.prefix`" diyen satır,
 * `number-series.service.ts`te silinen sarmalayıcıları anan not). Bir tarayıcı
 * KODU ölçmeli, kuralın anlatımını değil; yoksa kuralı en iyi belgeleyen dosya
 * en çok ihlal eden dosya görünür.
 */
function kodSatirlari(metin: string): string {
  return metin
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}
const kaynakDosyalari = tsDosyalari(SRC).filter(
  (d) => !d.endsWith("services/number-series.service.ts") && !d.endsWith("helpers/series-format.helper.ts"),
);
const yapisalIhlal: string[] = [];
let onekCagiranDosya = 0;
for (const dosya of kaynakDosyalari) {
  const metin = kodSatirlari(readFileSync(dosya, "utf-8"));
  if (!metin.includes(SERI_SIRASI)) continue;
  onekCagiranDosya++;
  if (!metin.includes(SERI_KODU)) yapisalIhlal.push(dosya.slice(SRC.length + 1));
}
check("§11a ⭐ SIRA hesaplayan her üreteç kodu da AYNI biçimden kurar (`formatSeriesCode`)",
  yapisalIhlal.length === 0, yapisalIhlal.join(", ") || `${onekCagiranDosya} üreteç dosyası temiz`);
check("§11a körlük zemini: sıra hesaplayan dosya gerçekten bulundu", onekCagiranDosya >= 10,
  `${onekCagiranDosya} dosya`);

// Muafiyet KATALOGTAN okunur — bekçinin içine gömülü bir liste, beyanla ayrışırdı.
const tarifEdenUretecler = new Set(
  NUMBER_SERIES_CATALOG.filter((e) => e.uretecBagi).map((e) => e.uretecBagi!.uretec),
);
// Ölçülmüş şekil: `${onEk}${String(sira).padStart(<sayı>, "0")}` — ön ekin hemen
// ardına elle kurulmuş dolgulu kuyruk. Tarih biçimleyicileri (`String(x).padStart(2,"0")`)
// bu kalıba UYMAZ çünkü önlerinde bir `${...}` ön eki yoktur; sınır BEYANLIDIR.
const LITERAL_HANE_RE = /\$\{[A-Za-z_$][A-Za-z0-9_$]*\}\$\{String\([^)]*\)\.padStart\(\s*[0-9]+/;
const sekilIhlal: string[] = [];
for (const dosya of kaynakDosyalari) {
  const goreli = dosya.slice(SRC.length + 1);
  if (tarifEdenUretecler.has(goreli)) continue;
  if (LITERAL_HANE_RE.test(kodSatirlari(readFileSync(dosya, "utf-8")))) sekilIhlal.push(goreli);
}
check("§11b ⭐ hiçbir üreteç ön ekin ardına LİTERAL haneli kuyruk yazmıyor",
  sekilIhlal.length === 0, sekilIhlal.join(", ") || `${kaynakDosyalari.length} dosya tarandı`);
check("§11b körlük zemini: kalıp gerçekten eşleşebiliyor (ölü regex değil)",
  LITERAL_HANE_RE.test('`${prefix}${String(seq).padStart(4, "0")}`'));
check("§11b muafiyet BEYANDAN okunuyor ve beyanlı üreteç dosyası GERÇEKTEN var",
  tarifEdenUretecler.size > 0 &&
    [...tarifEdenUretecler].every((u) => kaynakDosyalari.some((d) => d.endsWith(u))),
  [...tarifEdenUretecler].join(", ") || "beyan yok");

// c) Sürmediğimiz bir biçimi panelden düzenlemeye AÇAMAYIZ.
const beyanliAmaKilitsiz = NUMBER_SERIES_CATALOG.filter((e) => e.uretecBagi && !e.lockedReason);
check("§11c ⭐ üreteci SÜRMEYEN seri panelden düzenlenemez (`lockedReason` zorunlu)",
  beyanliAmaKilitsiz.length === 0,
  beyanliAmaKilitsiz.map((e) => e.key).join(", ") ||
    `${NUMBER_SERIES_CATALOG.filter((e) => e.uretecBagi).length} beyan denetlendi`);

// d) "İKİ TARİH" sınıfı: ön ek bir `new Date()`ten, kod BAŞKA bir `new Date()`ten
// doğarsa gece yarısında dünün ön ekiyle taranıp bugünün ön ekiyle yazılır —
// sıra 1'e döner ve `@unique` çakışır. İkisi de AÇIK tarih argümanı almalı.
function cagriArgumanSayisi(metin: string, ad: string): number[] {
  const sonuc: number[] = [];
  let i = metin.indexOf(ad);
  while (i !== -1) {
    let derinlik = 0, virgul = 0, bos = true;
    for (let j = i + ad.length - 1; j < metin.length; j++) {
      const c = metin[j]!;
      if (c === "(") derinlik++;
      else if (c === ")") { derinlik--; if (derinlik === 0) break; }
      else if (derinlik === 1) {
        if (c === ",") virgul++;
        else if (!/\s/.test(c)) bos = false;
      }
    }
    sonuc.push(bos ? 0 : virgul + 1);
    i = metin.indexOf(ad, i + 1);
  }
  return sonuc;
}
const tarihsizCagri: string[] = [];
let sayilanCagri = 0;
for (const dosya of kaynakDosyalari) {
  const metin = kodSatirlari(readFileSync(dosya, "utf-8"));
  const goreli = dosya.slice(SRC.length + 1);
  for (const [ad, gerekli] of [[SERI_ONEKI, 2], [SERI_KODU, 3]] as const) {
    for (const n of cagriArgumanSayisi(metin, ad)) {
      sayilanCagri++;
      if (n < gerekli) tarihsizCagri.push(`${goreli}:${ad.slice(0, -1)}(${n} argüman)`);
    }
  }
}
check("§11d ⭐ ön ek ile kod AYNI açık tarihten doğar (örtük `new Date()` yok)",
  tarihsizCagri.length === 0, tarihsizCagri.join(", ") || `${sayilanCagri} çağrı denetlendi`);
check("§11d körlük zemini: argüman sayacı gerçekten sayıyor",
  cagriArgumanSayisi('formatSeriesCode(f, seriesSeqFrom(f, a, b), d)', SERI_KODU)[0] === 3 &&
    cagriArgumanSayisi('seriesPrefix(f)', SERI_ONEKI)[0] === 1 &&
    sayilanCagri >= 20,
  `${sayilanCagri} çağrı`);

// ⚠️ §11e — SİLİNEN SARMALAYICILAR GERİ GELMESİN. `seriesCodePrefix(key)` ve
// `buildSeriesCode(key)` her biri KENDİ okumasını yapıyordu: bir üreteç ön eki
// bir okumadan, kodu BAŞKA bir okumadan alırdı ve arada bir önbellek tazelemesi
// olursa ön ek eski sürümden, hane/adım yeni sürümden gelirdi. D2①'de silindiler;
// bu kol "yarın biri kolaylık olsun diye geri ekler" ihtimaline karşı duruyor.
const geriGelen: string[] = [];
for (const dosya of tsDosyalari(SRC)) {
  const metin = kodSatirlari(readFileSync(dosya, "utf-8"));
  if (/\bseriesCodePrefix\s*\(/.test(metin) || /\bbuildSeriesCode\s*\(/.test(metin)) {
    geriGelen.push(dosya.slice(SRC.length + 1));
  }
}
check("§11e ⭐ anahtardan KENDİ okumasını yapan sarmalayıcı yok (iki okuma sınıfı)",
  geriGelen.length === 0, geriGelen.join(", ") || `${tsDosyalari(SRC).length} dosya temiz`);

// ── §12 SAYAÇ ÇEKİRDEĞİ — başlangıç · adım · üst sınırın TEK sahibi ────────
// ⚠️ D2①'de hiçbir serinin sayaç ayarı DOLU DEĞİL; bu bölüm çekirdeğin
// DAVRANIŞINI kilitler ki ② verisi indiğinde sürpriz olmasın. En önemli iddia
// İLKİ: boş ayarla sonuç bugünküyle BİREBİR aynı.
const bos: SeriesCounterSettings = {};
check("§12a ⭐ AYAR YOKKEN sonuç bugünkü davranış: max + 1",
  nextCounterSeq(bos, 0, "t") === 1 && nextCounterSeq(bos, 3, "t") === 4 &&
  nextCounterSeq(bos, 2_209_260_003, "t") === 2_209_260_004);
check("§12b başlangıç: maksimumun ÜSTÜNDEyse oraya atlar",
  nextCounterSeq({ startValue: 1000 }, 0, "t") === 1000 &&
  nextCounterSeq({ startValue: 1000 }, 999, "t") === 1000);
check("§12b ⭐ başlangıç maksimumun ALTINDAysa ETKİSİZ (geçmişi ezmek mükerrer kod üretirdi)",
  nextCounterSeq({ startValue: 10 }, 500, "t") === 501);
check("§12c ⭐ adım: dizinin İÇİNDE kalır (1, 11, 21 … — 2 üretmez)",
  nextCounterSeq({ step: 10 }, 0, "t") === 1 &&
  nextCounterSeq({ step: 10 }, 1, "t") === 11 &&
  nextCounterSeq({ step: 10 }, 11, "t") === 21 &&
  nextCounterSeq({ step: 10 }, 12, "t") === 21);
check("§12c başlangıç + adım birlikte: 100, 110, 120 …",
  nextCounterSeq({ startValue: 100, step: 10 }, 0, "t") === 100 &&
  nextCounterSeq({ startValue: 100, step: 10 }, 100, "t") === 110 &&
  nextCounterSeq({ startValue: 100, step: 10 }, 105, "t") === 110);
check("§12d ⭐ üst sınır aşımı 409 `NUMBER_SERIES_RANGE_EXHAUSTED` (sessiz sarma YOK)",
  throws(() => nextCounterSeq({ maxValue: 500 }, 500, "t"), "NUMBER_SERIES_RANGE_EXHAUSTED"));
check("§12d sınırın ALTINDA sorun yok", nextCounterSeq({ maxValue: 500 }, 498, "t") === 499);
check("§12d ⭐ sınır YOKKEN taşma HANEYİ genişletir, sarmaz (İ3 aynen)",
  nextCounterSeq(bos, 9_999, "t") === 10_000 &&
  formatSeriesCode({ prefix: "CV", dateSegment: "NONE", digits: 4, separator: "", retiredPrefixes: [] }, 10_000) === "CV10000");
check("§12e ⭐ atlama adayı ADIM kadar ilerler (`++` değil)",
  nextCounterCandidate(bos, 5) === 6 && nextCounterCandidate({ step: 10 }, 11) === 21);

// ── §13 EMEKLİ BİÇİMLER — hane/segment ekseni (D4②) ───────────────────────
// ⭐ ARIZA ÖLÇÜLDÜ (2026-09-23): `retiredPrefixes` yalnız ÖN EK eksenini
// koruyordu; emekli ön ek YÜRÜRLÜKTEKİ hane ile deneniyordu. Hane 4 → 6
// yapılınca dünkü kod TANINMIYORDU. Emekli BİÇİM kendi hanesiyle denenir.
const DUN = new Date("2026-09-22T08:00:00.000Z");
const eskiKod = `${dailyCodePrefix("CV", DUN)}0001`; // CV2209260001 (4 hane)

const haneArtti: NumberSeriesFormat = {
  prefix: "CV", dateSegment: "DDMMYY", digits: 6, separator: "", retiredPrefixes: [],
};
check("§13a ⭐ ARIZA GERÇEK: hane artınca eski kod emekli biçim OLMADAN tanınmıyor",
  !matchesSeries(haneArtti, eskiKod), eskiKod);
check("§13b ⭐ emekli BİÇİM eklenince eski kod yine tanınıyor",
  matchesSeries(
    { ...haneArtti, retiredFormats: [{ prefix: "CV", dateSegment: "DDMMYY", digits: 4, separator: "" }] },
    eskiKod,
  ));
check("§13c emekli biçim YANLIŞ kodu tanımaz (kapı fazla geniş değil)",
  !matchesSeries(
    { ...haneArtti, retiredFormats: [{ prefix: "CV", dateSegment: "DDMMYY", digits: 4, separator: "" }] },
    "XX2209260001",
  ));
check("§13d ⭐ emekli biçim listesi BOŞKEN davranış bugünküyle BİREBİR (fail-safe)",
  matchesSeries({ ...sackFmt, retiredFormats: [] }, buildDailyCode("CV", 7, AT)) &&
    matchesSeries(sackFmt, buildDailyCode("CV", 7, AT)));
// ⚠️ ÜST KÜME OLMA ŞARTI: emekli biçim eklemek hiçbir kodu TANINMAZ yapmamalı.
check("§13e ⭐ emekli biçim eklemek ESKİ eşleşmeleri BOZMAZ (üst küme)",
  matchesSeries(
    { ...sackFmt, retiredFormats: [{ prefix: "ZZ", dateSegment: "YYMM", digits: 8, separator: "-" }] },
    buildDailyCode("CV", 7, AT),
  ));

// ── §14 YENİ TARİH SEGMENTLERİ + İKİNCİ AYRAÇ (D5②) ────────────────────────
// ⚠️ ASIL RİSK "üretilen metin doğru mu" DEĞİL, ÜRETEÇ İLE EŞLEŞTİRİCİNİN
// AYRIŞMASIDIR: ikisi ayrı yerde kurulursa sonuç "kendi ürettiğim kod kendi
// serime uymuyor" olur ve bu SESSİZDİR (her iki yol da kendi içinde tutarlı).
// Bu yüzden her segment için ÜRET + EŞLEŞTİR birlikte ölçülür.
const D5AT = new Date("2026-09-23T10:00:00+03:00");
function segFmt(
  dateSegment: NumberSeriesFormat["dateSegment"],
  extra: Partial<NumberSeriesFormat> = {},
): NumberSeriesFormat {
  return { prefix: "PRT", dateSegment, digits: 4, separator: "", retiredPrefixes: [], ...extra };
}
for (const [segment, beklenen] of [
  ["DDMMYYYY", "PRT230920260001"],
  ["MMYY", "PRT09260001"],
  ["YYYYMMDD", "PRT202609230001"],
] as const) {
  const fmt = segFmt(segment);
  const kod = formatSeriesCode(fmt, 1, D5AT);
  check(`§14a ${segment} beklenen metni üretiyor`, kod === beklenen, kod);
  check(`§14a ⭐ ${segment}: ÜRETİLEN kod kendi serisine UYUYOR (üreteç ↔ eşleştirici)`,
    matchesSeries(fmt, kod), kod);
}
// İkinci ayraç: tarih ile sayaç arasındaki eklem ayrı olabilir.
const ikiAyrac = segFmt("YYMM", { separator: "-", separator2: "/" });
check("§14b ⭐ ikinci ayraç ÜRETİMDE tarihten SONRAKİ eklemde",
  formatSeriesCode(ikiAyrac, 1, D5AT) === "PRT-2609/0001", formatSeriesCode(ikiAyrac, 1, D5AT));
check("§14b ⭐ ikinci ayraçlı kod kendi serisine UYUYOR",
  matchesSeries(ikiAyrac, formatSeriesCode(ikiAyrac, 1, D5AT)));
check("§14b kapı fazla geniş değil: TEK ayraçlı biçim iki ayraçlı kodu tanımaz",
  !matchesSeries(segFmt("YYMM", { separator: "-" }), "PRT-2609/0001"));
// ⚠️ FAIL-SAFE: `separator2` yokken/`null`ken davranış BAYT BAYT bugünküyle aynı.
for (const segment of ["NONE", "DDMMYY", "YYMM", "YYYYMM", "YY", "YYYY"] as const) {
  const temel = segFmt(segment, { separator: "-" });
  const acikNull = segFmt(segment, { separator: "-", separator2: null });
  check(`§14c ⭐ ${segment}: \`separator2\` yok ile null AYNI kodu üretiyor (fail-safe)`,
    formatSeriesCode(temel, 7, D5AT) === formatSeriesCode(acikNull, 7, D5AT),
    formatSeriesCode(temel, 7, D5AT));
}
// ⚠️ TARİH YOKSA İKİNCİ EKLEM DE YOK — "ikinci ayraç" adı ancak öyle dürüst.
check("§14d ⭐ `NONE` segmentte `separator2` YOK SAYILIR (tek eklemi `separator` kurar)",
  formatSeriesCode(segFmt("NONE", { separator: "-", separator2: "/" }), 1, D5AT) === "PRT-0001",
  formatSeriesCode(segFmt("NONE", { separator: "-", separator2: "/" }), 1, D5AT));
// Emekli biçim kendi ikinci ayracıyla denenir (D4② ekseninin D5② karşılığı).
check("§14e ⭐ emekli biçim KENDİ ikinci ayracıyla tanınır",
  matchesSeries(
    segFmt("YYMM", { separator: "-", separator2: "/", retiredFormats: [
      { prefix: "PRT", dateSegment: "YYMM", digits: 4, separator: "-", separator2: "." },
    ] }),
    "PRT-2609.0001",
  ));
// ⚠️ KAPASİTE İDDİASI YAZILMADI ve gerekçesi ÖLÇÜLDÜ: izin verilen ayraç
// kümesi `"" - _ / .` yani 0–1 karakter ⇒ `separator2` sabit başı ASLA
// `separator`ın yapabileceğinden fazla uzatamaz; "ikinci ayraç kapasiteyi
// taşırır" diye bir iddia yazsaydım ÜRETİLEMEYEN bir durumu ölçüyor olurdum.
// Ölçülebilir olan şu: sabit baş ikinci eklemden ETKİLENİYOR (uzunluk
// hesabı onu görüyor) — kapasite kapısı zaten `seriesPrefix`ten okuduğu için
// bu yeterlidir.
check("§14f ⭐ sabit baş ikinci eklemi SAYIYOR (kapasite kapısı `seriesPrefix`ten okur)",
  seriesPrefix(segFmt("YYMM", { separator: "-", separator2: "" }), D5AT).length + 1 ===
    seriesPrefix(segFmt("YYMM", { separator: "-" }), D5AT).length,
  `${seriesPrefix(segFmt("YYMM", { separator: "-", separator2: "" }), D5AT)} ↔ ` +
    `${seriesPrefix(segFmt("YYMM", { separator: "-" }), D5AT)}`);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
