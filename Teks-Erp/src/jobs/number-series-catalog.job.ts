// =============================================================================
// Numara serisi kataloğu boot-time uzlaştırması (2026-09-22)
// =============================================================================
// İzin kataloğu emsali: KİMLİK koda, BİÇİM veriye. Bu iş katalogdaki eksik
// serileri tohum biçimiyle doğurur ve kod-sahipli alanları (label · scanned ·
// editable) tazeler; VERİ-SAHİPLİ alanlara (prefix · dateSegment · digits ·
// separator · retiredPrefixes) ASLA DOKUNMAZ.
//
// ⚠️ Bu ayrım load-bearing: fabrika ön ekini `PKT` yaptıysa bir sonraki deploy onu
// `CV`ye geri döndürmemeli. "Grandfathering mekaniktir" (MODUL-BAYRAK-TASARIM §12 #2)
// kuralının numaralandırmaya uygulanmış hâli.
//
// Uzlaştırmadan SONRA önbellek doldurulur — `resolveSeriesFormat` senkron okur ve
// önbellek boşken katalog tohumuna düşer; yani bu iş düşse bile numara üretimi
// BUGÜNKÜ davranışla sürer (fail-safe, beyanlı).
// =============================================================================
import { NUMBER_SERIES_CATALOG } from "../constants/number-series-catalog";
import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";
import { refreshNumberSeriesCache } from "../services/number-series.service";

export interface NumberSeriesReconcileResult {
  created: string[];
  existing: number;
  /** Göç BU AÇILIŞTA koştuysa yazılan mod; koşmadıysa `null` (damga vardı). */
  partyCodeAutoMigratedTo: "FREE" | "MANUAL" | null;
  /** Biçim satırı göçü BU AÇILIŞTA koştuysa yazılan satır sayısı; koşmadıysa `null`. */
  /** Bu koşumda ONARILAN satır sayısı; 0 = eksik yoktu (artık `null` dönmez). */
  formatLinesCreated: number;
}

export async function reconcileNumberSeries(): Promise<NumberSeriesReconcileResult> {
  const rows = await prisma.numberSeries.findMany({ select: { key: true, label: true, scanned: true, editable: true } });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const eksik = NUMBER_SERIES_CATALOG.filter((e) => !byKey.has(e.key));
  if (eksik.length > 0) {
    await prisma.numberSeries.createMany({
      data: eksik.map((e) => ({
        key: e.key,
        label: e.label,
        prefix: e.seedPrefix,
        dateSegment: e.seedDateSegment,
        digits: e.seedDigits,
        separator: e.seedSeparator,
        retiredPrefixes: [...(e.seedRetiredPrefixes ?? [])],
        scanned: e.kind !== undefined,
        editable: !e.lockedReason,
        // ⚠️ VERİ-SAHİPLİ ama TOHUMLU: sınır/sarma yalnız satır DOĞARKEN yazılır;
        // aşağıdaki tazeleme döngüsü bunlara ASLA dokunmaz, yoksa fabrikanın
        // panelden seçtiği aralık her deploy'da geri ezilirdi.
        maxValue: e.seedMaxValue ?? null,
        wrap: e.seedWrap ?? false,
      })),
      skipDuplicates: true,
    });
  }

  // Kod-sahipli alanların tazelenmesi — yalnız DEĞİŞENLER yazılır (gereksiz
  // `updatedAt` dokunuşu "kim ne zaman değiştirdi" izini kirletirdi).
  for (const e of NUMBER_SERIES_CATALOG) {
    const row = byKey.get(e.key);
    if (!row) continue;
    const scanned = e.kind !== undefined;
    const editable = !e.lockedReason;
    if (row.label === e.label && row.scanned === scanned && row.editable === editable) continue;
    await prisma.numberSeries.update({ where: { key: e.key }, data: { label: e.label, scanned, editable } });
  }

  // ⚠️ SIRA LOAD-BEARING: göç, satırlar YARATILDIKTAN SONRA koşar. Ters sırada
  // `workOrder` satırı henüz yoktur ve `update` hiçbir şey yazmadan patlar ya da
  // (SQL migration'da olsaydı) SESSİZCE no-op olurdu — bu depoda aynı tuzak
  // "WHERE EXISTS no-op" olarak yaşandı (ön kayıt damgası, top sayısı 0).
  const migratedTo = await migratePartyCodeAutoOnce();
  const lineCount = await repairFormatLines();

  await refreshNumberSeriesCache();
  if (eksik.length > 0) {
    // Yeni seri doğması bir SİSTEM olayıdır (kullanıcı eylemi değil) — izin kataloğu
    // uzlaştırmasıyla aynı kalıp: olay defterine düşer, kullanıcıya atfedilmez.
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "NUMBER_SERIES_SEEDED",
      tableName: "number_series",
      payload: { keys: eksik.map((e) => e.key) },
    });
  }
  return {
    created: eksik.map((e) => e.key),
    existing: rows.length,
    partyCodeAutoMigratedTo: migratedTo,
    formatLinesCreated: lineCount,
  };
}

