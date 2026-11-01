// =============================================================================
// İPLİK MALİYET FİYATI (YarnCostPrice) — MAL-1
// =============================================================================
// ③a TİCARİ PİVOT, DAMGALI SÜRÜM (ItemPrice/MAL-0b emsali): fiyat değişimi = eski satırın
// damgası + yeni satır, AYNI tx ve AYNI an (pencere `[createdAt, revokedAt)` her anda tek
// sürüm). Kaldırma da damgadır; satır silinmez. Okuma `ACTIVE_YARN_COST_PRICE` /
// `yarnCostPriceValidAt` tek kaynağından. `item_prices`e YAZILMAZ: maliyet fiyatı ≠ alış fiyatı.
// İdempotency: aynı değer tekrar gelirse sürüm yazılmaz (replay zararsız; clientToken gereksiz).
// =============================================================================
import { Currency, ItemType, Prisma, YarnCostPriceSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ACTIVE_YARN_COST_PRICE, COST_PRICE_REVOKE_REASON } from "./helpers/cost-price-validity.helper";
import { isUniqueViolation, logStampedVersionAudit, parseDecimalField, parseTextField } from "./helpers/cost-input.helper";

export const YARN_COST_PRICE_SELECT = {
  id: true,
  yarnItemId: true,
  currency: true,
  pricePerKg: true,
  source: true,
  sourceRef: true,
  note: true,
  revokedAt: true,
  revokedById: true,
  revokeReason: true,
  createdAt: true,
  createdById: true,
  yarnItem: { select: { id: true, code: true, name: true, linearDensityDen: true } },
} satisfies Prisma.YarnCostPriceSelect;

export type YarnCostPriceRow = Prisma.YarnCostPriceGetPayload<{ select: typeof YARN_COST_PRICE_SELECT }>;

export interface YarnCostPriceChangeInput {
  yarnItemId: string;
  currency: Currency;
  pricePerKg: unknown;
  source?: YarnCostPriceSource;
  sourceRef?: unknown;
  note?: unknown;
  /** Yalnız bu sürüm hâlâ yürürlükteyse yaz (içe aktarım geri sarmasının claim'i, SY-H2). */
  expectedActiveId?: string | null;
}

