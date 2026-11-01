// =============================================================================
// ANA VERİ BİRLEŞTİRME · KEEP_ON_SOURCE takibi (2026-11-01, Gülkesim provası)
// =============================================================================
// İki müşteri kartının İKİSİNDE de cari hesap varsa birleşen kartın hesabı mezar taşında KALIR (`customerId
// @unique` survivor'da ikinci hesaba izin vermez); kimliği mezar taşının `mergedIntoId`siyle survivor'a çözülür.
// Kapanış yazıcısı cari birleştirme virmanıdır (`cari-merge.helper.ts`) — bu dosya yalnız panelin "Şimdi cari
// hesapları birleştir" bağlantısının yükünü (hesap + bakiye) kurar; YAZMAZ.
// =============================================================================
import prisma from "../../lib/prisma";
import { findCariAccountForCardTx } from "./finance.helper";

export interface KeptOnSourceRow {
  table: string;
  label: string;
  sourceId: string;
  rowIds: string[];
}

export interface MergeFollowUp {
  kind: "CARI_MERGE";
  /** Mezar taşında kalan hesap — cari birleştirmenin KAYNAĞI. */
  cariId: string;
  label: string;
  /** Survivor'ın kendi hesabı — cari birleştirmenin HEDEFİ (yoksa null: ilk kaynak taşınmamış olabilir). */
  targetCariId: string | null;
  balances: Array<{ currency: string; balance: string }>;
}

/** Kalan cari hesap satırlarından takip listesi; diğer tablolar için takip yok. */
export async function mergeFollowUps(kept: KeptOnSourceRow[], survivorId?: string): Promise<MergeFollowUp[]> {
  const ids = kept.filter((k) => k.table === "cari_accounts").flatMap((k) => k.rowIds);
  if (ids.length === 0) return [];
  const rows = await prisma.cariAccount.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      customerId: true,
      customer: { select: { code: true, name: true, mergedIntoId: true } },
      balances: { select: { currency: true, balance: true }, orderBy: { currency: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  const survivorOf = survivorId ?? rows.find((r) => r.customer?.mergedIntoId)?.customer?.mergedIntoId ?? null;
  const target = survivorOf
    ? await findCariAccountForCardTx(prisma, { customerId: survivorOf, subcontractorId: null }, { id: true })
    : null;
  return rows.map((r) => ({
    kind: "CARI_MERGE" as const,
    cariId: r.id,
    label: r.customer ? `${r.customer.code} ${r.customer.name}` : r.id,
    targetCariId: target?.id ?? null,
    balances: r.balances.filter((b) => !b.balance.isZero()).map((b) => ({ currency: b.currency, balance: b.balance.toFixed(2) })),
  }));
}
