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
  return { created: eksik.map((e) => e.key), existing: rows.length };
}
