// =============================================================================
// ÇÖZGÜ KARTI İPLİK SATIRLARI — tek okuyucu (fason devere D1, 2026-11-17)
// =============================================================================
// "Bu çözgü kartı hangi ipliklerden, kaçar telle oluşur?" sorusunun TEK cevabı. Kart satırı yoksa
// (göç öncesi doğmuş ya da doğrudan yazılmış kart) kolonlardan TEK satır üretilir — göç güvenliği:
// tek iplikli kartta sonuç bugünküyle aynıdır. Kolonlar (`yarnItemId`, `endsCount`) satırların özeti.
// =============================================================================
import type { Prisma } from "@prisma/client";

export interface WarpSpecYarnLine {
  yarnItemId: string;
  endsCount: number;
  sortOrder: number;
}

/** Kartı okurken iplik satırlarını getiren Prisma `select` parçası (sıra belirlenimli). */
export const WARP_SPEC_YARN_LINES_SELECT = {
  yarnItemId: true,
  endsCount: true,
  yarns: { select: { yarnItemId: true, endsCount: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
} as const satisfies Prisma.WarpSpecSelect;

export function warpSpecYarnLines(spec: {
  yarnItemId: string;
  endsCount: number;
  yarns?: ReadonlyArray<WarpSpecYarnLine> | null;
}): WarpSpecYarnLine[] {
  if (spec.yarns && spec.yarns.length > 0) {
    return [...spec.yarns]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((y) => ({ yarnItemId: y.yarnItemId, endsCount: y.endsCount, sortOrder: y.sortOrder }));
  }
  return [{ yarnItemId: spec.yarnItemId, endsCount: spec.endsCount, sortOrder: 0 }];
}

/** Satırlardan türeyen kart özeti: ana iplik = en küçük `sortOrder`, toplam tel = Σ (kolonların tek yazarı bu kuraldır). */
export function warpSpecSummaryFromLines(lines: ReadonlyArray<WarpSpecYarnLine>): { yarnItemId: string; endsCount: number } {
  if (lines.length === 0) throw new Error("warpSpecSummaryFromLines: satırsız kart");
  const sorted = [...lines].sort((a, b) => a.sortOrder - b.sortOrder);
  return { yarnItemId: sorted[0]!.yarnItemId, endsCount: sorted.reduce((s, l) => s + l.endsCount, 0) };
}
