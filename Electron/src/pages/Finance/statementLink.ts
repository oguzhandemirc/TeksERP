// =============================================================================
// EKSTRE SATIRI → BELGE (tıkla-git, saf katman)
// =============================================================================
// Bekçi: `statementLink.test.ts`.
//
// Muhasebecinin ekstredeki en sık sorusu "bu satır hangi fatura?" idi ve cevabı
// yoktu: `docNo` düz metin basılıyordu, belgeye gitmek için Faturalar ekranına
// gidip elle aramak gerekiyordu. Backend 2026-08-15'ten beri satırda `invoiceId`
// / `paymentId` de taşıyor.
//
// ⚠️ İKİ ALAN AYRI, tek bir `documentId` DEĞİL: hedef diyalog türe göre farklı
// (fatura → detay diyaloğu · tahsilat → donmuş MAKBUZ). `sourceType`ten yeniden
// çıkarmak gerekseydi devir/storno satırları da aynı torbaya düşerdi.
//
// ⚠️ ESKİ BACKEND'DE ALANLAR HİÇ GELMEZ → satır TIKLANABİLİR OLMAZ. Tıklanır
// görünüp hiçbir şey yapmayan satır, olmayan bir yolu vaat eder.
// =============================================================================

export type StatementTarget =
  | { kind: "INVOICE"; id: string }
  | { kind: "PAYMENT"; id: string; docNo: string };

/** Satırın açacağı belge — yoksa `null` (satır düz metin kalır). */
export function statementTargetOf(row: {
  invoiceId?: string | null;
  paymentId?: string | null;
  docNo?: string | null;
}): StatementTarget | null {
  if (row.invoiceId) return { kind: "INVOICE", id: row.invoiceId };
  // Makbuz diyaloğu başlığında belge numarasını basar; numarasız satır için
  // "Makbuz — undefined" yerine tire.
  if (row.paymentId) return { kind: "PAYMENT", id: row.paymentId, docNo: row.docNo ?? "—" };
  return null;
}
