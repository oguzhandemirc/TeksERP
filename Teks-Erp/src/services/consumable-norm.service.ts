// =============================================================================
// HİZMET SARF NORMU (ServiceConsumableNorm) — D4-G1a, ister 4.9/5.10 kârlılık zemini
// =============================================================================
// Hizmet kaleminin (SERVICE) metresi başına sarf kalemi (CONSUMABLE) miktarı. ③a damgalı sürüm, "şu andan
// itibaren": değişim aynı tx'te damga (`updateMany WHERE {id, revokedAt:null}`, 0 → 409) + yeni satır.
// Tür kapısı burada (items'ta tür tetiği emsali yok): SERVICE dışı hizmet / CONSUMABLE dışı sarf → 400.
// `unit` sarf kaleminin birimidir, doğuşta donar. Replay TEK boğazdan; audit miktar DEĞERİ taşımaz.
// Taban (`basis`): PER_METER (varsayılan, bugünkü) | PER_ROLL (tambur çıktı topu başına). Çeşit (`propertyValueId`,
// ör. kurşun gramajı) normun KİMLİĞİDİR (hizmet, sarf, çeşit) — değişimde taşınır, değiştirilmez; taban değişebilir.
// =============================================================================
import { ConsumableNormBasis, ItemType, Prisma, type ServiceConsumableNorm } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { isClientTokenP2002, p2002Mentions } from "../utils/p2002";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { assertItemUsable, assertItemUsableTx, assertServiceItemUsable, assertServiceItemUsableTx } from "./helpers/item-usage.helper";
import { ACTIVE_COST_RATE, COST_RATE_REVOKE_REASON } from "./helpers/cost-rate-validity.helper";
import { parseDecimalField, parseTextField } from "./helpers/cost-input.helper";

const TABLE = "SERVICE_CONSUMABLE_NORM";
const ACTIVE_PAIR_RE = /service_consumable_norms_active_pair_uq|serviceItemId/i;

const ITEM_BRIEF = { select: { id: true, code: true, name: true, itemType: true, isActive: true } } as const;
// Hizmet kartı `service_items`'ta: tür kolonu yok (hep hizmet).
const SERVICE_BRIEF = { select: { id: true, code: true, name: true, isActive: true } } as const;

export const CONSUMABLE_NORM_SELECT = {
  id: true,
  serviceItemId: true,
  consumableItemId: true,
  qtyPerM: true,
  basis: true,
  propertyValueId: true,
  propertyValue: { select: { id: true, name: true, amount: true, property: { select: { id: true, name: true } } } },
  unit: true,
  note: true,
  createdAt: true,
  createdById: true,
  revokedAt: true,
  revokedById: true,
  revokeReason: true,
  serviceItem: SERVICE_BRIEF,
  consumableItem: ITEM_BRIEF,
} satisfies Prisma.ServiceConsumableNormSelect;

export type ConsumableNormRow = Prisma.ServiceConsumableNormGetPayload<{ select: typeof CONSUMABLE_NORM_SELECT }>;

export interface ConsumableNormValues {
  qtyPerM: unknown;
  basis?: ConsumableNormBasis;
  note?: unknown;
  clientToken: string;
}

interface ParsedValues {
  qtyPerM: Prisma.Decimal;
  basis: ConsumableNormBasis;
  note: string | null;
}

export interface ConsumableNormResult {
  row: ConsumableNormRow;
  previousId: string | null;
}

function parseValues(input: ConsumableNormValues): ParsedValues {
  // 0 = "bu hizmet sarf kullanmaz" açık beyanı (kârlılık ölçülmüş 0 sayar); negatif red.
  const qtyPerM = parseDecimalField(input.qtyPerM, { label: "Metre başına sarf miktarı", min: 0, scale: 6 });
  if (qtyPerM === null || qtyPerM === undefined) throw AppError.badRequest("Metre başına sarf miktarı zorunludur.");
  return { qtyPerM, basis: input.basis ?? ConsumableNormBasis.PER_METER, note: parseTextField(input.note, "Not", 300) ?? null };
}

