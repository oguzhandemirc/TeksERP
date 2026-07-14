// =============================================================================
// Karşılanma primitifleri — spec eşleştirme + FIFO tahsis (SAF, DB-bağımsız)
// =============================================================================
// GEVŞEK MODEL: top→sipariş bağı YOK. Karşılanma birimi = spec (kalem+renk+en);
// aynı spec'in topları fungible. Bu modül üç yerde paylaşılır:
//   • shipping.service (getShipmentById projeksiyonu, listOpenOrders spec eşleşmesi)
//   • shipping.service (writeShipmentAllocationsTx — sevk-anı çuval-farkındalı FIFO)
//   • subcontractor.service (fason doğrudan sevk önizlemesi — aynı FIFO/spec mantığı)
// Tek karşılanma kaynağı; kopya algoritma yok.
// =============================================================================

import { Prisma } from "@prisma/client";

export const D0 = (): Prisma.Decimal => new Prisma.Decimal(0);

export interface RollSpec {
  itemId: string;
  colorId: string | null;
  width: Prisma.Decimal | null;
  currentQty: Prisma.Decimal;
}

export interface LineForAlloc {
  id: string;
  itemId: string;
  colorId: string | null;
  width: Prisma.Decimal | null;
  quantity: Prisma.Decimal;
  shippedQty: Prisma.Decimal;
  deadline: Date | null;
  orderDate: Date;
  lineCreatedAt: Date;
}

// item kesin; renk/en ikisi de doluysa eşit olmalı, biri null ise gevşek eşleşir.
export function specMatch(
  a: { itemId: string; colorId: string | null; width: Prisma.Decimal | null },
  b: { itemId: string; colorId: string | null; width: Prisma.Decimal | null }
): boolean {
  if (a.itemId !== b.itemId) return false;
  if (a.colorId != null && b.colorId != null && a.colorId !== b.colorId) return false;
  if (
    a.width != null &&
    b.width != null &&
    !new Prisma.Decimal(a.width).equals(new Prisma.Decimal(b.width))
  ) {
    return false;
  }
  return true;
}

// Spec havuzu (exact key itemId|colorId|width) — toplam metrajı gruplar.
export function buildPool(rolls: RollSpec[]) {
  const pool: {
    itemId: string;
    colorId: string | null;
    width: Prisma.Decimal | null;
    remaining: Prisma.Decimal;
  }[] = [];
  const poolByKey = new Map<string, (typeof pool)[number]>();
  for (const r of rolls) {
    const key = `${r.itemId}|${r.colorId ?? ""}|${r.width == null ? "" : new Prisma.Decimal(r.width).toString()}`;
    let e = poolByKey.get(key);
    if (!e) {
      e = { itemId: r.itemId, colorId: r.colorId, width: r.width, remaining: D0() };
      poolByKey.set(key, e);
      pool.push(e);
    }
    e.remaining = e.remaining.plus(r.currentQty);
  }
  return pool;
}

// Satır FIFO: termin → sipariş tarihi → satır oluşturma.
export function lineFifoCmp(
  a: { deadline: Date | null; orderDate: Date; lineCreatedAt: Date },
  b: { deadline: Date | null; orderDate: Date; lineCreatedAt: Date }
): number {
  const ad = a.deadline ? a.deadline.getTime() : Infinity;
  const bd = b.deadline ? b.deadline.getTime() : Infinity;
  if (ad !== bd) return ad - bd;
  const ao = a.orderDate.getTime();
  const bo = b.orderDate.getTime();
  if (ao !== bo) return ao - bo;
  return a.lineCreatedAt.getTime() - b.lineCreatedAt.getTime();
}

/**
 * Spec-toplam → seçilen sipariş satırlarına termin→tarih FIFO dağıt. Her satır
 * (quantity − shippedQty) kadar doldurulur; havuz biterse eksik, artarsa fazla
 * (tahsis edilmez). Saf — canlı önizleme ve fason doğrudan sevk aynı sonucu üretir.
 */
export function allocate(
  rolls: RollSpec[],
  lines: LineForAlloc[]
): Map<string, Prisma.Decimal> {
  const pool = buildPool(rolls);
  const sorted = [...lines].sort(lineFifoCmp);

  const result = new Map<string, Prisma.Decimal>();
  for (const line of sorted) {
    let need = Prisma.Decimal.max(0, line.quantity.minus(line.shippedQty));
    if (need.lessThanOrEqualTo(0)) continue;
    let alloc = D0();
    for (const e of pool) {
      if (need.lessThanOrEqualTo(0)) break;
      if (e.remaining.lessThanOrEqualTo(0)) continue;
      if (!specMatch(e, line)) continue;
      const take = Prisma.Decimal.min(need, e.remaining);
      e.remaining = e.remaining.minus(take);
      need = need.minus(take);
      alloc = alloc.plus(take);
    }
    if (alloc.greaterThan(0)) result.set(line.id, alloc);
  }
  return result;
}

/**
 * GÖSTERİM için GERÇEK okutulan metraj — satır başına KAPSIZ (uncapped). allocate
 * satırı `need`'de kapatıp fazlalığı düşürür (karşılanma için doğru); bu ise operatörün
 * gördüğü GERÇEK rakamı üretir ("okutulan 100 / istenen 50"). Hiçbir satıra uymayan
 * top (yabancı) satır görünümünde yer almaz (çuval içeriğinde görünür).
 */
