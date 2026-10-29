// =============================================================================
// İŞ EMRİ HEDEF ÇEŞİT DEĞERİ — `WorkOrderTargetValue` (KQ-D6, 2026-10-24)
// =============================================================================
// "Hedef kurşun gramajı 50 gr" İE'nin PLAN alanıdır: toplara yayılmaz, uygulananla
// karışmaz (`WorkOrderTargetProperty` bu yüzden kullanılmaz). Sapma TÜRETİLİR
// (`process-summary.helper.ts`), yazılmaz ve hiçbir yazımı engellemez.
// Değişim yerinde güncelleme değildir: eski satır ATOMİK CLAIM ile damgalanır,
// yenisi yazılır — DB'de partial unique `(workOrderId, propertyId) WHERE revokedAt IS NULL`.
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Tx = Prisma.TransactionClient;
type Reader = Tx | PrismaClient;

/** AKTİF hedef — okuyan her yol buradan geçer. */
export const ACTIVE_TARGET_VALUE = { revokedAt: null } as const;

export const TARGET_VALUE_CHANGE_REASON = "hedef değişti";

export interface TargetValueItem {
  propertyId: string;
  valueId: string;
}

/** PUT gövde kalemi: `valueId: null` = o özelliğin hedefini AÇIKÇA kaldır (K1, 2026-10-29). */
export interface TargetValueUpdateItem {
  propertyId: string;
  valueId: string | null;
}

export interface TargetValueChange {
  revoked: Array<{ id: string; propertyId: string; valueId: string }>;
  created: Array<{ id: string; propertyId: string; valueId: string }>;
}

/**
 * Gövde doğrulaması (fail-closed): özellik bir ÇEŞİT özelliği olmalı
 * (`variantOfPropertyId` dolu), değer o özelliğe ait ve aktif olmalı; aynı özellik iki kez gelemez.
 */
export async function assertTargetValueItems(db: Reader, all: TargetValueUpdateItem[]): Promise<void> {
  if (all.length === 0) return;
  const propertyIds = all.map((i) => i.propertyId);
  if (new Set(propertyIds).size !== propertyIds.length) {
    throw AppError.badRequest("Aynı özellik için birden fazla hedef verilemez", { code: "TARGET_VALUE_DUPLICATE" });
  }
  // Kaldırma kalemi (`valueId: null`) doğrulanmaz: aktif hedefi yoksa no-op, pasif özelliğin hedefi de kaldırılabilir.
  const items = all.filter((i): i is TargetValueItem => i.valueId !== null);
  if (items.length === 0) return;
  const props = await db.fabricProperty.findMany({
    where: { id: { in: items.map((i) => i.propertyId) } },
    select: { id: true, name: true, isActive: true, variantOfPropertyId: true },
  });
  for (const item of items) {
    const p = props.find((x) => x.id === item.propertyId);
    if (!p || !p.isActive) throw AppError.badRequest("Hedef özellik bulunamadı veya pasif", { code: "TARGET_PROPERTY_NOT_FOUND" });
    if (!p.variantOfPropertyId) {
      throw AppError.badRequest(`'${p.name}' bir çeşit özelliği değil — hedef değer yalnız çeşit özelliğine verilir`, {
        code: "TARGET_PROPERTY_NOT_VARIANT",
      });
    }
  }
  const values = await db.fabricPropertyValue.findMany({
    where: { id: { in: items.map((i) => i.valueId) }, isActive: true },
    select: { id: true, propertyId: true },
  });
  for (const item of items) {
    if (!values.some((v) => v.id === item.valueId && v.propertyId === item.propertyId)) {
      throw AppError.badRequest("Hedef değer bu özelliğe ait değil ya da pasif", { code: "TARGET_VALUE_INVALID" });
    }
  }
}