/** Göç damgası — BİR KEZ koşar, sonra eski bayrağa bir daha BAKILMAZ. */
export const PARTY_CODE_AUTO_MIGRATION_STAMP = "numbering.partyCodeAutoMigratedAt";

/**
 * TEK SEFERLİK GÖÇ: eski `workorder.partyCodeAuto` bayrağı → `workOrder.numberSource`.
 *
 * ⚠️ HER AÇILIŞTA TÜRETME YAPILMAZ ve bu kararın bedeli ölçülebilir: türetme
 * kalsaydı fabrika panelden `FREE` seçtiğinde bir sonraki açılış onu EZERDİ.
 * Damga bir kez basılır; damgadan sonra eski bayrak yalnız TÜRETİLMİŞ olarak
 * SUNULUR, hiçbir zaman okunmaz.
 *
 * ⚠️ SATIRI OLMAYAN kurulumda `FREE` yazılır, `MANUAL` DEĞİL — ve bu ölçümle
 * seçildi: `readPartyCodeAuto` satır yokken `false` döndürüyor ama o `false`
 * bir KARAR değil `asBoolean(undefined)` ARTEFAKTIDIR. Açık bir tercihi göç
 * ettirmek başka, hiç yapılmamış bir tercihi "elle giriş zorunlu"ya çevirmek
 * başkadır: ikincisi taze kurulumda iş emri açmayı kırardı.
 */
async function migratePartyCodeAutoOnce(): Promise<"FREE" | "MANUAL" | null> {
  const stamp = await prisma.systemSetting.findUnique({
    where: { key: PARTY_CODE_AUTO_MIGRATION_STAMP },
    select: { key: true },
  });
  if (stamp) return null;

  const oldFlag = await prisma.systemSetting.findUnique({
    where: { key: "workorder.partyCodeAuto" },
    select: { value: true },
  });
  const explicitChoice = oldFlag !== null && (oldFlag.value === false || oldFlag.value === "false");
  const mode = explicitChoice ? "MANUAL" : "FREE";

  await prisma.numberSeries.update({ where: { key: "workOrder" }, data: { numberSource: mode } });
  // ⚠️ `create` DEĞİL `upsert`: damga varken buraya hiç gelinmez, ama bir önceki
  // açılışta damga basıldıktan SONRA bir şey patlarsa `create` ikinci açılışı
  // P2002 ile ÇÖKERTİRDİ — göç fonksiyonu boot yolunda, çökerse sunucu açılmaz.
  await prisma.systemSetting.upsert({
    where: { key: PARTY_CODE_AUTO_MIGRATION_STAMP },
    create: {
      key: PARTY_CODE_AUTO_MIGRATION_STAMP,
      value: new Date().toISOString(),
      description: "workorder.partyCodeAuto → numberSource göçü BİR KEZ koştu; bayrak artık türetilir.",
    },
    update: {},
  });
  await AuditService.logEvent({
    category: "SYSTEM",
    action: "NUMBER_SOURCE_MIGRATED",
    tableName: "number_series",
    payload: { key: "workOrder", mode, eskiBayrak: oldFlag === null ? null : oldFlag.value },
  });
  return mode;
}

