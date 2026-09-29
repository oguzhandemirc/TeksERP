// Advisory kilit ENVANTERİ — satıcı DB'sinin kendi uzayı (backend'in 80xx uzayından bağımsız).
// Kural: kilit tx'in İLK ifadesidir; birden çok kilit deterministik sırada alınır:
//   PORTAL_TOKEN → DEALER (kimlik sırasıyla) → CUSTOMER → TRANSFER_KEY → INSTALLATION (kimlik sırasıyla) → LICENSE_NUMBER
//   → UPLOAD_REQUEST → UPLOAD_SESSION → SHARED_FILE → DOWNLOAD_LINK.
// Envanter CLAUDE.md tablosuyla birebir; bekçi: scripts/test_satici_kapilari.ts.
import type { Tx } from "./prisma";

export const LOCK_NAMESPACES = {
  /** Kurulum başına: etkinleştirme · yoklama · taşıma · DR · yaptırım · HAK sürümü. */
  INSTALLATION: 9101,
  /** Lisans numarası sayacı (yıl başına). */
  LICENSE_NUMBER: 9102,
  /** Bayi başına: tavan değişimi · bayi imzalı HAK · bayinin kurulum adedi. */
  DEALER: 9103,
  /** Portal işlem kimliği (clientToken) başına: aynı kimlikli eşzamanlı denemeler sıraya girer. */
  PORTAL_TOKEN: 9104,
  /** Müşteri ağacı başına: tesis/kurulum doğumu ↔ müşteri/tesis/kurulum pasife-aktife alma (MV-06) · müşterinin bayi bağı. */
  CUSTOMER: 9105,
  /** Taşıma talebinin yeni anahtarı başına: kimliksiz (kurulumsuz) talebin doğumu ↔ kararı (D8). */
  TRANSFER_KEY: 9106,
  /** Yükleme isteği (/y) başına: kota rezervasyonu/iadesi ↔ oturum tamamlama/terk ↔ iptal. */
  UPLOAD_REQUEST: 9107,
  /** Yükleme oturumu başına: tamamlama ↔ terk (parça yazımı UNIQUE ile idempotent). */
  UPLOAD_SESSION: 9108,
  /** Paylaşılan dosya başına: gövde budaması ↔ paylaşım bağlantısı doğumu. */
  SHARED_FILE: 9109,
  /** İndirme bağlantısı (/d) başına: indirme sayacı ↔ iptal. */
  DOWNLOAD_LINK: 9110,
} as const;

export async function lockInstallation(tx: Tx, installationDbId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.INSTALLATION}::int4, hashtext(${installationDbId}))`;
}

/** Birden çok kurulum: kimlik sırasıyla (kilitlenme olmasın). */
export async function lockInstallations(tx: Tx, installationDbIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(installationDbIds)].sort()) {
    await lockInstallation(tx, id);
  }
}

export async function lockLicenseNumber(tx: Tx, year: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.LICENSE_NUMBER}::int4, ${year}::int4)`;
}

export async function lockDealer(tx: Tx, dealerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.DEALER}::int4, hashtext(${dealerId}))`;
}

/** Birden çok bayi (müşterinin bayisini değiştirmek: eski + yeni): kimlik sırasıyla. */
export async function lockDealers(tx: Tx, dealerIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(dealerIds)].sort()) {
    await lockDealer(tx, id);
  }
}

export async function lockTransferKey(tx: Tx, keyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.TRANSFER_KEY}::int4, hashtext(${keyId}))`;
}

export async function lockPortalToken(tx: Tx, clientToken: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.PORTAL_TOKEN}::int4, hashtext(${clientToken}))`;
}

export async function lockCustomer(tx: Tx, customerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.CUSTOMER}::int4, hashtext(${customerId}))`;
}

export async function lockUploadRequest(tx: Tx, requestId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.UPLOAD_REQUEST}::int4, hashtext(${requestId}))`;
}

export async function lockUploadSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.UPLOAD_SESSION}::int4, hashtext(${sessionId}))`;
}

export async function lockSharedFile(tx: Tx, fileId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.SHARED_FILE}::int4, hashtext(${fileId}))`;
}

export async function lockDownloadLink(tx: Tx, linkId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.DOWNLOAD_LINK}::int4, hashtext(${linkId}))`;
}

/** Yükleme oturumu kapsamı: GELEN oturumda önce isteği, sonra oturumu (UPLOAD_REQUEST → UPLOAD_SESSION). */
export async function lockUploadScope(tx: Tx, requestId: string | null, sessionIds: readonly string[]): Promise<void> {
  if (requestId) await lockUploadRequest(tx, requestId);
  for (const id of [...new Set(sessionIds)].sort()) await lockUploadSession(tx, id);
}
