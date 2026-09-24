// =============================================================================
// SIRADAKİ NUMARA ve TÜKENME — ekran ÜRETECİN hesabını gösterir (2026-09-24)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts number_series_siradaki   (DB GEREKİR)
//
// ⭐ NEDEN VAR: Numaralandırma ekranında "Parti no (kısa, dönen)" için üreteç
//    `P08` üretirken ekran "Sıradaki numara `P2207260003`" ve "2.207.260.002 / 99
//    kullanıldı — sınıra yaklaşıldı" gösterdi (fabrika dökümünün kopyasında
//    ölçüldü). Üç ayrı ikinci hesap vardı:
//      ① önizleme ucu TASLAĞI biçim sandı → üst sınır, sarma ve kapsam damgası
//        düştü; aynı kolonu paylaşan günlük parti kodları sayaca girdi
//      ② önizleme satırları SIRASIZ okudu → sarmalı seride "en son doğan"
//        rastgele bir satırdı (`P88`)
//      ③ tükenme kendi taramasını yaptı → süzgeçsiz ve kapsamsız; sarmalı seri
//        (tanım gereği tükenmez) uyarı verdi
//
//   §1 ⭐ Sarmalı seride sıradaki numara = üreteç (taslak = yürürlükteki biçim)
//   §2 ⭐ HER seride "taslak = yürürlükteki biçim" önizlemesi override'sız
//        hesapla AYNI (taslağın düşürdüğü alan kalmadı)
//   §3 ⭐ Taslak biçimi DEĞİŞTİRİNCE kapsam şimdi başlar (kaydedilince üretecin
//        yapacağı gibi); eski rejimin/ikiz serinin kodu sayaca girmez
//   §4 ⭐ Tükenme: sarmalı seri UYARMAZ (gerekçesiyle üçüncü sonuç)
//   §5 ⭐ Tükenme: sınırlı seride kullanım yalnız O SERİNİN kodlarından ölçülür
//
// ⭐ NEGATİF SONDA (bu commit, ölçüldü — dört kol, her biri ekrandaki değeri basar):
//    A önizleme taslağı yine biçim sayınca (`{ ...taslak, retiredPrefixes }`)
//      §1 ❌2 (`P2207260003`) · §2 ❌ · §3 ❌ ·
//    B yükleyiciden `orderBy createdAt desc` kalkınca §1 ❌3 (`P51`) ·
//    C tükenmedeki sarma dalı kalkınca §4 ❌ ·
//    D tükenme süzgeçsiz/kapsamsız taramaya dönünce §5 ❌2 (`%2229555558`).
// =============================================================================
import prisma from "../src/lib/prisma";
import { refreshNumberSeriesCache, resolveSeriesFormat } from "../src/services/number-series.service";
import { previewNextNumber } from "../src/services/helpers/series-panel.helper";
import { seriesExhaustion } from "../src/services/helpers/series-exhaustion.helper";
import { NUMBER_SERIES_CATALOG, numberSeriesCatalogEntry } from "../src/constants/number-series-catalog";
import { generateBatchNumberTx } from "../src/services/batch.service";
import { resolveBatchShortNumberEnabled } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const DAMGA = `TEST-SIRADAKI-${Date.now()}`;
const GERI_AL = "__geri_al__";

/** Yürürlükteki biçimin YALNIZ eksenleri — panelin önizleme ucuna gönderdiği gövde. */
function eksenler(key: string) {
  const f = resolveSeriesFormat(key);
  return {
    prefix: f.prefix,
    dateSegment: f.dateSegment,
    digits: f.digits,
    separator: f.separator,
    separator2: f.separator2 ?? null,
  };
}

/** Parti üretecini GERİ ALINAN tx içinde koşturur — sayaç tüketilmez, satır yazılmaz. */
async function ureteceSor(): Promise<string | null> {
  let kod: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      kod = await generateBatchNumberTx(tx, new Date());
      throw new Error(GERI_AL);
    });
  } catch (e) {
    if ((e as Error).message !== GERI_AL) throw e;
  }
  return kod;
}

/**
 * §2 — her seride taslak = yürürlükteki biçim ⇒ aynı önizleme. Kısa parti
 * fikstürü KURULDUKTAN sonra koşar: boş kolonda iki hesap zaten aynı sonucu verir.
 */
