// =============================================================================
// RAPOR VARYANT + DÖNEM KIYASI SARMALI — `services/reports/temel/_variant.ts` (R1-VARYANT; DB GEREKMEZ)
// =============================================================================
// NEDEN: küçük çoklu ve dönem kıyası temel raporun ana sayısını SARMALAR — her hücre süzgeçli, her sütun dönemi
// daraltılmış AYNI koşudur (sayı eşitliği `test_temel_rapor_esitlik` §V'de, gerçek DB). Bu bekçi sarmalın
// mekaniğini sahte koşucuyla ölçer: tavanlar (varyant ≤ 6, dönem ≤ 12), alt koşuların SIRALI olması,
// kişi adlı boyutun `kisiAdi` işareti ve bulut isteğinin bu anahtarları reddetmesi, boyut beyanının kataloğun
// alt kümesi ve ucun süzgeç anahtarı olması, dönem pencerelerinin bitişik fabrika günü takvimi olması.
// §1 beyan ↔ katalog ↔ uç şeması · §2 varyant tavanı + sıra · §3 sıralı alt koşu · §4 K-KISI (kisiAdi) + bulut
// · §5 dönem pencereleri · §6 kesit raporunda dönem değerleri ölçülemedi (sayı uydurulmaz) · §7 çip beyanı.
// NEGATİF SONDALAR (2026-10-25, md5 ile geri alındı → yeşil):
//   ① `variantCells` sıralı havuz tavanı `VARIANT_LIMIT` → `pool.values.length` → ❌ 1 (§2a: hücre 10 · koşu 11)
//   ② hücre ana sayısı süzgeçsiz ANA koşudan kopyalandı → ❌ 1 (§2c)
//   ③ `PERSON_DIMENSIONS` boşaltıldı → ❌ 1 (§4a)
//   ④ bulut `panelOnlyRejected` sarmalı `sales/siparis-talep`ten kaldırıldı → ❌ 1 (§4c)
// Koşum: npx tsx scripts/test_rapor_varyant.ts
// =============================================================================
import { REPORT_BY_KEY, type ReportKey } from "../src/constants/report-catalog";
import { factoryDayStartOfKey, factoryYmd } from "../src/constants/time";
import { CORE_VARIANT_DIMS } from "../src/services/reports/temel/core-runs";
import {
  PERIOD_LIMIT, PERSON_DIMENSIONS, VARIANT_LIMIT, VARIANT_POOL_LIMIT,
  periodRanges, periodSpecSchema, runCoreWithExtras, variantParameters,
  type CoreRunner, type VariantDimension,
} from "../src/services/reports/temel/_variant";
import type { CoreReportResult } from "../src/services/reports/temel/_common";
import type { RaporSunumu } from "../src/services/reports/sunum/sunum.types";
import * as satis from "../src/routes/reports/temel-satis.routes";
import * as uretim from "../src/routes/reports/temel-uretim.routes";
import * as dokuma from "../src/routes/reports/temel-dokuma-finans.routes";
import { findRemoteReport } from "../src/cloud-sync/report-requests";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

type Shape = { shape: Record<string, unknown> };
const SCHEMAS: Record<keyof typeof CORE_VARIANT_DIMS, Shape> = {
  "sales/siparis-talep": satis.coreOrderDemandQuerySchema,
  "sales/sevkiyat": satis.coreShippedQuerySchema,
  "sales/termin": satis.coreDeadlineQuerySchema,
  "sales/acik-siparisler": satis.coreOpenOrderQuerySchema,
  "subcontract/fasoncular": uretim.coreSubcontractorsQuerySchema,
  "dokuma/duruslar": dokuma.coreLoomStopsQuerySchema,
};

