// Advisory kilit ENVANTERİ — satıcı DB'sinin kendi uzayı (backend'in 80xx uzayından bağımsız).
// Kural: kilit tx'in İLK ifadesidir; birden çok kilit deterministik sırada alınır.
// Envanter CLAUDE.md tablosuyla birebir; bekçi: scripts/test_satici_kapilari.ts.
import type { Tx } from "./prisma";

export const LOCK_NAMESPACES = {
  /** Kurulum başına: etkinleştirme · yoklama · taşıma · DR · yaptırım · HAK sürümü. */
  INSTALLATION: 9101,
  /** Lisans numarası sayacı (yıl başına). */
  LICENSE_NUMBER: 9102,
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