export function computeLoadedByLine(
  rolls: RollSpec[],
  lines: LineForAlloc[]
): Map<string, Prisma.Decimal> {
  const pool = buildPool(rolls);
  const sorted = [...lines].sort(lineFifoCmp);
  const need = new Map<string, Prisma.Decimal>();
  for (const l of sorted) need.set(l.id, Prisma.Decimal.max(0, l.quantity.minus(l.shippedQty)));

  const loaded = new Map<string, Prisma.Decimal>();
  const add = (id: string, q: Prisma.Decimal) => loaded.set(id, (loaded.get(id) ?? D0()).plus(q));

  // 1) Capped kısım — allocate ile birebir.
  for (const line of sorted) {
    let rem = need.get(line.id)!;
    if (rem.lessThanOrEqualTo(0)) continue;
    for (const e of pool) {
      if (rem.lessThanOrEqualTo(0)) break;
      if (e.remaining.lessThanOrEqualTo(0)) continue;
      if (!specMatch(e, line)) continue;
      const take = Prisma.Decimal.min(rem, e.remaining);
      e.remaining = e.remaining.minus(take);
      rem = rem.minus(take);
      add(line.id, take);
    }
  }

  // 2) Overflow — kalan pool'u eşleşen satırlara dağıt (son satıra kalanı vererek drift'i önle).
  for (const e of pool) {
    if (e.remaining.lessThanOrEqualTo(0)) continue;
    const matching = sorted.filter((l) => specMatch(e, l));
    if (matching.length === 0) continue;
    const totalNeed = matching.reduce((s, l) => s.plus(need.get(l.id) ?? D0()), D0());
    let dist = D0();
    matching.forEach((l, i) => {
      const last = i === matching.length - 1;
      const share = last
        ? e.remaining.minus(dist)
        : totalNeed.greaterThan(0)
          ? e.remaining.times(need.get(l.id)!).dividedBy(totalNeed)
          : e.remaining.dividedBy(matching.length);
      dist = dist.plus(share);
      add(l.id, share);
    });
  }
  return loaded;
}

// =============================================================================
// ÇUVAL-FARKINDALI FIFO — sevk-anı tahsis çekirdeği (writeShipmentAllocationsTx)
// =============================================================================

/** Havuz çuvalı — createdAt sırasına göre FIFO; içeriği (rolls) spec-toplam taşır. */
export interface PoolSack {
  sackId: string;
  branchId: string | null;
  rolls: RollSpec[];
}

/** Rebalance satırı — need = quantity − shippedQty − frozenPacked (çağıran hesaplar). */
export interface SackAllocLine {
  id: string;
  itemId: string;
  colorId: string | null;
  width: Prisma.Decimal | null;
  branchId: string | null; // siparişin şubesi — çuval şubesiyle eşleşmeli
  need: Prisma.Decimal;
  deadline: Date | null;
  orderDate: Date;
  lineCreatedAt: Date;
}

/** Çuval şube-eşleşmesi: ikisi de null veya eşit (sevkiyatın tek-şube invariant'ıyla tutarlı). */
function branchMatch(sackBranchId: string | null, lineBranchId: string | null): boolean {
  return (sackBranchId ?? null) === (lineBranchId ?? null);
}

/**
 * Depodaki çuvalları açık sipariş satırlarına ÇUVAL-FARKINDALI FIFO ile dağıt.
 * İki boyutta FIFO: çuvallar FIFO sırasında (createdAt asc — çağıran sıralar), satırlar
 * termin→tarih sırasında. Her (çuval, satır) çifti için tahsis metrajı üretir → SackAllocation
 * defteri. Bir çuvalın bir satıra hiç uymayan içeriği (spec/şube) tahsis edilmez (fazla mal).
 *
 * SAF: DB'ye dokunmaz. Girdideki `need` ve `remaining` değerleri MUTASYONA uğrar (kopya
 * verilmeli değil — çağıran taze diziler kurar).
 */
export function distributeSacksToLines(
  sacks: PoolSack[], // FIFO sırasında (createdAt asc, id)
  lines: SackAllocLine[]
): { sackId: string; orderLineId: string; qty: Prisma.Decimal }[] {
  const sortedLines = [...lines].sort(lineFifoCmp);
  const result: { sackId: string; orderLineId: string; qty: Prisma.Decimal }[] = [];

  for (const sack of sacks) {
    const specRemaining = buildPool(sack.rolls);
    for (const line of sortedLines) {
      if (line.need.lessThanOrEqualTo(0)) continue;
      if (!branchMatch(sack.branchId, line.branchId)) continue;
      let allocForLine = D0();
      for (const e of specRemaining) {
        if (line.need.lessThanOrEqualTo(0)) break;
        if (e.remaining.lessThanOrEqualTo(0)) continue;
        if (!specMatch(e, line)) continue;
        const take = Prisma.Decimal.min(line.need, e.remaining);
        e.remaining = e.remaining.minus(take);
        line.need = line.need.minus(take);
        allocForLine = allocForLine.plus(take);
      }
      if (allocForLine.greaterThan(0)) {
        result.push({ sackId: sack.sackId, orderLineId: line.id, qty: allocForLine });
      }
    }
  }
  return result;
}
