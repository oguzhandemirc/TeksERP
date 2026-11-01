// =============================================================================
// HİZMET İŞİ MİKTARI — tek kaynak (brode fiyat birimi: metre | adet | vuruş; EKS-E2)
// =============================================================================
// Soru: "bu iş kaç BİRİM faturalanır?" Metre işinde miktar ölçülen metredir (bugünkü davranış, bayt-aynı).
// Brode bayrağının (`BRODE_PROPERTY_CODE`) işi `finance.serviceBilling.brodeUnit` ayarıyla ADET (okumada girilen
// `pieceCount`) ya da VURUŞ (adet × desen değerinin `stitchCount`ı) olur. Fatura taslağı, bağ tutarlılığı,
// önizleme kapısı ve kârlılık gelir payı miktarı YALNIZ buradan okur (`test_brode_fiyat_birimi` AST taraması).
// Eksik adet/vuruş miktarı null'dır — iş faturaya alınmaz, çağıran uyarır (uydurma miktar YOK, fail-closed).
// =============================================================================
import { Prisma, type ServiceQtyUnit } from "@prisma/client";
import prisma from "../../lib/prisma";
import { ACTIVE_ROLL_PROPERTY } from "./property-revoke.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Brode bayrağının kodu (`brode-kurulum.ts` varsayılanı); ayar yalnız bu bayrağın işine uygulanır. */
export const BRODE_PROPERTY_CODE = "BRODE";

/** Faturadaki birim metni — satırın `unit` alanı. */
export const SERVICE_QTY_UNIT_LABEL: Record<ServiceQtyUnit, string> = { METER: "m", PIECE: "adet", STITCH: "vuruş" };

/** İşin birimi: brode bayrağı ayarın birimiyle, diğer her iş metreyle. */
export function serviceWorkUnit(propertyCode: string | null, brodeUnit: ServiceQtyUnit): ServiceQtyUnit {
  return propertyCode === BRODE_PROPERTY_CODE ? brodeUnit : "METER";
}

/**
 * Tablet brode okumasında "Adet" girişi istenir mi (adım özeti `pieceInput`): yalnız brode istasyonunda, sayaç
 * çıkış okuması açıkken ve ayar ADET/VURUŞ iken. METER → null (yanıt anahtarsız, bugünküyle bayt-aynı).
 */
export function brodePieceInputOf(input: { meterOn: boolean; stationPropertyCodes: readonly string[]; brodeUnit: ServiceQtyUnit }): "PIECE" | "STITCH" | null {
  if (!input.meterOn || input.brodeUnit === "METER" || !input.stationPropertyCodes.includes(BRODE_PROPERTY_CODE)) return null;
  return input.brodeUnit;
}

export interface ServiceQuantityInput {
  meters: Prisma.Decimal;
  pieceCount: number | null;
  stitchCount: number | null;
}

/** Miktar: METER → metre · PIECE → adet · STITCH → adet × desen vuruşu. Eksik girdi → null (iş faturalanmaz). */
export function serviceWorkQuantity(w: ServiceQuantityInput, unit: ServiceQtyUnit): Prisma.Decimal | null {
  if (unit === "METER") return w.meters;
  if (w.pieceCount == null || w.pieceCount <= 0) return null;
  if (unit === "PIECE") return new Prisma.Decimal(w.pieceCount);
  if (w.stitchCount == null || w.stitchCount <= 0) return null;
  return new Prisma.Decimal(w.pieceCount).mul(w.stitchCount);
}

/** Eksik miktar uyarısı — bekçi aynı cümleyi arar. */
export function missingQuantityWarning(unit: ServiceQtyUnit, count: number): string {
  return unit === "STITCH"
    ? `${count} brode işinin adedi ya da desen vuruş sayısı girilmemiş — faturaya alınmadı.`
    : `${count} brode işinin adedi girilmemiş — faturaya alınmadı.`;
}

/** Tarife satırı birimi işin birimiyle aynı mı (NULL = METER, bugünkü satırlar). */
export function priceUnitMatches(rowUnit: ServiceQtyUnit | null | undefined, unit: ServiceQtyUnit): boolean {
  return (rowUnit ?? "METER") === unit;
}

/** Bağın faturalanan miktarı: metre dışı birimde `billedQty`, metrede `billedMeters`. */
export function linkBilledQty(l: { billedMeters: Prisma.Decimal; billedQty?: Prisma.Decimal | null }): Prisma.Decimal {
  return l.billedQty ?? l.billedMeters;
}

/** Yapraktaki aktif çeşit (desen) değerinin vuruş sayısı: `${rollId}:${bayrakId}` → stitchCount. */
export async function loadPatternStitchCounts(db: Db, props: Array<{ rollId: string; propertyId: string }>): Promise<Map<string, number | null>> {
  if (props.length === 0) return new Map();
  const rows = await db.rollProperty.findMany({
    where: {
      rollId: { in: [...new Set(props.map((p) => p.rollId))] },
      ...ACTIVE_ROLL_PROPERTY,
      property: { variantOfPropertyId: { in: [...new Set(props.map((p) => p.propertyId))] } },
      valueId: { not: null },
    },
    select: { rollId: true, property: { select: { variantOfPropertyId: true } }, value: { select: { stitchCount: true } } },
  });
  return new Map(rows.map((r) => [`${r.rollId}:${r.property.variantOfPropertyId}`, r.value?.stitchCount ?? null]));
}
