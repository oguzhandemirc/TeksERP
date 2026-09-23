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
  return { created: eksik.map((e) => e.key), existing: rows.length, partyCodeAutoMigratedTo: migratedTo };
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