const conflict = (message: string, code: string, extra: Record<string, unknown> = {}): AppError => AppError.conflict(message, { code, ...extra });

type NormKey = { serviceItemId: string; consumableItemId: string; propertyValueId: string | null };

const normReplay = ({ serviceItemId, consumableItemId, propertyValueId }: NormKey, values: ParsedValues) =>
  tokenReplay<ServiceConsumableNorm, ConsumableNormResult>({
    find: (db, clientToken) => db.serviceConsumableNorm.findUnique({ where: { clientToken } }),
    alive: (prior) => {
      if (!prior.revokedAt) return;
      throw conflict("Bu sarf normu yazılmış ama sonra değiştirilmiş ya da kaldırılmış — listeyi yenileyip formu yeniden açın.", "CONSUMABLE_NORM_SUPERSEDED", { normId: prior.id });
    },
    identity: (prior) => [
      { ad: "serviceItemId", mevcut: prior.serviceItemId, gelen: serviceItemId },
      { ad: "consumableItemId", mevcut: prior.consumableItemId, gelen: consumableItemId },
      { ad: "propertyValueId", mevcut: prior.propertyValueId, gelen: propertyValueId },
      { ad: "qtyPerM", mevcut: prior.qtyPerM, gelen: values.qtyPerM },
      { ad: "basis", mevcut: prior.basis, gelen: values.basis },
    ],
    collision: "Bu istemci anahtarı FARKLI bir sarf normu için kullanılmış. Formu kapatıp yeniden açın.",
    collisionEk: (prior) => ({ normId: prior.id }),
    respond: async (prior) => ({
      row: await prisma.serviceConsumableNorm.findUniqueOrThrow({ where: { id: prior.id }, select: CONSUMABLE_NORM_SELECT }),
      previousId: null,
    }),
  });

/** Tür + kullanım kapısı; sarf kaleminin birimini döner (norm doğuşta onu dondurur). */
async function assertItemsWritable(serviceItemId: string, consumableItemId: string): Promise<string> {
  if (serviceItemId === consumableItemId) throw AppError.badRequest("Hizmet kalemi ile sarf kalemi aynı olamaz.", { code: "CONSUMABLE_NORM_SAME_ITEM" });
  const items = await prisma.item.findMany({
    where: { id: { in: [serviceItemId, consumableItemId] } },
    select: { id: true, name: true, itemType: true, unit: true },
  });
  const service = await prisma.serviceItem.findUnique({ where: { id: serviceItemId }, select: { id: true } });
  const consumable = items.find((i) => i.id === consumableItemId);
  if (!service) {
    // Ürün kartı id'si hizmet yerine gelmişse operatöre türü söyle; hiçbir tabloda yoksa "bulunamadı".
    const product = items.find((i) => i.id === serviceItemId);
    if (!product) throw AppError.badRequest("Hizmet kalemi bulunamadı.", { code: "SERVICE_ITEM_INVALID", itemId: serviceItemId });
    throw AppError.badRequest(`"${product.name}" bir hizmet kalemi değil — sarf normu yalnız Hizmet türü kaleme tanımlanır.`, { code: "SERVICE_ITEM_INVALID", itemId: serviceItemId });
  }
  if (!consumable) throw AppError.badRequest("Sarf kalemi bulunamadı.", { code: "CONSUMABLE_ITEM_INVALID", itemId: consumableItemId });
  if (consumable.itemType !== ItemType.CONSUMABLE) {
    throw AppError.badRequest(`"${consumable.name}" bir sarf malzemesi değil — normun sarf kalemi Sarf türünde olmalı.`, { code: "CONSUMABLE_ITEM_INVALID", itemId: consumableItemId });
  }
  // Norm karta yeni TANIM ekler — pasif/'Tükenene kadar' kararı tek kaynaktan (item-usage).
  await checkUsage(serviceItemId, consumableItemId);
  return consumable.unit;
}

/**
 * Ön kontrol ile tx tekrarı aynı iki kartı okur; tx tarafı kartları FOR SHARE kilitler (pasife alma yarışı).
 * Sıra sabit: hizmet kartı (`service_items`) → sarf kartı (`items`) — iki ayrı tablo, deterministik.
 */
