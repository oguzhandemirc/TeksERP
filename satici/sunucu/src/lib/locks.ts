// Advisory kilit ENVANTERİ — satıcı DB'sinin kendi uzayı (backend'in 80xx uzayından bağımsız).
// Kural: kilit tx'in İLK ifadesidir; birden çok kilit deterministik sırada alınır:
//   PORTAL_TOKEN → DEALER → CUSTOMER → INSTALLATION (kimlik sırasıyla) → LICENSE_NUMBER.
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
  /** Müşteri ağacı başına: tesis/kurulum doğumu ↔ müşteri/tesis/kurulum pasife-aktife alma (MV-06). */
  CUSTOMER: 9105,
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

export async function lockPortalToken(tx: Tx, clientToken: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.PORTAL_TOKEN}::int4, hashtext(${clientToken}))`;
}

export async function lockCustomer(tx: Tx, customerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES.CUSTOMER}::int4, hashtext(${customerId}))`;
}
