// =============================================================================
// TERBİYE / FASON TARİFESİ (FinishingRate) — MAL-1
// =============================================================================
// İplik maliyet fiyatıyla AYNI desen (③a damgalı sürüm): fiyat değişimi aynı KODLA yeni
// satır + eski satırın damgası (tek tx, aynı an); kaldırma damgadır. Maliyet yapısı tarifeyi
// KODLA gösterir — fiyat değişince yapı değişmez, aktif sürüme çözülür (`resolveActiveFinishingRate`).
// Okuma `ACTIVE_FINISHING_RATE` / `finishingRateValidAt` tek kaynağından.
// =============================================================================
import { Currency, FinishingBasis, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ACTIVE_FINISHING_RATE, COST_PRICE_REVOKE_REASON } from "./helpers/cost-price-validity.helper";
import { PCT_RULE, isUniqueViolation, logStampedVersionAudit, parseDecimalField, parseTextField } from "./helpers/cost-input.helper";

export const FINISHING_RATE_SELECT = {
  id: true,
  code: true,
  name: true,
  subcontractorId: true,
  basis: true,
  currency: true,
  pricePerM: true,
  typicalShrinkPct: true,
  note: true,
  revokedAt: true,
  revokedById: true,
  revokeReason: true,
  createdAt: true,
  createdById: true,
  subcontractor: { select: { id: true, name: true } },
} satisfies Prisma.FinishingRateSelect;

export type FinishingRateRow = Prisma.FinishingRateGetPayload<{ select: typeof FINISHING_RATE_SELECT }>;

/** Tarife kodu: harf/rakam/nokta/tire/alt çizgi, ≤ 32 — büyük/küçük harf korunur (tr katlama YOK). */
const CODE_RE = /^[A-Za-z0-9._-]{1,32}$/;

export function normalizeFinishingRateCode(raw: unknown): string {
  if (typeof raw !== "string" || !CODE_RE.test(raw.trim())) {
    throw AppError.badRequest("Tarife kodu 1–32 karakter olmalı (harf, rakam, nokta, tire, alt çizgi).");
  }
  return raw.trim();
}

export interface FinishingRateChangeInput {
  code: unknown;
  name: unknown;
  subcontractorId?: string | null;
  basis: FinishingBasis;
  currency: Currency;
  pricePerM: unknown;
  typicalShrinkPct?: unknown;
  note?: unknown;
}

export async function listFinishingRates(opts: { code?: string; includeRevoked?: boolean }): Promise<FinishingRateRow[]> {
  const where: Prisma.FinishingRateWhereInput = {
    AND: [opts.code ? { code: opts.code } : {}, opts.includeRevoked ? {} : ACTIVE_FINISHING_RATE],
  };
  return prisma.finishingRate.findMany({ where, select: FINISHING_RATE_SELECT, orderBy: [{ code: "asc" }, { createdAt: "desc" }, { id: "desc" }] });
}

/** Kodun BUGÜN geçerli sürümü (yoksa null) — maliyet yapısı doğrulaması ve MAL-2 motoru okur. */
export async function resolveActiveFinishingRate(code: string): Promise<FinishingRateRow | null> {
  return prisma.finishingRate.findFirst({ where: { code, ...ACTIVE_FINISHING_RATE }, select: FINISHING_RATE_SELECT });
}

/** SY-E1: KG tabanında fiyat kilo başınadır (kolon adı `pricePerM` korunur). */
const priceLabel = (b: FinishingBasis): string => (b === "KG" ? "Kilo fiyatı" : "Metre fiyatı");