async function checkUsage(serviceItemId: string, consumableItemId: string, tx?: Prisma.TransactionClient): Promise<void> {
  if (tx) {
    await assertServiceItemUsableTx(tx, serviceItemId, "DEFINITION");
    await assertItemUsableTx(tx, consumableItemId, "DEFINITION");
    return;
  }
  await assertServiceItemUsable(prisma, serviceItemId, "DEFINITION");
  await assertItemUsable(prisma, consumableItemId, "DEFINITION");
}

function activeExists({ serviceItemId, consumableItemId, propertyValueId }: NormKey): AppError {
  const kim = propertyValueId ? "hizmet, sarf kalemi ve çeşit" : "hizmet ve sarf kalemi (çeşitsiz)";
  return conflict(`Bu ${kim} için zaten aktif bir norm var — değiştirmek için mevcut satırı değiştirin.`, "CONSUMABLE_NORM_ACTIVE_EXISTS", { serviceItemId, consumableItemId, propertyValueId });
}

/** Çeşit kapısı: değer var olmalı (pasif değer yeni tanıma bağlanmaz). */
async function assertPropertyValueWritable(propertyValueId: string | null): Promise<void> {
  if (!propertyValueId) return;
  const v = await prisma.fabricPropertyValue.findUnique({ where: { id: propertyValueId }, select: { isActive: true, name: true } });
  if (!v) throw AppError.badRequest("Çeşit (özellik değeri) bulunamadı.", { code: "PROPERTY_VALUE_INVALID", propertyValueId });
  if (!v.isActive) throw AppError.badRequest(`"${v.name}" çeşidi pasif — sarf normu bağlanamaz.`, { code: "PROPERTY_VALUE_INVALID", propertyValueId });
}

function logAudit(userId: string, action: "CREATE" | "UPDATE", recordId: string, newData: Record<string, unknown>): void {
  void AuditService.log({ userId, action, tableName: TABLE, recordId, newData }).catch(() => undefined);
}

type IdCondition = string | { in: string[] } | null;

