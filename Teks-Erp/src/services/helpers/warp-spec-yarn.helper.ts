// =============================================================================
// ÇÖZGÜ KARTI İPLİK SATIRLARI — tek okuyucu (fason devere D1, 2026-11-17)
// =============================================================================
// "Bu çözgü kartı hangi ipliklerden, kaçar telle oluşur?" sorusunun TEK cevabı. Kart satırı yoksa
// (göç öncesi doğmuş ya da doğrudan yazılmış kart) kolonlardan TEK satır üretilir — göç güvenliği:
// tek iplikli kartta sonuç bugünküyle aynıdır. Kolonlar (`yarnItemId`, `endsCount`) satırların özeti.
// =============================================================================
import { Prisma } from "@prisma/client";
import { resolveDenier, warpTheoreticalKg, warpYarnKgExact } from "../../constants/warp-beam";

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

// ── DENYELİ OKUMA (fason devere D2) — kg hesaplayan HER okuyucu buradan geçer (`test_cozgu_iplik_tek_kaynak`) ──
const DENIER_YARN_SELECT = { id: true, code: true, name: true, linearDensityDen: true } as const satisfies Prisma.ItemSelect;
export type WarpSpecDenierYarn = { id: string; code: string; name: string; linearDensityDen: Prisma.Decimal | null };

/** Kart `include`u: ana iplik (satırsız kartın geri dönüşü) + denyeli satırlar. */
export const WARP_SPEC_YARN_DENIER_INCLUDE = {
  yarnItem: { select: DENIER_YARN_SELECT },
  yarns: { select: { yarnItemId: true, endsCount: true, sortOrder: true, yarnItem: { select: DENIER_YARN_SELECT } }, orderBy: { sortOrder: "asc" } },
} as const satisfies Prisma.WarpSpecInclude;

/** Kart `select` parçası — başka select'e yayılır (`warpSpec: { select: { id: true, ...WARP_SPEC_YARN_DENIER_SELECT } }`). */
export const WARP_SPEC_YARN_DENIER_SELECT = { yarnItemId: true, endsCount: true, ...WARP_SPEC_YARN_DENIER_INCLUDE } as const satisfies Prisma.WarpSpecSelect;

export interface WarpSpecDenierLine extends WarpSpecYarnLine {
  yarnItem: WarpSpecDenierYarn;
  /** `resolveDenier` sonucu; null = iplik kartında denye boş. */
  denier: Prisma.Decimal | null;
}
type DenierSpec = {
  yarnItemId: string;
  endsCount: number;
  yarnItem: WarpSpecDenierYarn;
  yarns?: ReadonlyArray<WarpSpecYarnLine & { yarnItem: WarpSpecDenierYarn }> | null;
};

/** Denyeli satırlar — satırsız kartta kolonlardan tek satır (ana iplik × toplam tel), `warpSpecYarnLines` ile aynı kural. */
export function warpSpecDenierLines(spec: DenierSpec): WarpSpecDenierLine[] {
  const rows = spec.yarns && spec.yarns.length > 0 ? [...spec.yarns].sort((a, b) => a.sortOrder - b.sortOrder) : [{ yarnItemId: spec.yarnItem.id, endsCount: spec.endsCount, sortOrder: 0, yarnItem: spec.yarnItem }];
  return rows.map((r) => ({ yarnItemId: r.yarnItemId, endsCount: r.endsCount, sortOrder: r.sortOrder, yarnItem: r.yarnItem, denier: resolveDenier(r.yarnItem) }));
}

/** Denyesi boş ilk satır (kg hesaplanamaz) — yoksa null. */
export function firstDenierMissing(lines: ReadonlyArray<WarpSpecDenierLine>): WarpSpecDenierLine | null {
  return lines.find((l) => l.denier === null) ?? null;
}

/** Çözgünün metre başına kg'ı = Σ satır (tel × denye / 9e6), yuvarlamasız; denyesi boş satır varsa null. */
export function warpSpecKgPerMExact(lines: ReadonlyArray<WarpSpecDenierLine>): Prisma.Decimal | null {
  if (lines.length === 0 || firstDenierMissing(lines)) return null;
  return lines.reduce((s, l) => s.plus(warpYarnKgExact(l.endsCount, l.denier!, 1)), new Prisma.Decimal(0));
}

/**
 * Eşdeğer denye = Σ(tel × denye) / Σ tel — toplam tel × eşdeğer denye aynı kg'ı verir. Tek iplikte ipliğin
 * denyesinin KENDİSİ (bayt-aynı); WOUND satırının `denier` kolonu ve eski istemcinin ön hesabı bunu okur.
 */
export function warpSpecEffectiveDenier(lines: ReadonlyArray<WarpSpecDenierLine>): Prisma.Decimal | null {
  if (lines.length === 0 || firstDenierMissing(lines)) return null;
  if (lines.length === 1) return lines[0]!.denier;
  const ends = lines.reduce((s, l) => s + l.endsCount, 0);
  return lines.reduce((s, l) => s.plus(new Prisma.Decimal(l.endsCount).mul(l.denier!)), new Prisma.Decimal(0)).div(ends);
}

/** Levent doğuş kırılımı: satır başına nominal kg (3 hane) — WOUND `theoreticalKg` = Σ. Denyesi boş satır çağıranın kapısıdır. */
export function warpSpecLineKgs(lines: ReadonlyArray<WarpSpecDenierLine>, lengthM: Prisma.Decimal.Value): Array<{ yarnItemId: string; endsCount: number; denier: Prisma.Decimal; theoreticalKg: Prisma.Decimal }> {
  return lines.map((l) => {
    if (l.denier === null) throw new Error(`warpSpecLineKgs: ${l.yarnItem.name} denyesiz`);
    return { yarnItemId: l.yarnItemId, endsCount: l.endsCount, denier: l.denier, theoreticalKg: warpTheoreticalKg(l.endsCount, l.denier, lengthM) };
  });
}

/** Satırlardan türeyen kart özeti: ana iplik = en küçük `sortOrder`, toplam tel = Σ (kolonların tek yazarı bu kuraldır). */
export function warpSpecSummaryFromLines(lines: ReadonlyArray<WarpSpecYarnLine>): { yarnItemId: string; endsCount: number } {
  if (lines.length === 0) throw new Error("warpSpecSummaryFromLines: satırsız kart");
  const sorted = [...lines].sort((a, b) => a.sortOrder - b.sortOrder);
  return { yarnItemId: sorted[0]!.yarnItemId, endsCount: sorted.reduce((s, l) => s + l.endsCount, 0) };
}
