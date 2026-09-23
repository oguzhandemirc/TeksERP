// =============================================================================
// BEKÇİ — BİÇİM ZAMAN ÇİZGİSİ (`number_series_lines`, D4①, 2026-09-23)
// =============================================================================
//   §1 GÖÇ tek seferlik + damgalı; satırlar YARATILDIKTAN SONRA koşar
//   §2 ⭐ ÖNBELLEK = YÜRÜRLÜKTEKİ SATIR: `number_series` biçim kolonları, o
//      serinin EN SON `effectiveFrom`lu satırıyla birebir
//   §3 ⭐ EMEKLİ ÖN EK KÜMESİ = GEÇMİŞ SATIRLARIN ön ekleri (iki yönlü)
//   §4 ⭐ TEK YAZAR: biçim yazınca hem YENİ SATIR doğar hem önbellek güncellenir
//      ve ikisinin anı AYNIDIR (`effectiveFrom` == `formatChangedAt`)
//   §5 Sentinel BEYANLI: tarihi bilinmeyen geçmiş satır `isSentinel` taşır
//   §6 KÖKEN AYRI BEYAN: göçün ürettiği emekli satır `MIGRATED_GUESS`, panelden
//      doğan satır `RECORDED` — tarihin sentinel olması BİÇİMİN tahmin olduğunu
//      söylemez, ikisi AYRI sorudur
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-23): tek yazar tx'inden satır yazımı
//    kaldırılınca §4 ❌ · `formatChangedAt` ile `effectiveFrom` farklı anlara
//    konunca §4 ❌ · göç damgası kaldırılınca §1 ❌ · emekli ön ek satır olarak
//    yazılmayınca §3 ❌.
//
// Çalıştır: npx tsx scripts/test_number_series_lines.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  FORMAT_LINES_MIGRATION_STAMP,
  reconcileNumberSeries,
} from "../src/jobs/number-series-catalog.job";
import { refreshNumberSeriesCache, resolveSeriesFormat } from "../src/services/number-series.service";
import { updateSeriesFormat } from "../src/services/helpers/series-write.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Serinin YÜRÜRLÜKTEKİ satırı — en büyük `effectiveFrom` (gelecek satır hariç). */
async function yururlukteki(key: string) {
  return prisma.numberSeriesLine.findFirst({
    where: { seriesKey: key, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: "desc" },
  });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(engel); process.exit(1); }

  // ── §1 GÖÇ ────────────────────────────────────────────────────────────────
  const r1 = await reconcileNumberSeries();
  const damga = await prisma.systemSetting.findUnique({
    where: { key: FORMAT_LINES_MIGRATION_STAMP }, select: { key: true },
  });
  check("§1a göç damgası basıldı", damga !== null);
  const r2 = await reconcileNumberSeries();
  check("§1b ⭐ damga varken göç BİR DAHA KOŞMAZ", r2.formatLinesCreated === null,
    `ilk koşum: ${String(r1.formatLinesCreated)} · ikinci: ${String(r2.formatLinesCreated)}`);

  const seriler = await prisma.numberSeries.findMany({
    select: { key: true, prefix: true, dateSegment: true, digits: true, separator: true,
      retiredPrefixes: true, formatChangedAt: true },
  });
  check("§1 körlük zemini: seri satırı var", seriler.length >= 40, `${seriler.length} seri`);
  const toplamSatir = await prisma.numberSeriesLine.count();
  check("§1 körlük zemini: biçim satırı YAZILDI", toplamSatir >= seriler.length,
    `${toplamSatir} satır / ${seriler.length} seri`);

  // ── §2 ÖNBELLEK = YÜRÜRLÜKTEKİ SATIR ──────────────────────────────────────
  const ayrisan: string[] = [];
  for (const s of seriler) {
    const line = await yururlukteki(s.key);
    if (!line) { ayrisan.push(`${s.key}: satır YOK`); continue; }
    if (line.prefix !== s.prefix || line.dateSegment !== s.dateSegment ||
        line.digits !== s.digits || line.separator !== s.separator) {
      ayrisan.push(`${s.key}: ${line.prefix}/${line.dateSegment}/${line.digits} ≠ ${s.prefix}/${s.dateSegment}/${s.digits}`);
    }
  }
  check("§2 ⭐ `number_series` biçim kolonları YÜRÜRLÜKTEKİ satırla BİREBİR (önbellek ayrışmıyor)",
    ayrisan.length === 0, ayrisan.slice(0, 3).join(" · ") || `${seriler.length} seri denetlendi`);

  // ── §3 EMEKLİ ÖN EKLER = GEÇMİŞ SATIRLAR (iki yönlü) ──────────────────────
  const emekliAyrisan: string[] = [];
  for (const s of seriler) {
    const line = await yururlukteki(s.key);
    if (!line) continue;
    const gecmis = await prisma.numberSeriesLine.findMany({
      where: { seriesKey: s.key, effectiveFrom: { lt: line.effectiveFrom } },
      select: { prefix: true },
    });
    const satirOnekleri = new Set(gecmis.map((g) => g.prefix));
    const kolonOnekleri = new Set(s.retiredPrefixes);
    const eksik = [...kolonOnekleri].filter((x) => !satirOnekleri.has(x));
    const fazla = [...satirOnekleri].filter((x) => !kolonOnekleri.has(x) && x !== line.prefix);
    if (eksik.length || fazla.length) {
      emekliAyrisan.push(`${s.key}: eksik=[${eksik.join(",")}] fazla=[${fazla.join(",")}]`);
    }
  }
  check("§3 ⭐ emekli ön ek kümesi geçmiş SATIRLARLA birebir (iki yönlü)",
    emekliAyrisan.length === 0, emekliAyrisan.slice(0, 3).join(" · ") || "ayrışma yok");

  // ── §5 SENTINEL BEYANLI ───────────────────────────────────────────────────
  const sentinelsiz = await prisma.numberSeriesLine.count({
    where: { isSentinel: false, effectiveFrom: { lt: new Date("2000-01-01T00:00:00.000Z") } },
  });
  check("§5 ⭐ 2000 öncesi her satır SENTİNEL olarak beyanlı (rapor '1970'te değişti' demez)",
    sentinelsiz === 0, `${sentinelsiz} beyansız`);

  // ── §6 KÖKEN: tahmin mi, kayıt mı? (D4②) ─────────────────────────────────
  // ⚠️ AYRI ALAN, not değil: "ölçüldü mü, elle mi, TAHMİN mi" beyanı bu depoda
  // VERİDE durur — makine okuyamazsa kapı da kuramaz.
  //
  // ⚠️ İDDİA İKİ KEZ DÜZELTİLDİ ve ikisi de BULGUYDU: ① "geçmiş satır ⇒ tahmin"
  // yanlış (panelden yazılmış bir biçim sonradan geçmişe düşer ama TAHMİN
  // DEĞİLDİR) ② "sentinel + geçmiş ⇒ tahmin" de yanlış (göçün yazdığı
  // YÜRÜRLÜKTEKİ satır da sentinel tarihlidir ve panelden bir değişiklik
  // gelince geçmişe düşer — biçimi yine tahmin değildir).
  // Doğru değişmez KONUMDAN değil YAZARDAN türer: tahmini YALNIZ göç üretir ve
  // yalnız `retiredPrefixes`ten; panelin yazdığı her satır kayıttır.
  const tahminler = await prisma.numberSeriesLine.findMany({
    where: { origin: "MIGRATED_GUESS" },
    select: { seriesKey: true, prefix: true, isSentinel: true },
  });
  check("§6a ⭐ her TAHMİN satırı sentinel tarihli (tahmini yalnız göç üretir)",
    tahminler.every((x) => x.isSentinel),
    tahminler.filter((x) => !x.isSentinel).map((x) => `${x.seriesKey}:${x.prefix}`).join(", ") ||
      `${tahminler.length} tahmin satırı`);
  const panelYazimlari = await prisma.numberSeriesLine.findMany({
    where: { isSentinel: false },
    select: { seriesKey: true, prefix: true, origin: true },
  });
  check("§6b ⭐ PANELDEN yazılan (gerçek tarihli) her satır KAYIT — tahmin değil",
    panelYazimlari.every((x) => x.origin === "RECORDED"),
    panelYazimlari.filter((x) => x.origin !== "RECORDED").map((x) => `${x.seriesKey}:${x.prefix}`).join(", ") ||
      `${panelYazimlari.length} kayıt satırı`);
  check("§6 körlük zemini: tahmin satırı GERÇEKTEN var (iddia boş kümede yeşil değil)",
    tahminler.length >= 1, `${tahminler.length} tahmin satırı`);

  // ── §4 TEK YAZAR ──────────────────────────────────────────────────────────
  const HEDEF = "packingLotCode";
  const once = resolveSeriesFormat(HEDEF);
  const oncekiSatir = await prisma.numberSeriesLine.count({ where: { seriesKey: HEDEF } });
  try {
    await updateSeriesFormat(HEDEF, {
      prefix: once.prefix, dateSegment: once.dateSegment, digits: once.digits, separator: once.separator,
    });
    const sonrakiSatir = await prisma.numberSeriesLine.count({ where: { seriesKey: HEDEF } });
    check("§4a ⭐ biçim yazınca YENİ SATIR doğar", sonrakiSatir === oncekiSatir + 1,
      `${oncekiSatir} → ${sonrakiSatir}`);
    const seri = await prisma.numberSeries.findUnique({
      where: { key: HEDEF }, select: { formatChangedAt: true },
    });
    const line = await yururlukteki(HEDEF);
    check("§4b ⭐ `formatChangedAt` ile yürürlükteki satırın `effectiveFrom`u AYNI AN",
      seri?.formatChangedAt !== null && line !== null &&
        seri!.formatChangedAt!.getTime() === line!.effectiveFrom.getTime(),
      `${seri?.formatChangedAt?.toISOString() ?? "—"} ↔ ${line?.effectiveFrom.toISOString() ?? "—"}`);
    await refreshNumberSeriesCache();
    const sonra = resolveSeriesFormat(HEDEF);
    check("§4c yazma davranışı DEĞİŞMEDİ: biçim aynı kaldı (aynı değerler yazıldı)",
      sonra.prefix === once.prefix && sonra.digits === once.digits);
    const yeniSatir = await yururlukteki(HEDEF);
    check("§4d ⭐ PANELDEN doğan satır TAHMİN DEĞİL (`RECORDED`)",
      yeniSatir?.origin === "RECORDED", String(yeniSatir?.origin));
  } finally {
    // Fikstür satırını ve damgayı geri al: bu bekçi GERÇEK seri satırına yazıyor.
    const fazlalik = await prisma.numberSeriesLine.findMany({
      where: { seriesKey: HEDEF }, orderBy: { effectiveFrom: "desc" }, take: 1, select: { id: true, isSentinel: true },
    });
    const kalan = await prisma.numberSeriesLine.count({ where: { seriesKey: HEDEF } });
    if (kalan > oncekiSatir && fazlalik[0]) {
      await prisma.numberSeriesLine.delete({ where: { id: fazlalik[0].id } });
    }
    await prisma.numberSeries.update({
      where: { key: HEDEF },
      data: { formatChangedAt: once.formatChangedAt ?? null },
    });
    await refreshNumberSeriesCache();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