export async function listConsumableNorms(opts: {
  serviceItemId: IdCondition;
  consumableItemId: IdCondition;
  includeRevoked: boolean;
}): Promise<ConsumableNormRow[]> {
  return prisma.serviceConsumableNorm.findMany({
    where: {
      AND: [
        opts.serviceItemId ? { serviceItemId: opts.serviceItemId } : {},
        opts.consumableItemId ? { consumableItemId: opts.consumableItemId } : {},
        opts.includeRevoked ? {} : ACTIVE_COST_RATE,
      ],
    },
    select: CONSUMABLE_NORM_SELECT,
    orderBy: [{ serviceItemId: "asc" }, { consumableItemId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

/** YARAT — çiftin ilk (ya da kaldırılmış sonrası) normu; aktif varsa 409 (değişim ayrı uçtur). */
export async function createConsumableNorm(key: NormKey, input: ConsumableNormValues, userId: string): Promise<ConsumableNormResult> {
  const { serviceItemId, consumableItemId, propertyValueId } = key;
  const values = parseValues(input);
  return normReplay(key, values).run(input.clientToken, async () => {
    const unit = await assertItemsWritable(serviceItemId, consumableItemId);
    await assertPropertyValueWritable(propertyValueId);
    const current = await prisma.serviceConsumableNorm.findFirst({ where: { serviceItemId, consumableItemId, propertyValueId, ...ACTIVE_COST_RATE }, select: { id: true } });
    if (current) throw activeExists(key);
    let created: { id: string };
    try {
      created = await prisma.$transaction(async (tx) => {
        await checkUsage(serviceItemId, consumableItemId, tx);
        return tx.serviceConsumableNorm.create({
          data: { serviceItemId, consumableItemId, propertyValueId, ...values, unit, clientToken: input.clientToken, createdById: userId },
          select: { id: true },
        });
      });
    } catch (e) {
      if (isClientTokenP2002(e)) throw e;
      if (p2002Mentions(e, ACTIVE_PAIR_RE)) throw activeExists(key);
      throw e;
    }
    logAudit(userId, "CREATE", created.id, { serviceItemId, consumableItemId, propertyValueId, basis: values.basis, alanlar: ["qtyPerM", "note"] });
    return { row: await prisma.serviceConsumableNorm.findUniqueOrThrow({ where: { id: created.id }, select: CONSUMABLE_NORM_SELECT }), previousId: null };
  });
}

/** DEĞİŞTİR — aynı tx'te eski aktif satırın damgası + yeni satır; eski satır artık aktif değilse 409 `CONSUMABLE_NORM_STALE`. */
export async function changeConsumableNorm(normId: string, input: ConsumableNormValues, userId: string): Promise<ConsumableNormResult> {
  const values = parseValues(input);
  const old = await prisma.serviceConsumableNorm.findUnique({ where: { id: normId }, select: { id: true, serviceItemId: true, consumableItemId: true, propertyValueId: true } });
  if (!old) throw AppError.notFound("Sarf normu bulunamadı.", { code: "CONSUMABLE_NORM_NOT_FOUND" });
  const { serviceItemId, consumableItemId, propertyValueId } = old;
  const key: NormKey = { serviceItemId, consumableItemId, propertyValueId };
  return normReplay(key, values).run(input.clientToken, async () => {
    const unit = await assertItemsWritable(serviceItemId, consumableItemId);
    const at = new Date();
    let created: { id: string };
    try {
      created = await prisma.$transaction(async (tx) => {
        await checkUsage(serviceItemId, consumableItemId, tx);
        const claim = await tx.serviceConsumableNorm.updateMany({
          where: { id: normId, revokedAt: null },
          data: { revokedAt: at, revokedById: userId, revokeReason: COST_RATE_REVOKE_REASON.CHANGED },
        });
        if (claim.count === 0) {
          throw conflict("Bu sarf normu aynı anda başka bir işlemle değişti ya da kaldırıldı — listeyi yenileyin.", "CONSUMABLE_NORM_STALE", { normId });
        }
        return tx.serviceConsumableNorm.create({
          data: { serviceItemId, consumableItemId, propertyValueId, ...values, unit, clientToken: input.clientToken, createdById: userId, createdAt: at },
          select: { id: true },
        });
      });
    } catch (e) {
      if (isClientTokenP2002(e)) throw e;
      if (p2002Mentions(e, ACTIVE_PAIR_RE)) throw activeExists(key);
      throw e;
    }
    logAudit(userId, "UPDATE", normId, { serviceItemId, consumableItemId, revokeReason: COST_RATE_REVOKE_REASON.CHANGED, yeniSurumId: created.id });
    logAudit(userId, "CREATE", created.id, { serviceItemId, consumableItemId, propertyValueId, basis: values.basis, oncekiSurumId: normId, alanlar: ["qtyPerM", "note"] });
    return {
      row: await prisma.serviceConsumableNorm.findUniqueOrThrow({ where: { id: created.id }, select: CONSUMABLE_NORM_SELECT }),
      previousId: normId,
    };
  });
}

/** KALDIR — damga (satır silinmez); zaten damgalıysa 409. */
export async function revokeConsumableNorm(normId: string, reason: string | null, userId: string): Promise<{ id: string }> {
  const row = await prisma.serviceConsumableNorm.findUnique({ where: { id: normId }, select: { id: true, serviceItemId: true, consumableItemId: true, revokedAt: true } });
  if (!row) throw AppError.notFound("Sarf normu bulunamadı.", { code: "CONSUMABLE_NORM_NOT_FOUND" });
  const stale = () => conflict("Bu sarf normu zaten kaldırılmış ya da değiştirilmiş — listeyi yenileyin.", "CONSUMABLE_NORM_STALE", { normId });
  if (row.revokedAt) throw stale();
  const claim = await prisma.serviceConsumableNorm.updateMany({
    where: { id: normId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: userId, revokeReason: reason?.trim() || COST_RATE_REVOKE_REASON.REMOVED },
  });
  if (claim.count === 0) throw stale();
  logAudit(userId, "UPDATE", normId, { serviceItemId: row.serviceItemId, consumableItemId: row.consumableItemId, kaldirildi: true });
  return { id: normId };
}
