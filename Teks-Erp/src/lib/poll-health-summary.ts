// Lisans yoklamasının SAĞLIK ÖZETİ — ALLOWLIST (protokol `HealthSummarySchema`). Yalnız sayılar
// ve kapalı kümeler: ham hata metni, dosya adı, kullanıcı adı, iş verisi GİRMEZ. İstemci
// dağılımı yalnız tür × sürüm SAYISIDIR (kurulum kimliği/kullanıcı yok); iş hataları bellek
// sayacından (audit OKUNMAZ). Bekçi: `test_lisans_yoklama_allowlist`.
import prisma from "./prisma";
import { APP_VERSION } from "./app-version";
import { readAppDiskMetrics } from "./disk-metrics";
import { getPoolHealth } from "./pool-health";
import { listClients } from "./client-registry";
import { getJobFailureCounts } from "../jobs/job-failure";
import { AuditService } from "../services/audit.service";
import { getOffsiteHealth } from "../services/helpers/offsite-backup.helper";
import { backupHealth } from "./health-snapshot";
import { HealthSummarySchema, VersionTextSchema, type HealthSummary } from "./license/protocol";

// GİRMEZ. İstemci dağılımı yalnız tür × sürüm SAYISIDIR (kurulum kimliği/kullanıcı yok).

/** Sürüm tanınmıyorsa "0.0.0" = bilinmiyor (uydurma değil, sayım dışı kalmasın diye işaret). */
const UNKNOWN_VERSION = "0.0.0";
const HEALTH_LIST_MAX = 50;

function versionOrUnknown(v: string | null): string {
  return v !== null && VersionTextSchema.safeParse(v).success ? v : UNKNOWN_VERSION;
}

const CLIENT_KIND_TO_SUMMARY = { electron: "panel", mobil: "tablet", web: "web" } as const;

/** Bağlı istemci defteri → tür × sürüm sayısı (en kalabalık önce, tavanlı). */
export function clientDistribution(): HealthSummary["istemciler"] {
  const counts = new Map<string, { tur: HealthSummary["istemciler"][number]["tur"]; surum: string; adet: number }>();
  for (const c of listClients()) {
    const kind = c.kind ? CLIENT_KIND_TO_SUMMARY[c.kind] : "diger";
    const version = versionOrUnknown(c.version);
    const key = `${kind}\u001f${version}`;
    const row = counts.get(key) ?? { tur: kind, surum: version, adet: 0 };
    row.adet++;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.adet - a.adet).slice(0, HEALTH_LIST_MAX);
}

/** İş hatası sayaçları (bellek) — iş adı kısa koda indirgenir; audit OKUNMAZ. */
export function jobFailureDistribution(): HealthSummary["isHatalari"] {
  const out: HealthSummary["isHatalari"] = [];
  for (const [job, count] of getJobFailureCounts()) {
    const code = job.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 40);
    if (code.length > 0) out.push({ is: code, adet: count });
  }
  return out.sort((a, b) => b.adet - a.adet).slice(0, HEALTH_LIST_MAX);
}

/** Lisans yoklamasının `saglik` gövdesi — şemadan geçmeyen alan kod yolunda patlar. */
export async function buildPollHealthSummary(): Promise<HealthSummary> {
  let dbSize: number | null = null;
  try {
    const rows = await prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`;
    dbSize = rows[0] ? Number(rows[0].size) : null;
  } catch {
    dbSize = null;
  }
  const backup = backupHealth();
  const offsite = (await getOffsiteHealth()).offsite as { configured?: unknown; ok?: unknown; missingCount?: unknown } | undefined;
  const disk = readAppDiskMetrics();
  return HealthSummarySchema.parse({
    surum: versionOrUnknown(APP_VERSION),
    calismaSn: Math.floor(process.uptime()),
    dbBoyutBayt: dbSize,
    yedek: { hukum: backup.verdict, yasSaat: backup.ageHours },
    offsite: {
      yapilandirildi: offsite?.configured === true,
      ok: typeof offsite?.ok === "boolean" ? offsite.ok : null,
      eksikSayisi: typeof offsite?.missingCount === "number" ? offsite.missingCount : null,
    },
    diskDolulukYuzde: disk.diskUsedPct === null ? null : Math.min(100, Math.max(0, disk.diskUsedPct)),
    auditYazmaHatasi: AuditService.getHealth().failureCount,
    havuzZamanAsimi: getPoolHealth().poolAcquireTimeouts,
    istemciler: clientDistribution(),
    isHatalari: jobFailureDistribution(),
  });
}