const RANGE = { from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-10-25T12:00:00.000Z") };

function fakeSunum(value: number | null): RaporSunumu {
  return {
    anahtar: "sales/siparis-talep", baslik: "t", soru: "t", donem: { from: "", to: "", etiket: "" },
    anaSayi: { olcu: "siparis.metre", ad: "Sipariş", deger: value, birim: "m" },
    yanSayilar: [], anlati: [], grafik: null, tablo: null, tanimlar: [], parametreler: [], uyarilar: [],
  };
}

/** Sahte koşucu: hücre değeri = değerin sonundaki sayı; aynı anda kaç koşu açık, ölçer. */
function fakeRunner(log: { calls: number; inFlight: number; maxInFlight: number }, total = 1000): CoreRunner {
  return async (_r, _c, cell) => {
    log.calls++;
    log.inFlight++;
    log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
    await new Promise((res) => setTimeout(res, 2));
    log.inFlight--;
    return { sunum: fakeSunum(cell ? Number(cell.deger.split("-")[1]) : total) };
  };
}

const values = (n: number) => Array.from({ length: n }, (_, i) => ({ deger: `v-${(i * 7) % n}`, etiket: `D${i}` }));
const rankedDim = (n: number): VariantDimension => ({ boyut: "musteri", suzgec: "customerId", pool: async () => ({ ranked: true, values: values(n) }) });
const unrankedDim = (n: number): VariantDimension => ({ boyut: "vardiya", suzgec: "shiftDefinitionId", pool: async () => ({ ranked: false, values: values(n) }) });

async function main(): Promise<void> {
  console.log("=== RAPOR VARYANT SARMALI ===\n── §1 beyan ↔ katalog ↔ uç şeması ──");
  const drift: string[] = [];
  for (const [key, dims] of Object.entries(CORE_VARIANT_DIMS) as [keyof typeof CORE_VARIANT_DIMS, readonly VariantDimension[]][]) {
    const catalog = REPORT_BY_KEY.get(key as ReportKey)?.varyantBoyutlari ?? [];
    for (const d of dims) {
      if (!catalog.includes(d.boyut)) drift.push(`${key}: ${d.boyut} katalogda yok`);
      if (!(d.suzgec in SCHEMAS[key].shape)) drift.push(`${key}: ${d.suzgec} uç şemasında yok`);
    }
  }
  check("§1a ⭐ her beyanlı boyut katalog `varyantBoyutlari`nda ve süzgeç anahtarı ucun şemasında", drift.length === 0, drift.join(" · ") || `${Object.keys(CORE_VARIANT_DIMS).length} uç`);

  console.log("── §2 varyant tavanı ──");
  const logA = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const a = await runCoreWithExtras({ range: RANGE, compareRange: null, run: fakeRunner(logA), dims: [rankedDim(10)], varyant: "musteri" });
  check("§2a ⭐ sıralı havuz 10 değer → en çok 6 hücre, 6 alt koşu (+1 ana)", a.sunum.varyant?.hucreler?.length === VARIANT_LIMIT && logA.calls === VARIANT_LIMIT + 1, `hücre ${a.sunum.varyant?.hucreler?.length} · koşu ${logA.calls}`);
  const logB = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const b = await runCoreWithExtras({ range: RANGE, compareRange: null, run: fakeRunner(logB), dims: [unrankedDim(15)], varyant: "vardiya" });
  const bVals = (b.sunum.varyant?.hucreler ?? []).map((h) => h.anaSayi.deger ?? -1);
  check("§2b sırasız havuz 15 değer → en çok 12 alt koşu, büyükten küçüğe ilk 6, uyarı yazılı",
    logB.calls === VARIANT_POOL_LIMIT + 1 && bVals.length === VARIANT_LIMIT && bVals.every((v, i) => i === 0 || bVals[i - 1]! >= v) && b.sunum.uyarilar.some((u) => u.includes("ilk 12")),
    `koşu ${logB.calls} · ${bVals.join(",")}`);
  check("§2c hücre ana sayısı alt koşunun ana sayısıdır (süzgeçsiz ana sayı kopyalanmaz)", (a.sunum.varyant?.hucreler ?? []).every((h) => h.anaSayi.deger === Number(h.deger.split("-")[1])));
  check("§2d hücreye tık süzgeci beyanlı (`suzgecAnahtari` = ucun anahtarı)", a.sunum.varyant?.suzgecAnahtari === "customerId" && b.sunum.varyant?.suzgecAnahtari === "shiftDefinitionId");

  console.log("── §3 alt koşular SIRALI ──");
  const logP = { calls: 0, inFlight: 0, maxInFlight: 0 };
  await runCoreWithExtras({ range: RANGE, compareRange: null, run: fakeRunner(logP), dims: [rankedDim(4)], varyant: "musteri", donemler: { birim: "ay", adet: 3 } });
  check("§3a ⭐ aynı anda en çok BİR alt koşu (Promise.all yok)", logA.maxInFlight === 1 && logB.maxInFlight === 1 && logP.maxInFlight === 1, `${logA.maxInFlight}/${logB.maxInFlight}/${logP.maxInFlight}`);

  console.log("── §4 K-KISI + bulut ──");
  const personDim: VariantDimension = { boyut: "operator", suzgec: "operatorId", pool: async () => ({ ranked: true, values: values(3) }) };
  const p = await runCoreWithExtras({ range: RANGE, compareRange: null, run: fakeRunner({ calls: 0, inFlight: 0, maxInFlight: 0 }), dims: [personDim], varyant: "operator" });
  check("§4a ⭐ kişi adlı boyut (operatör) seçilince sunum `kisiAdi:true`; müşteri kırılımı taşımaz", PERSON_DIMENSIONS.includes("operator") && p.sunum.kisiAdi === true && a.sunum.kisiAdi === undefined);
  check("§4b hiçbir temel uç kişi adlı boyutu küçük çokluya açmaz (açarsa §4a işareti şart)", Object.values(CORE_VARIANT_DIMS).flat().every((d) => !PERSON_DIMENSIONS.includes(d.boyut)));
  const cloudLeaks = Object.keys(CORE_VARIANT_DIMS).filter((k) => {
    const r = findRemoteReport(k);
    if (!r) return false;
    const dim = CORE_VARIANT_DIMS[k as keyof typeof CORE_VARIANT_DIMS][0]!.boyut;
    return r.params.safeParse({ varyant: dim }).success || r.params.safeParse({ donemler: "ay:3" }).success;
  });
  check("§4c ⭐ bulut isteği `varyant`/`donemler`i REDDEDER (panel özelliği; kişi adlı kırılım buluta yol bulamaz)", cloudLeaks.length === 0, cloudLeaks.join(",") || "hepsi red");

  console.log("── §5 dönem pencereleri (fabrika takvimi) ──");
  const end = new Date("2026-10-25T12:00:00.000Z");
  const months = periodRanges(end, { birim: "ay", adet: 6 });
  const contiguous = (rs: { from: Date; to: Date }[]) => rs.every((r, i) => i === 0 || r.from.getTime() === rs[i - 1]!.to.getTime() + 1);
  check("§5a ay:6 → 6 takvim ayı, ilk Mayıs 1'de başlar, bitişik, son dönem ana aralığın SONUNDA biter",
    months.length === 6 && months[0]!.from.getTime() === factoryDayStartOfKey("2026-05-01").getTime() && contiguous(months) && months[5]!.to.getTime() === end.getTime(),
    months.map((m) => factoryYmd(m.from)).join(","));
  const weeks = periodRanges(end, { birim: "hafta", adet: 4 });
  check("§5b hafta:4 → Pazartesi başlar, bitişik", weeks.length === 4 && weeks.every((w) => factoryYmd(w.from) && new Date(`${factoryYmd(w.from)}T12:00:00Z`).getUTCDay() === 1) && contiguous(weeks), weeks.map((w) => factoryYmd(w.from)).join(","));
  const days = periodRanges(end, { birim: "gun", adet: 7 });
  check("§5c gun:7 → 7 fabrika günü, sonuncusu bugün", days.length === 7 && factoryYmd(days[6]!.from) === factoryYmd(end) && contiguous(days));
  check("§5d ⭐ dönem tavanı: ay:12 geçer, ay:13 · ay:1 · yil:3 · 'ay' red",
    periodSpecSchema.safeParse(`ay:${PERIOD_LIMIT}`).success && !periodSpecSchema.safeParse("ay:13").success && !periodSpecSchema.safeParse("ay:1").success
      && !periodSpecSchema.safeParse("yil:3").success && !periodSpecSchema.safeParse("ay").success);
  const logD = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const d = await runCoreWithExtras({ range: RANGE, compareRange: null, run: fakeRunner(logD), dims: [], donemler: { birim: "ay", adet: 3 } });
  check("§5e her dönem bir alt koşu; sütun sayısı = adet", d.sunum.donemler?.length === 3 && logD.calls === 4, `sütun ${d.sunum.donemler?.length} · koşu ${logD.calls}`);

  console.log("── §6 kesit raporu ──");
  const logS = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const s = await runCoreWithExtras({ range: RANGE, compareRange: null, run: fakeRunner(logS), dims: [], donemler: { birim: "ay", adet: 3 }, snapshotOnly: true });
  check("§6a ⭐ kesit: dönem değerleri `null` + neden (0 değil), uyarı 'kesit görüntüsü', alt koşu YOK",
    (s.sunum.donemler ?? []).length === 3 && (s.sunum.donemler ?? []).every((x) => x.anaSayi.deger === null && !!x.anaSayi.olculemedi) && s.sunum.uyarilar.some((u) => u.includes("kesit görüntüsü")) && logS.calls === 1);

  console.log("── §7 çip beyanı ──");
  const params = variantParameters([rankedDim(1)], undefined, undefined);
  const periodParam = params.find((x) => x.ad === "donemler");
  check("§7a kırılım beyanı yalnız boyut varsa; seçim yoksa `null` (Tek)", params.find((x) => x.ad === "varyant")?.deger === null && variantParameters([], undefined, undefined).every((x) => x.ad !== "varyant"));
  check("§7b dönem seçeneklerinin her biri şemadan geçer", (periodParam?.secenekler ?? []).length > 0 && (periodParam?.secenekler ?? []).every((o) => periodSpecSchema.safeParse(o.deger).success));
  const sample: CoreReportResult = a;
  check("§7c sunum beyanı uygulanan kırılımı taşır", sample.sunum.parametreler.find((x) => x.ad === "varyant")?.deger === "musteri");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exitCode = 1;
});