/** İE'nin aktif hedefleri (ad ve özellik bilgisiyle). */
export async function readActiveTargetValues(db: Reader, workOrderId: string) {
  return db.workOrderTargetValue.findMany({
    where: { workOrderId, ...ACTIVE_TARGET_VALUE },
    select: {
      id: true,
      propertyId: true,
      valueId: true,
      property: { select: { name: true, variantOfPropertyId: true } },
      value: { select: { name: true, code: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Eski hedefi damgalar — ters mekanizma (`defter-beyan.ts` beyanı). Claim 0 → 409. */
export async function revokeTargetValueTx(tx: Tx, id: string, userId: string | null): Promise<void> {
  const claim = await tx.workOrderTargetValue.updateMany({
    where: { id, ...ACTIVE_TARGET_VALUE },
    data: { revokedAt: new Date(), revokedById: userId, revokeReason: TARGET_VALUE_CHANGE_REASON },
  });
  if (claim.count === 0) {
    throw AppError.conflict("Hedef bu sırada başka bir işlemle değişti — tekrar deneyin.", { code: "TARGET_VALUE_CONFLICT" });
  }
}

/**
 * İE hedeflerini ÖZELLİK KAPSAMLI günceller (K1, 2026-10-29): yalnız `items`taki özelliklerin
 * aktif hedefi değişir (`valueId: null` = kaldır), gövdede olmayan özelliğe dokunulmaz — tek
 * tıkla başka özelliğin hedefi sessizce düşmesin. Boş liste = ESKİ İSTEMCİ sözleşmesi "hepsini
 * kaldır" (panel ≤ K1 hedefi kaldırmayı `[]` ile yapıyordu). Aynısı no-op. Çağıran tx'in İLK
 * ifadesi İE satır kilidi olmalıdır (`touchWorkOrderTx`).
 */
export async function setWorkOrderTargetValuesTx(
  tx: Tx,
  args: { workOrderId: string; items: TargetValueUpdateItem[]; userId: string | null },
): Promise<TargetValueChange> {
  const active = await tx.workOrderTargetValue.findMany({
    where: { workOrderId: args.workOrderId, ...ACTIVE_TARGET_VALUE },
    select: { id: true, propertyId: true, valueId: true },
  });
  const legacyClearAll = args.items.length === 0;
  const change: TargetValueChange = { revoked: [], created: [] };
  for (const row of active) {
    const wanted = args.items.find((i) => i.propertyId === row.propertyId);
    if (!wanted && !legacyClearAll) continue;
    if (wanted && wanted.valueId === row.valueId) continue;
    await revokeTargetValueTx(tx, row.id, args.userId);
    change.revoked.push(row);
  }
  for (const item of args.items) {
    const valueId = item.valueId;
    if (valueId === null) continue;
    if (active.some((r) => r.propertyId === item.propertyId && r.valueId === valueId)) continue;
    const created = await tx.workOrderTargetValue.create({
      data: { workOrderId: args.workOrderId, propertyId: item.propertyId, valueId, createdById: args.userId },
      select: { id: true, propertyId: true, valueId: true },
    });
    change.created.push(created);
  }
  return change;
}

/** Klon: kaynak İE'nin aktif hedeflerini yeni İE'ye kopyalar (yalnız aktif satırlar). */
export async function copyTargetValuesTx(
  tx: Tx,
  args: { fromWorkOrderId: string; toWorkOrderId: string; userId: string | null },
): Promise<number> {
  const rows = await tx.workOrderTargetValue.findMany({
    where: { workOrderId: args.fromWorkOrderId, ...ACTIVE_TARGET_VALUE },
    select: { propertyId: true, valueId: true },
  });
  if (rows.length === 0) return 0;
  const res = await tx.workOrderTargetValue.createMany({
    data: rows.map((r) => ({ ...r, workOrderId: args.toWorkOrderId, createdById: args.userId })),
    skipDuplicates: true,
  });
  return res.count;
}

/** İE create gövdesine nested yazım parçası (boşsa anahtar yok) — create fonksiyonu kısa kalsın. */
export function targetValuesNestedCreate(items: TargetValueItem[], userId?: string | null) {
  return items.length > 0
    ? { targetValues: { create: items.map((v) => ({ ...v, createdById: userId ?? null })) } }
    : {};
}