async function herSeriBolumu(): Promise<void> {
  // ── §2 HER seride taslak = yürürlükteki ⇒ aynı sonuç ──────────────────
  const olculen = NUMBER_SERIES_CATALOG.filter((e) => !e.ownCounter && e.countTable);
  const ayrisan: string[] = [];
  for (const e of olculen) {
    const a = await previewNextNumber(e.key, eksenler(e.key));
    const b = await previewNextNumber(e.key);
    if (a !== b) ayrisan.push(`${e.key}: ${a} ≠ ${b}`);
  }
  check("§2 ⭐ taslak yürürlükteki biçimle aynıyken önizleme HİÇBİR seride ayrışmıyor",
    ayrisan.length === 0, ayrisan.join(" · ") || `${olculen.length} seri`);
  check("§2 körlük zemini: sayaç kaynağı olan seri sayısı ölçüldü (≥ 40)",
    olculen.length >= 40, `${olculen.length} seri`);
}

type KisaBicim = ReturnType<typeof resolveSeriesFormat>;

/** §1 §3 §4 §5 — aynı kolonda iki rejimin kodu duran kısa parti serisi. */
async function partiBolumleri(kisa: KisaBicim, batchIds: string[], woIds: string[]): Promise<void> {
  const onEk = kisa.prefix;
  // Fikstür: aynı kolonda İKİ rejimin kodu. Doğuş sırası LOAD-BEARING: en
  // büyük kısa numara (50) önce, günlük kod ortada, EN SON doğan kısa numara
  // (07) sonda — sırasız okuma 50'yi "en son" sanır.
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${DAMGA}-IE` },
    select: { id: true },
  });
  woIds.push(wo.id);
  const simdi = Date.now();
  const fikstur: Array<{ kod: string; ms: number }> = [
    { kod: `${onEk}${String(50).padStart(kisa.digits, "0")}`, ms: simdi - 120_000 },
    { kod: `${onEk}2207260002`, ms: simdi - 60_000 },
    { kod: `${onEk}${String(7).padStart(kisa.digits, "0")}`, ms: simdi - 1_000 },
  ];
  for (const f of fikstur) {
    const b = await prisma.batch.create({
      data: { batchNumber: f.kod, workOrderId: wo.id, createdAt: new Date(f.ms) },
      select: { id: true },
    });
    batchIds.push(b.id);
  }
  const beklenen = `${onEk}${String(8).padStart(kisa.digits, "0")}`;

  // ── §1 Sarmalı seride sıradaki numara = üreteç ─────────────────────────
  const ekran = await previewNextNumber("batchShort", eksenler("batchShort"));
  const yalin = await previewNextNumber("batchShort");
  check("§1 ⭐ ekranın sıradaki numarası EN SON DOĞAN koddan (taslak = yürürlükteki biçim)",
    ekran === beklenen, `${ekran} (beklenen ${beklenen})`);
  check("§1 ⭐ taslaksız önizleme de EN SON DOĞAN koddan (satırlar sıralı okunuyor)",
    yalin === beklenen, `${yalin} (beklenen ${beklenen})`);
  if (await resolveBatchShortNumberEnabled()) {
    const uretec = await ureteceSor();
    check("§1 ⭐ önizleme = GERÇEK üreteç (geri alınan tx)", uretec === ekran, `üreteç ${uretec} · ekran ${ekran}`);
  } else {
    console.log("⏭️  §1 üreteç kolu ÖLÇÜLEMEDİ — kısa parti no bayrağı bu DB'de kapalı.");
  }

  await herSeriBolumu();

  // ── §3 Taslak biçimi değiştirince kapsam ŞİMDİ başlar ──────────────────
  const yeniHane = kisa.digits + 1;
  const taslak = { ...eksenler("batchShort"), digits: yeniHane };
  const yeniBicim = await previewNextNumber("batchShort", taslak);
  const ilk = `${onEk}${String(kisa.startValue ?? 1).padStart(yeniHane, "0")}`;
  check("§3 ⭐ hane değişen taslakta sıradaki numara serinin BAŞINDAN (eski rejim sayılmaz)",
    yeniBicim === ilk, `${yeniBicim} (beklenen ${ilk})`);

  // ── §4 Tükenme: sarmalı seri uyarmaz ───────────────────────────────────
  const sarmali = await seriesExhaustion("batchShort");
  check("§4 ⭐ sarmalı seride tükenme uyarısı YOK ve yüzde ölçülmez (üçüncü sonuç)",
    !sarmali.warn && sarmali.percent === null && /başa döner/.test(sarmali.reason ?? ""),
    `${sarmali.used}/${sarmali.limit} · ${sarmali.reason ?? "(gerekçe yok)"}`);

  // ── §5 Tükenme: sınırlı seride yalnız o serinin kodları ────────────────
  // Sarma geçici kapatılır (fikstür ayarı; geri alma `finally`de BİREBİR).
  await prisma.numberSeries.update({ where: { key: "batchShort" }, data: { wrap: false } });
  await refreshNumberSeriesCache();
  const sinirli = await seriesExhaustion("batchShort");
  check("§5 ⭐ sınırlı seride kullanım yalnız o serinin kodlarından (günlük kod sayılmıyor)",
    sinirli.used !== null && sinirli.used >= 50 && sinirli.used <= (sinirli.limit ?? 0),
    `${sinirli.used}/${sinirli.limit}`);
  check("§5 kullanım sınırın altındayken yüzde 1'i aşmıyor",
    sinirli.percent !== null && sinirli.percent <= 1, `%${Math.round((sinirli.percent ?? 0) * 100)}`);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exit(1);
  }
  await refreshNumberSeriesCache();

  const batchIds: string[] = [];
  const woIds: string[] = [];
  // Seri satırı sunucu açılışında doğar; seed kurmaz. Tek başına koşumda yoksa
  // TOHUMDAN doğurulur ve sonda SİLİNİR — geri alma BİREBİR (TD-18a).
  const sayacOnce = await prisma.numberSeries.findUnique({
    where: { key: "batchShort" },
    select: { startValue: true, step: true, maxValue: true, wrap: true, formatChangedAt: true },
  });

  try {
    if (!sayacOnce) {
      const t = numberSeriesCatalogEntry("batchShort");
      await prisma.numberSeries.create({
        data: {
          key: t.key, label: t.label, prefix: t.seedPrefix, dateSegment: t.seedDateSegment,
          digits: t.seedDigits, separator: t.seedSeparator, retiredPrefixes: [...(t.seedRetiredPrefixes ?? [])],
          scanned: t.kind !== undefined, editable: !t.lockedReason,
          maxValue: t.seedMaxValue ?? null, wrap: t.seedWrap ?? false,
        },
      });
      await refreshNumberSeriesCache();
    }
    const kisa = resolveSeriesFormat("batchShort");
    // ⚠️ ÜÇÜNCÜ SONUÇ: kısa seri bu DB'de sarmalı/sınırlı/tarihsiz değilse (fabrika
    // ayarı değiştirmiş) fikstür varsayımı tutmaz — "uyumlu" denmez.
    if (kisa.maxValue == null || kisa.wrap !== true || kisa.dateSegment !== "NONE") {
      console.log(
        `⏭️  §1 §3 §4 §5 ÖLÇÜLEMEDİ — kısa parti serisi sarmalı/sınırlı/tarihsiz değil ` +
          `(max ${kisa.maxValue} · wrap ${kisa.wrap} · tarih ${kisa.dateSegment}).`,
      );
      await herSeriBolumu();
    } else {
      await partiBolumleri(kisa, batchIds, woIds);
    }
  } finally {
    await temizle(batchIds, woIds, sayacOnce);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(
  batchIds: string[],
  woIds: string[],
  sayacOnce: { startValue: number | null; step: number | null; maxValue: number | null; wrap: boolean; formatChangedAt: Date | null } | null,
): Promise<void> {
  if (batchIds.length > 0) await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  if (woIds.length > 0) await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  if (sayacOnce) {
    await prisma.numberSeries.update({ where: { key: "batchShort" }, data: sayacOnce });
  } else {
    await prisma.numberSeries.deleteMany({ where: { key: "batchShort" } });
  }
  await refreshNumberSeriesCache();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