/** TARİFE YAZ/DEĞİŞTİR — aynı değerler no-op; farklıysa eski aktif sürüm damgalanır + yeni satır. */
export async function changeFinishingRate(
  input: FinishingRateChangeInput,
  userId?: string,
): Promise<{ row: FinishingRateRow; wrote: boolean; previousId: string | null }> {
  const code = normalizeFinishingRateCode(input.code);
  const name = parseTextField(input.name, "Tarife adı", 100);
  if (!name) throw AppError.badRequest("Tarife adı zorunludur.");
  const price = parseDecimalField(input.pricePerM, { label: priceLabel(input.basis), min: 0, scale: 4 });
  if (price === null || price === undefined) throw AppError.badRequest(`${priceLabel(input.basis)} zorunludur.`);
  const shrink = parseDecimalField(input.typicalShrinkPct, PCT_RULE("Tipik boy çekmesi")) ?? null;
  const note = parseTextField(input.note, "Not", 300) ?? null;
  const subcontractorId = input.subcontractorId ?? null;
  if (subcontractorId) {
    const sub = await prisma.subcontractor.findUnique({ where: { id: subcontractorId }, select: { name: true, isActive: true } });
    if (!sub) throw AppError.badRequest("Fason firma bulunamadı.");
    if (!sub.isActive) throw AppError.badRequest(`"${sub.name}" pasif durumda — tarifeye bağlanamaz.`);
  }

  const at = new Date();
  type Prev = { id: string; pricePerM: Prisma.Decimal; currency: Currency };
  let outcome: { id: string; wrote: boolean; previous: Prev | null };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const current = await tx.finishingRate.findFirst({
        where: { code, ...ACTIVE_FINISHING_RATE },
        select: { id: true, name: true, subcontractorId: true, basis: true, currency: true, pricePerM: true, typicalShrinkPct: true, note: true },
      });
      const same =
        current &&
        current.name === name &&
        current.subcontractorId === subcontractorId &&
        current.basis === input.basis &&
        current.currency === input.currency &&
        current.pricePerM.equals(price) &&
        (current.typicalShrinkPct === null ? shrink === null : shrink !== null && current.typicalShrinkPct.equals(shrink)) &&
        current.note === note;
      if (current && same) return { id: current.id, wrote: false, previous: current };
      if (current) {
        const claim = await tx.finishingRate.updateMany({
          where: { id: current.id, ...ACTIVE_FINISHING_RATE },
          data: { revokedAt: at, revokedById: userId ?? null, revokeReason: COST_PRICE_REVOKE_REASON.CHANGED },
        });
        if (claim.count === 0) throw AppError.conflict("Tarife aynı anda başka bir işlemle değişti — listeyi yenileyip tekrar deneyin.");
      }
      const created = await tx.finishingRate.create({
        data: {
          code,
          name,
          subcontractorId,
          basis: input.basis,
          currency: input.currency,
          pricePerM: price,
          typicalShrinkPct: shrink,
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
      throw AppError.conflict(`"${code}" tarifesi aynı anda başka bir işlemle yazıldı — listeyi yenileyip tekrar deneyin.`, { code: "COST_PRICE_CONFLICT" });
    }
    throw e;
  }

  const row = await prisma.finishingRate.findUniqueOrThrow({ where: { id: outcome.id }, select: FINISHING_RATE_SELECT });
  if (outcome.wrote) {
    logStampedVersionAudit({
      tableName: "FINISHING_RATE",
      userId,
      previousId: outcome.previous?.id ?? null,
      revokeReason: COST_PRICE_REVOKE_REASON.CHANGED,
      rowId: row.id,
      oldData: outcome.previous ? { pricePerM: outcome.previous.pricePerM.toFixed(4), currency: outcome.previous.currency } : null,
      newData: { code: row.code, name: row.name, basis: row.basis, currency: row.currency, pricePerM: row.pricePerM.toFixed(4) },
    });
  }
  return { row, wrote: outcome.wrote, previousId: outcome.previous?.id ?? null };
}

/** TARİFEYİ KALDIR — damga; kodu gösteren maliyet yapısı artık "tarife yok" görür (MAL-2 eksik kodu). */
export async function revokeFinishingRate(id: string, userId?: string): Promise<{ id: string }> {
  // `revokedAt` SÜZÜLMEZ — satırın kendisi okunur: yoksa 404, zaten damgalıysa 409.
  const row = await prisma.finishingRate.findUnique({ where: { id }, select: { id: true, code: true, revokedAt: true, pricePerM: true } });
  if (!row) throw AppError.notFound("Tarife bulunamadı.");
  if (row.revokedAt) throw AppError.conflict("Bu tarife satırı zaten kaldırılmış.");
  const claim = await prisma.finishingRate.updateMany({
    where: { id, ...ACTIVE_FINISHING_RATE },
    data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: COST_PRICE_REVOKE_REASON.REMOVED },
  });
  if (claim.count === 0) throw AppError.conflict("Tarife aynı anda başka bir işlemle değişti ya da kaldırıldı — listeyi yenileyin.");
  void AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "FINISHING_RATE",
    recordId: id,
    oldData: { revokeReason: null },
    newData: { code: row.code, pricePerM: row.pricePerM.toFixed(4), revokeReason: COST_PRICE_REVOKE_REASON.REMOVED },
  });
  return { id };
}