/** Liste — varsayılan YALNIZ aktif; geçmiş açıkça istenir (`includeRevoked`). */
export async function listYarnCostPrices(opts: { yarnItemId?: string; includeRevoked?: boolean }): Promise<YarnCostPriceRow[]> {
  const where: Prisma.YarnCostPriceWhereInput = {
    AND: [opts.yarnItemId ? { yarnItemId: opts.yarnItemId } : {}, opts.includeRevoked ? {} : ACTIVE_YARN_COST_PRICE],
  };
  return prisma.yarnCostPrice.findMany({ where, select: YARN_COST_PRICE_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

/** FİYAT DEĞİŞTİR — aynı değer no-op; farklıysa eski aktif damgalanır + yeni satır doğar (tek tx). */
export async function changeYarnCostPrice(
  input: YarnCostPriceChangeInput,
  userId?: string,
): Promise<{ row: YarnCostPriceRow; wrote: boolean; previousId: string | null }> {
  const price = parseDecimalField(input.pricePerKg, { label: "Kg fiyatı", min: 0, minExclusive: true, scale: 4 });
  if (!price) throw AppError.badRequest("Kg fiyatı zorunludur.");
  const sourceRef = parseTextField(input.sourceRef, "Kaynak referansı", 64) ?? null;
  const note = parseTextField(input.note, "Not", 300) ?? null;
  const source = input.source ?? YarnCostPriceSource.MANUAL;

  const yarn = await prisma.item.findUnique({ where: { id: input.yarnItemId }, select: { id: true, name: true, itemType: true } });
  if (!yarn) throw AppError.badRequest("İplik kalemi bulunamadı.");
  if (yarn.itemType !== ItemType.YARN) {
    throw AppError.badRequest(`"${yarn.name}" bir İPLİK kalemi değil — maliyet fiyatı yalnız ipliğe girilir.`, { code: "COST_YARN_NOT_YARN" });
  }

  const at = new Date();
  let outcome: { id: string; wrote: boolean; previous: { id: string; pricePerKg: Prisma.Decimal; currency: Currency } | null };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const current = await tx.yarnCostPrice.findFirst({
        where: { yarnItemId: input.yarnItemId, ...ACTIVE_YARN_COST_PRICE },
        select: { id: true, pricePerKg: true, currency: true, source: true, sourceRef: true, note: true },
      });
      if (input.expectedActiveId !== undefined && (current?.id ?? null) !== input.expectedActiveId) {
        throw AppError.conflict("İplik fiyatı sonradan değişti — beklenen sürüm yürürlükte değil.", { code: "COST_PRICE_CONFLICT" });
      }
      if (
        current &&
        current.pricePerKg.equals(price) &&
        current.currency === input.currency &&
        current.source === source &&
        current.sourceRef === sourceRef &&
        current.note === note
      ) {
        return { id: current.id, wrote: false, previous: current };
      }
      if (current) {
        const claim = await tx.yarnCostPrice.updateMany({
          where: { id: current.id, ...ACTIVE_YARN_COST_PRICE },
          data: { revokedAt: at, revokedById: userId ?? null, revokeReason: COST_PRICE_REVOKE_REASON.CHANGED },
        });
        if (claim.count === 0) throw AppError.conflict("İplik fiyatı aynı anda başka bir işlemle değişti — listeyi yenileyip tekrar deneyin.");
      }
      const created = await tx.yarnCostPrice.create({
        data: {
          yarnItemId: input.yarnItemId,
          currency: input.currency,
          pricePerKg: price,
          source,
          sourceRef,
          note,
          createdAt: at,
          createdById: userId ?? null,
        },
        select: { id: true },
      });
      return { id: created.id, wrote: true, previous: current };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw AppError.conflict("Bu ipliğin fiyatı aynı anda başka bir işlemle yazıldı — listeyi yenileyip tekrar deneyin.", { code: "COST_PRICE_CONFLICT" });
    }
    throw e;
  }

  const row = await prisma.yarnCostPrice.findUniqueOrThrow({ where: { id: outcome.id }, select: YARN_COST_PRICE_SELECT });
  if (outcome.wrote) {
    logStampedVersionAudit({
      tableName: "YARN_COST_PRICE",
      userId,
      previousId: outcome.previous?.id ?? null,
      revokeReason: COST_PRICE_REVOKE_REASON.CHANGED,
      rowId: row.id,
      oldData: outcome.previous ? { pricePerKg: outcome.previous.pricePerKg.toFixed(4), currency: outcome.previous.currency } : null,
      newData: { yarnItemId: row.yarnItemId, currency: row.currency, pricePerKg: row.pricePerKg.toFixed(4), source: row.source },
    });
  }
  return { row, wrote: outcome.wrote, previousId: outcome.previous?.id ?? null };
}

/** FİYATI KALDIR — satır silinmez, damgalanır; geçmiş tarih itibarıyla okunmaya devam eder. */
export async function revokeYarnCostPrice(id: string, userId?: string): Promise<{ id: string }> {
  // `revokedAt` SÜZÜLMEZ — satırın kendisi okunur: yoksa 404, zaten damgalıysa 409.
  const row = await prisma.yarnCostPrice.findUnique({ where: { id }, select: { id: true, revokedAt: true, yarnItemId: true, pricePerKg: true } });
  if (!row) throw AppError.notFound("İplik fiyatı bulunamadı.");
  if (row.revokedAt) throw AppError.conflict("Bu fiyat satırı zaten kaldırılmış.");
  const claim = await prisma.yarnCostPrice.updateMany({
    where: { id, ...ACTIVE_YARN_COST_PRICE },
    data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: COST_PRICE_REVOKE_REASON.REMOVED },
  });
  if (claim.count === 0) throw AppError.conflict("İplik fiyatı aynı anda başka bir işlemle değişti ya da kaldırıldı — listeyi yenileyin.");
  void AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "YARN_COST_PRICE",
    recordId: id,
    oldData: { revokeReason: null },
    newData: { yarnItemId: row.yarnItemId, pricePerKg: row.pricePerKg.toFixed(4), revokeReason: COST_PRICE_REVOKE_REASON.REMOVED },
  });
  return { id };
}
