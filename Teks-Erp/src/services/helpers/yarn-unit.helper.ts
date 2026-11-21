// =============================================================================
// İPLİK SATIN ALMA BİRİMİ — DB okuması + maliyet girdisi alanları (SY-a)
// =============================================================================
// Karar sabitleri `constants/yarn-unit.ts`te; burada yalnız dar sorgu (etkin yapı seçimine kolon eklenmez,
// SY-3 I2 iplik firesi deseni) ve motor girdisine yazılacak alanlar. KG iplikte anahtar YAZILMAZ.
// =============================================================================
import { AppError } from "../../utils/app-error";
import { parseDecimalField } from "./cost-input.helper";
import { isKgYarnUnit, nonKgUnitOf, type NonKgYarnUnit } from "../../constants/yarn-unit";
import type { Prisma, YarnPurchaseUnit } from "@prisma/client";
import type { CostYarn } from "./fabric-cost-types.helper";

export interface YarnUnitRow { id: string; unit: NonKgYarnUnit; piecesPerM: Prisma.Decimal | null }

type Db = Pick<Prisma.TransactionClient, "item">;

/** Verilen ipliklerden KG DIŞI birimli olanlar (boş = hepsi KG). */
export async function readNonKgYarnUnitsTx(db: Db, yarnIds: string[]): Promise<YarnUnitRow[]> {
  const rows = await db.item.findMany({
    where: { id: { in: yarnIds }, yarnPurchaseUnit: { in: ["ADET", "METRE"] } },
    select: { id: true, yarnPurchaseUnit: true, yarnPiecesPerM: true },
  });
  return rows.map((r) => ({ id: r.id, unit: nonKgUnitOf(r.yarnPurchaseUnit)!, piecesPerM: r.yarnPiecesPerM }));
}

/** Motor girdisi alanları: KG'de boş nesne (girdi + `inputHash` bayt-aynı). */
export function costYarnUnitFields(row: YarnUnitRow | undefined): Pick<CostYarn, "unit" | "piecesPerM"> {
  if (!row) return {};
  return { unit: row.unit, ...(row.unit === "ADET" && row.piecesPerM ? { piecesPerM: row.piecesPerM } : {}) };
}

const UNIT_KEYS = ["yarnPurchaseUnit", "yarnPiecesPerM"] as const;
const has = (data: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(data, k);

function parseUnit(v: unknown): YarnPurchaseUnit | null {
  if (v === null || v === undefined || v === "" || v === "KG") return null; // NULL = KG (tek gösterim)
  if (v === "ADET" || v === "METRE") return v;
  throw AppError.badRequest("Satın alma birimi kg, adet ya da metre olmalı.", { code: "ITEM_YARN_UNIT_INVALID" });
}

/**
 * `BaseController` skalerleri olduğu için AÇIK doğrulama (yarnWastePct deseni): yalnız İPLİK; adet/m yalnız ADET'te
 * (birim ADET dışına alınınca adet/m temizlenir); çözgü kartında kullanılan iplik KG dışına alınamaz (çözgü kg defteri).
 * `cur` güncellemede kartın mevcut hali; doğuşta yok.
 */
export async function readYarnUnitFields(
  db: Pick<Prisma.TransactionClient, "warpSpec" | "warpSpecYarn">,
  itemType: string | undefined,
  data: Record<string, unknown>,
  cur?: { id: string; yarnPurchaseUnit: YarnPurchaseUnit | null },
): Promise<{ yarnPurchaseUnit?: YarnPurchaseUnit | null; yarnPiecesPerM?: Prisma.Decimal | null }> {
  if (!UNIT_KEYS.some((k) => has(data, k))) return {};
  const out: { yarnPurchaseUnit?: YarnPurchaseUnit | null; yarnPiecesPerM?: Prisma.Decimal | null } = {};
  if (has(data, "yarnPurchaseUnit")) out.yarnPurchaseUnit = parseUnit(data.yarnPurchaseUnit);
  if (has(data, "yarnPiecesPerM")) out.yarnPiecesPerM = parseDecimalField(data.yarnPiecesPerM, { label: "Metredeki adet", min: 0, minExclusive: true, scale: 3 }) ?? null;
  const unit = out.yarnPurchaseUnit !== undefined ? out.yarnPurchaseUnit : (cur?.yarnPurchaseUnit ?? null);
  if ((unit !== null || (out.yarnPiecesPerM ?? null) !== null) && itemType !== "YARN") {
    throw AppError.badRequest("Satın alma birimi yalnız İPLİK kartına girilir", { code: "ITEM_YARN_UNIT_YARN_ONLY" });
  }
  if (unit !== "ADET") {
    if ((out.yarnPiecesPerM ?? null) !== null) throw AppError.badRequest("Metredeki adet yalnız adet ile alınan iplikte girilir.", { code: "ITEM_YARN_PIECES_ADET_ONLY" });
    if (out.yarnPurchaseUnit !== undefined) out.yarnPiecesPerM = null;
  }
  if (cur && unit !== null && isKgYarnUnit(cur.yarnPurchaseUnit)) {
    const inWarp = await db.warpSpecYarn.count({ where: { yarnItemId: cur.id } }) + await db.warpSpec.count({ where: { yarnItemId: cur.id } });
    if (inWarp > 0) {
      throw AppError.badRequest("Bu iplik çözgü kartında kullanılıyor — çözgü kg ile hesaplandığından birimi adet/metre yapılamaz.", { code: "ITEM_YARN_UNIT_IN_WARP" });
    }
  }
  return out;
}

/**
 * Atkı/varyant kartı ipliği kapısı: denye yalnız KG birimli iplikte zorunlu (kg hesabı denyeyle yapılır);
 * pul/payet (ADET/METRE) denyesiz girebilir.
 */
export function assertWeftYarnDenier(item: { name: string; linearDensityDen: Prisma.Decimal | null; yarnPurchaseUnit: YarnPurchaseUnit | null }): void {
  if (item.linearDensityDen === null && isKgYarnUnit(item.yarnPurchaseUnit)) {
    throw AppError.badRequest(
      `"${item.name}" kaleminin denye değeri boş — kg ile alınan atkı ipliğinin hesabı denye olmadan yapılamaz; ` +
        "kalem kartından denyeyi girin ya da pul/payet ise satın alma birimini adet/metre seçin.",
    );
  }
}
