// RAPOR AİLESİ → BULUT İZNİ (sözleşme §7) — güvenlik kararı BULUTTADIR: aile rapor anahtarının
// önekinden türer (fabrikanın gönderdiği "aile" alanına güvenilmez). Eşlenmeyen aile RED (fail-closed).
// Audit ailesi buluta HİÇ gitmez (ayak izi yerel yüzeydir); kişi adı taşıyan rapor v1 dışıdır
// (B1 varsayılanı: "rapor projeksiyonlarında kişi adı yok").
import type { CloudPermission } from "./permissions";

export const REPORT_FAMILY_PERMISSION: Readonly<Record<string, CloudPermission>> = {
  sales: "bulut:siparis:oku",
  customer: "bulut:siparis:oku",
  inventory: "bulut:stok:oku",
  production: "bulut:uretim:oku",
  quality: "bulut:uretim:oku",
  dokuma: "bulut:uretim:oku",
  subcontract: "bulut:uretim:oku",
  finance: "bulut:cari-bakiye:oku",
};

/** Buluttan İSTENEMEYEN raporlar (aile ya da tam anahtar). */
export const REPORTS_NOT_IN_CLOUD: readonly string[] = ["audit/*", "production/operator-performance"];

const KEY_PATTERN = /^([a-z][a-z0-9-]{0,39})\/[a-z0-9][a-z0-9-]{0,79}$/;

export type ReportVerdict =
  | { readonly ok: true; readonly family: string; readonly permission: CloudPermission; readonly projection: string }
  | { readonly ok: false; readonly reason: "BICIM" | "BULUTTA_YOK" | "AILE_BILINMIYOR" };

export function reportVerdict(key: string): ReportVerdict {
  const m = KEY_PATTERN.exec(key);
  if (!m) return { ok: false, reason: "BICIM" };
  const family = m[1]!;
  if (REPORTS_NOT_IN_CLOUD.includes(key) || REPORTS_NOT_IN_CLOUD.includes(`${family}/*`)) return { ok: false, reason: "BULUTTA_YOK" };
  const permission = REPORT_FAMILY_PERMISSION[family];
  if (!permission) return { ok: false, reason: "AILE_BILINMIYOR" };
  return { ok: true, family, permission, projection: `rapor.${family}` };
}

/** Hesabın okuyabileceği rapor sonucu projeksiyonları (`rapor.<aile>`) — `bulut:rapor:oku` şart. */
export function readableReportProjections(permissions: ReadonlySet<CloudPermission>): string[] {
  if (!permissions.has("bulut:rapor:oku")) return [];
  return Object.entries(REPORT_FAMILY_PERMISSION)
    .filter(([, p]) => permissions.has(p))
    .map(([family]) => `rapor.${family}`);
}

export function allReportProjections(): string[] {
  return Object.keys(REPORT_FAMILY_PERMISSION).map((f) => `rapor.${f}`);
}
