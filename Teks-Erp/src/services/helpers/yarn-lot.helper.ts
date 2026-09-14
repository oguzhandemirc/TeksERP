// =============================================================================
// TeksERP — İPLİK LOTU yardımcıları (devere Faz 2, DEVERE-LEVENT-TARAMASI §3.5 / §4)
// =============================================================================
// Lot bir DURUM kaydıdır (ana veri), bakiyesi TÜRETİLİR: Σ yarnMovementSign × qtyKg
// WHERE lotId — ayrı bakiye tablosu YOK, `YarnStock` (kalem × depo) tek yazar kuralı
// değişmez. Bu dosya lotun DOĞUŞUNU (mal kabul upsert'i), KİMLİK denetimini ve
// türetilen bakiyeyi tek yerde tutar; yazıcı yine `applyYarnMovementTx`tir.
//
// `lotNo` irsaliyedeki metindir: AYRIŞTIRILMAZ, normalize EDİLMEZ (büyük/küçük harf,
// boşluk yapısı korunur) — yalnız çevresi TRIM edilir, boş → null (1e ek şart ①).
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { lockCodeScopeTx } from "./code-unique.helper";
import { yarnInboundKinds } from "./yarn-sign.helper";

/** İrsaliye metni olduğu gibi; çevresindeki boşluk değil. Boş/yalnız boşluk → null. */
export function normalizeLotNo(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Lotu bul ya da yarat — `[itemId, lotNo]` tekil. 8029 kod-kapsam kilidi tx'in bu
 * adımdaki İLK ifadesidir: iki eşzamanlı mal kabul aynı lotu iki kez yaratmaya
 * kalkmasın (P2002 yarışı yerine seri doğuş). Var olan lotun tedarikçisi
 * DEĞİŞTİRİLMEZ — ilk doğuş kimlik, sonraki fişler yalnız hareket yazar.
 */
export async function ensureYarnLotTx(
  tx: Prisma.TransactionClient,
  input: { itemId: string; lotNo: string; supplierId?: string | null; userId?: string | null },
): Promise<{ id: string; lotNo: string; created: boolean }> {
  await lockCodeScopeTx(tx, "yarnLot", `${input.itemId}|${input.lotNo}`);
  const existing = await tx.yarnLot.findUnique({
    where: { itemId_lotNo: { itemId: input.itemId, lotNo: input.lotNo } },
    select: { id: true, lotNo: true, isActive: true },
  });
  if (existing) {
    if (!existing.isActive) throw AppError.badRequest(`"${existing.lotNo}" lotu pasif — bu lota giriş yazılamaz; lotu aktifleştirin ya da başka lot numarası girin.`, { code: "YARN_LOT_INACTIVE", lotId: existing.id });
    return { id: existing.id, lotNo: existing.lotNo, created: false };
  }
  const created = await tx.yarnLot.create({
    data: { itemId: input.itemId, lotNo: input.lotNo, supplierId: input.supplierId ?? null, createdById: input.userId ?? null, updatedById: input.userId ?? null },
    select: { id: true, lotNo: true },
  });
  return { ...created, created: true };
}

/**
 * Lot bu kaleme mi ait ve aktif mi — hareket yazılmadan ÖNCE sorulur. DB'de çapraz-tablo
 * CHECK kurulamaz (lot.itemId ↔ movement.itemId); tek kapı burası, mutabakat §40 ikinci hat.
 */
export async function assertLotMatchesItemTx(tx: Prisma.TransactionClient, lotId: string, itemId: string): Promise<void> {
  const lot = await tx.yarnLot.findUnique({ where: { id: lotId }, select: { itemId: true, lotNo: true, isActive: true } });
  if (!lot) throw AppError.badRequest("İplik lotu bulunamadı", { code: "YARN_LOT_NOT_FOUND", lotId });
  if (lot.itemId !== itemId) throw AppError.badRequest(`"${lot.lotNo}" lotu başka bir iplik kalemine ait — hareket kalemiyle lot kalemi aynı olmalı.`, { code: "YARN_LOT_ITEM_MISMATCH", lotId });
  if (!lot.isActive) throw AppError.badRequest(`"${lot.lotNo}" lotu pasif — pasif lota hareket yazılamaz.`, { code: "YARN_LOT_INACTIVE", lotId });
}

/** SQL'de işaret: giriş türleri tek kaynaktan (`yarnInboundKinds`), elle liste YOK. */
function signedQtySql(): Prisma.Sql {
  const inbound = yarnInboundKinds().map((k) => Prisma.sql`${k}::"YarnMovementKind"`);
  return Prisma.sql`CASE WHEN "kind" IN (${Prisma.join(inbound)}) THEN "qtyKg" ELSE -"qtyKg" END`;
}

/**
 * Türetilen lot bakiyesi — depo verilirse (lot × depo), verilmezse lotun toplamı.
 * Çıkış kapısı depo bazında sorar (iplik depoda durur); liste ekranı toplamı gösterir.
 */
export async function yarnLotBalanceTx(
  tx: Prisma.TransactionClient | { $queryRaw: Prisma.TransactionClient["$queryRaw"] },
  lotId: string,
  warehouseId?: string | null,
): Promise<Prisma.Decimal> {
  const rows = await tx.$queryRaw<Array<{ balance: string | number | Prisma.Decimal | null }>>`
    SELECT COALESCE(SUM(${signedQtySql()}), 0) AS balance
    FROM "yarn_movements"
    WHERE "lotId" = ${lotId}::uuid
      ${warehouseId ? Prisma.sql`AND "warehouseId" = ${warehouseId}::uuid` : Prisma.empty}
  `;
  return new Prisma.Decimal(String(rows[0]?.balance ?? 0));
}

/** Birden çok lotun toplam bakiyesi (liste ekranı, tek sorgu). */
export async function yarnLotBalancesTx(
  tx: { $queryRaw: Prisma.TransactionClient["$queryRaw"] },
  lotIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  const out = new Map<string, Prisma.Decimal>();
  if (lotIds.length === 0) return out;
  const rows = await tx.$queryRaw<Array<{ lotId: string; balance: string | number | Prisma.Decimal | null }>>`
    SELECT "lotId", COALESCE(SUM(${signedQtySql()}), 0) AS balance
    FROM "yarn_movements"
    WHERE "lotId" IN (${Prisma.join(lotIds.map((id) => Prisma.sql`${id}::uuid`))})
    GROUP BY "lotId"
  `;
  for (const r of rows) out.set(r.lotId, new Prisma.Decimal(String(r.balance ?? 0)));
  return out;
}
