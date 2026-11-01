// Birleşmiş cari (K3d) faturasının bulut kataloğu parçaları (D4-K3dk2): fatura hedef hesap altında görünür,
// açığı hedefin hareketiyle değişir — kolon çözümü, okumalar, değişiklik kaynakları ve virman vadesi geçişi.
import { col, lookup, type ChangeSource, type ColumnSpec } from "./projection-types";

const MERGED_INVOICES_OF_CARIS =
  'SELECT i."id" AS root_id FROM "invoices" i JOIN "cari_accounts" c ON c."id" = i."cariId" WHERE c."mergedIntoId" = ANY($1::uuid[])';

/** Türetilmiş `acikTutar`/`vadesiGecti`nin okuduğu tablolar (hedefin collectAgingRows kalemi dahil). */
export const MERGED_INVOICE_READS = ["invoices", "cari_accounts", "cari_transactions", "payments", "cheques", "payment_allocations"];

/** Türetilmiş alan açıklaması eki: birleşmiş hesapta kaynak hedefin yaşlandırma kalemidir. */
export const MERGED_NOTE = "; birleşmiş hesapta hedefin collectAgingRows kalemi (|netOpen|, kova — cari-hesap gecikmis ile aynı çekirdek)";

/** Virman bacağına donmuş vade (K3d) geçerken hedefin gecikmişi ve aktarılan fatura döner. */
const TRANSFER_DUE_FROM = `FROM "cari_transactions" t WHERE t."sourceType" = 'CARI_TRANSFER' AND t."dueDate" >= $1 AND t."dueDate" < $2`;
export const TRANSFER_DUE_CROSSING = {
  cari: { name: "virman-vadesi", sql: `SELECT DISTINCT t."cariId" AS root_id ${TRANSFER_DUE_FROM}` },
  invoice: { name: "virman-vadesi", sql: `SELECT DISTINCT t."invoiceId" AS root_id ${TRANSFER_DUE_FROM} AND t."invoiceId" IS NOT NULL` },
} as const;

export const MERGED_INVOICE_COLUMN: ColumnSpec = {
  ...col("cariHesapId", "cariId"),
  resolvedBy: { helper: "cloud-sync/derived-merged-invoice mergedInvoiceViews: birleşmiş hesabın faturası mergedIntoId (hedef) altında; satırın cariId'si değişmez", reads: ["cari_accounts"] },
};

export const MERGED_INVOICE_SOURCES: readonly ChangeSource[] = [
  lookup("cari_accounts", "id", 'SELECT i."id" AS root_id FROM "invoices" i WHERE i."cariId" = ANY($1::uuid[]) OR i."cariId" IN (SELECT c."id" FROM "cari_accounts" c WHERE c."mergedIntoId" = ANY($1::uuid[]))', "cari vade günü efektif vadeyi; birleşme (mergedIntoId) görünen hesabı değiştirir"),
  lookup("payments", "cariId", MERGED_INVOICES_OF_CARIS, "hedefin tahsilatı aktarılan kalemi sanal FIFO ile kapatır"),
  lookup("cheques", "cariId", MERGED_INVOICES_OF_CARIS, "hedefin çeki aktarılan kalemi sanal FIFO ile kapatır"),
  { table: "cari_transactions", watermark: "createdAt", tieBreaker: [{ column: "id", cast: "uuid" }], root: { kind: "lookup", keyColumn: "cariId", sql: MERGED_INVOICES_OF_CARIS } },
];