/**
 * Biçim satırı göçünün İLK koştuğu an — BİLGİ AMAÇLI, KAPI DEĞİL.
 *
 * ⚠️ 2026-09-23'te GATE OLMAKTAN ÇIKTI ve sebebi sahada ölçüldü: damga "bu iş
 * yapıldı" der ama işin SONUCUNU (satırların varlığını) garanti etmez. Satırları
 * bir yolla silinmiş bir kurulumda (bir bekçinin teardown'u sildi, damgaya
 * dokunmadı) her boot göçü ATLIYORDU ve satır tablosu KALICI boş kalıyordu —
 * yani emekli biçimler, zaman çizgisi ve `retiredFormats` sessizce yoktu.
 * ⇒ Genel bir damga yerine SERİ BAŞINA İDEMPOTENSİ: satırı olmayan seri
 * onarılır, olanına dokunulmaz. Kurulum kendini bir sonraki boot'ta toparlar.
 *
 * ⚠️ D3③'teki damgalı göç (`partyCodeAuto`) FARKLI bir durumdur ve o kalıp
 * DOĞRU KALIR: orada damga, kullanıcının göçten SONRA yaptığı seçimi ezmemek
 * için gerekir. Burada ezilecek bir seçim yoktur — satırı olmayan bir seride
 * kullanıcı hiçbir şey yazmamıştır, çünkü yazsaydı satır doğardı.
 *
 * Damga SİLİNMEDİ: değeri gerçek bir tarihsel olgudur (göç ilk ne zaman koştu)
 * ve kaldırmak davranışa hiçbir şey katmayan bir veri göçü olurdu.
 */
export const FORMAT_LINES_MIGRATION_STAMP = "numbering.formatLinesMigratedAt";

/**
 * SENTİNEL TARİH UFKU — bundan ÖNCEKİ her `effectiveFrom` "tarihi bilinmiyor"
 * demektir, gerçek bir an değil.
 *
 * ⚠️ TEK KAYNAK ve bir ARIZA DÜZELTMESİ (2026-09-23, kendi bekçim ölçtü):
 * sentinel tarih `number_series.formatChangedAt` kolonuna SIZIYOR — sızmak
 * zorunda, çünkü kolon yürürlükteki satırın önbelleğidir ve `effectiveFrom`
 * ile BİREBİR olmalı. Ama kolonun `isSentinel` karşılığı YOK. Sonuç: satırlar
 * ikinci kez silinip onarıldığında 1970 tarihi GERÇEK sanılıyor ve satır
 * `isSentinel: false` doğuyordu — yani "biçim 1970'te değişti" diyen bir defter
 * satırı. Onarım artık tarihin KENDİSİNE bakıyor; bekçi de aynı sabiti okur ki
 * "sentinel nedir" sorusunun tek cevabı olsun.
 */
export const SENTINEL_DATE_HORIZON = new Date("2000-01-01T00:00:00.000Z");

/**
 * TEK SEFERLİK GÖÇ: `number_series` biçim kolonları → `number_series_lines`.
 *
 * ⚠️ SIRA LOAD-BEARING: seri satırları YARATILDIKTAN SONRA koşar. SQL
 * migration'ında yapılsaydı, satırları boot uzlaştırması yarattığı için
 * migration anında tablo BOŞ olur ve INSERT … SELECT sessizce hiçbir şey
 * yazmazdı ("WHERE EXISTS no-op" tuzağı).
 *
 * ⚠️ GEÇMİŞİN TARİHİ BİLİNMİYOR: `retiredPrefixes` yalnız bir ÖN EK LİSTESİdir,
 * ne zaman emekli olduğu hiçbir yerde yazmıyor. Bu yüzden emekli satırlara
 * SENTİNEL tarihler konur ve `isSentinel` ile BEYAN EDİLİR — rapor "1970'te
 * biçim değişti" demesin diye. Sentinel tarihler yalnız SIRALAMA taşır:
 * emekliler yürürlükteki satırdan ÖNCE gelir, kendi aralarında liste sırasıyla.
 *
 * ⚠️ EMEKLİ SATIRIN BİÇİMİ TAHMİNDİR: yalnız ön ek biliniyor; segment/hane/ayraç
 * bugünküyle AYNI varsayılır. Bu, bugünkü `matchesSeries` davranışının birebir
 * karşılığıdır (emekli ön ek bugün de yürürlükteki segment/haneyle deneniyor),
 * yani göç DAVRANIŞI DEĞİŞTİRMEZ — yalnız veriyi taşır.
 */
