// PG KÜMESİ KİMLİĞİ (G2 kayıp ↔ kopya): `pg_control_system().system_identifier` kümenin initdb'de doğan rastgele
// kimliğidir — donanım ya da kişi verisi değildir. Döküm başka makineye yüklenince değişir, LICENSE_DIR kaybında
// aynı kalır. İmzalı durum kaydına yalnız kurulum kimliğiyle karışık özeti girer (`pgOzeti`).
import { createHash } from "node:crypto";
import { bumpLicenseSnapshotVersion } from "./license-signals";
import { b64uEncode } from "./protocol";

let clusterId: string | null = null;

export function setPgClusterId(id: string | null): void {
  const next = id && /^\d{1,20}$/.test(id.trim()) ? id.trim() : null;
  if (next === clusterId) return;
  clusterId = next;
  bumpLicenseSnapshotVersion();
}

export function getPgClusterId(): string | null {
  return clusterId;
}

/** Kurulum kimliğine bağlı özet: aynı kümede başka kurulumun kaydı eşleşmez. Küme bilinmiyorsa null. */
export function pgClusterDigest(kurulumId: string, id: string | null = clusterId): string | null {
  if (id === null) return null;
  return b64uEncode(createHash("sha256").update(`tekserp-g2-pg\u001f${kurulumId}\u001f${id}`).digest());
}

/** Test-only. */
export function __resetPgClusterForTests(): void {
  clusterId = null;
}
