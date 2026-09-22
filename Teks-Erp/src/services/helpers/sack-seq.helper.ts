// =============================================================================
// SEVKİYAT İÇİ ÇUVAL SIRASI ETİKETİ (2026-09-22) — `Sack.seq` sayısının kâğıttaki hâli.
// Sayı sevk anında verilir (`shipping.sackSeqStart`'tan başlar); etiket SUNUM
// kararıdır ve her baskıda canlı bayraklardan çözülür (ön ek · "n/N"); belgeye
// yalnız `shipping.sackSeqOnDoc` açıkken girer (kapalı = bugünkü çıktı, tek bayt
// değişmez). Partisiz çuvalın AMBALAJ NO'su ise ayrı bir soru (`packing.poolPackageNo`).
// =============================================================================
import { Prisma } from "@prisma/client";

import prisma from "../../lib/prisma";
import {
  readPackingPoolPackageNo,
  readShippingSackSeqPrefix,
  readShippingSackSeqPrefixLive,
  readShippingSackSeqShowTotal,
  sanitizeSackSeqPrefix,
  readShippingSackSeqStart,
  type ShippingSackSeqPrefix,
} from "../system-setting.service";

export interface SackSeqFormat {
  /** Ham ön ek metni (serbest, ≤8) — "SP", "P-", "Çuval ". Boş = yalnız sayı. */
  prefix: ShippingSackSeqPrefix;
  showTotal: boolean;
}

/** "SP3", "P-3/100", "Çuval 3" — seq null ise boş (havuz çuvalı). */
export function formatSackSeqLabel(seq: number | null | undefined, total: number, fmt: SackSeqFormat): string {
  if (seq == null) return "";
  const body = `${sanitizeSackSeqPrefix(fmt.prefix)}${seq}`;
  return fmt.showTotal && total > 0 ? `${body}/${total}` : body;
}

/**
 * Baskı biçimi — "n/N" her zaman canlı; ÖN EK ise `shipping.sackSeqPrefixLive`e bağlı:
 * kapalıyken (varsayılan, önerilen) sevk anında snapshot'a donan ön ek basılır (eski
 * belgeler değişmez; ön ek doğmadan önce donan belgede ön ek yok), açıkken bugünkü ayar.
 */
export async function readSackSeqFormat(frozenPrefix: string | null | undefined, tx?: Pick<typeof prisma, "systemSetting">): Promise<SackSeqFormat> {
  const live = await readShippingSackSeqPrefixLive(tx);
  return {
    prefix: live ? await readShippingSackSeqPrefix(tx) : sanitizeSackSeqPrefix(frozenPrefix ?? ""),
    showTotal: await readShippingSackSeqShowTotal(tx),
  };
}

/** Sevkiyata giren çuvalların ilk sırası (`shipping.sackSeqStart`, varsayılan 1). */
export async function readSackSeqStart(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  return readShippingSackSeqStart(tx);
}

/**
 * PARTİSİZ ÇUVAL AMBALAJ NO uzayı — `hashtext(customerId)`; yalnız `packing.poolPackageNo =
 * acilista` iken çuval açılışında alınır (parti sayacı 8033'ten AYRI uzay: parti dışı numara
 * partinin numarasıyla yarışmaz).
 */
export const POOL_PACKAGE_NO_LOCK_NS: number = 8035;

/**
 * Havuz çuvalı için sıradaki ambalaj no — `acilista` rejiminde, tx İÇİNDE, kilit ALINDIKTAN
 * sonra: carinin parti dışı çuvallarının en büyük numarası + 1 (sevk edilmişler dahil —
 * numara geri verilmez, "artan" rejimiyle aynı). Rejim `sevkte` ya da müşterisiz çuvalsa
 * `null` döner (numara sevkte `seq` olarak doğar).
 */
export async function nextPoolPackageNoTx(tx: Prisma.TransactionClient, customerId: string | null): Promise<number | null> {
  if (!customerId) return null;
  if ((await readPackingPoolPackageNo(tx as unknown as Pick<typeof prisma, "systemSetting">)) !== "acilista") return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POOL_PACKAGE_NO_LOCK_NS}::int, hashtext(${customerId}))`;
  const son = await tx.sack.aggregate({
    where: { customerId, packingGroupId: null, packageNo: { not: null } },
    _max: { packageNo: true },
  });
  return (son._max.packageNo ?? 0) + 1;
}