async function repairFormatLines(): Promise<number> {
  // SERİ BAŞINA İDEMPOTENSİ: satırı OLAN seriye dokunulmaz (kullanıcının yazdığı
  // zaman çizgisi kutsaldır), satırı OLMAYAN seri kolon önbelleğinden onarılır.
  const seriesWithLines = (
    await prisma.numberSeriesLine.findMany({ select: { seriesKey: true }, distinct: ["seriesKey"] })
  ).map((x) => x.seriesKey);

  const rows = await prisma.numberSeries.findMany({
    // ⚠️ `notIn: []` YASAK (boş liste Prisma'da hiçbir şey döndürmez) — ilk
    // kurulumda liste zaten boştur ve o hâlde SÜZME YAPILMAZ.
    ...(seriesWithLines.length > 0 ? { where: { key: { notIn: seriesWithLines } } } : {}),
    select: {
      key: true, prefix: true, dateSegment: true, digits: true, separator: true, separator2: true,
      retiredPrefixes: true, formatChangedAt: true,
    },
  });
  const data: Array<{
    seriesKey: string; prefix: string; dateSegment: (typeof rows)[number]["dateSegment"];
    digits: number; separator: string; separator2: string | null; effectiveFrom: Date; isSentinel: boolean;
    origin: "RECORDED" | "MIGRATED_GUESS";
  }> = [];
  for (const r of rows) {
    // Emekliler önce (sentinel, liste sırasıyla), yürürlükteki en sonda.
    r.retiredPrefixes.forEach((onek, i) => {
      data.push({
        seriesKey: r.key, prefix: onek, dateSegment: r.dateSegment, digits: r.digits,
        separator: r.separator, separator2: r.separator2,
        effectiveFrom: new Date(1000 * (i + 1)), isSentinel: true,
        // ⚠️ BİÇİM TAHMİN: yalnız ÖN EK biliniyordu; segment/hane/ayraç
        // bugünküyle aynı varsayıldı. Tarihin sentinel olması (`isSentinel`)
        // BİÇİMİN tahmin olduğunu söylemez — ikisi AYRI beyan.
        origin: "MIGRATED_GUESS",
      });
    });
    data.push({
      seriesKey: r.key, prefix: r.prefix, dateSegment: r.dateSegment, digits: r.digits,
      separator: r.separator,
      separator2: r.separator2,
      // Damga varsa GERÇEK tarih; yoksa sentinel (biçim hiç değişmemiş seri).
      effectiveFrom: r.formatChangedAt ?? new Date(1000 * (r.retiredPrefixes.length + 1)),
      isSentinel: r.formatChangedAt === null || r.formatChangedAt < SENTINEL_DATE_HORIZON,
      // Yürürlükteki satırın BİÇİMİ tahmin DEĞİL — bugünkü biçimin ta kendisi;
      // yalnız TARİHİ bilinmiyor olabilir.
      origin: "RECORDED",
    });
  }
  // Yapacak iş yoksa hiçbir yan etki YAZILMAZ: her boot'ta damga tazelemek ve
  // audit satırı düşmek, gerçekten bir onarım olduğu anı görünmez kılardı.
  if (data.length === 0) return 0;

  await prisma.numberSeriesLine.createMany({ data, skipDuplicates: true });
  await prisma.systemSetting.upsert({
    where: { key: FORMAT_LINES_MIGRATION_STAMP },
    create: {
      key: FORMAT_LINES_MIGRATION_STAMP,
      value: new Date().toISOString(),
      description: "Biçim kolonları → number_series_lines göçünün İLK koştuğu an (bilgi amaçlı).",
    },
    update: {},
  });
  await AuditService.logEvent({
    category: "SYSTEM",
    action: "NUMBER_SERIES_LINES_MIGRATED",
    tableName: "number_series_lines",
    payload: { lines: data.length, series: rows.length },
  });
  return data.length;
}
