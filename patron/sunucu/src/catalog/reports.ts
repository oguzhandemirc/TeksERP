// RAPOR ANAHTARI → BULUT İZNİ (sözleşme §7) — güvenlik kararı BULUTTADIR ve RAPOR BAŞINADIR: aile düzeyi
// izin aynı ailedeki dar izinli raporu (sevkiyat karnesi, çek vadesi) geniş izne açıyordu. Eşlenmeyen anahtar
// RED (fail-closed). Küme fabrikanın `REMOTE_REPORTS` listesiyle birebir (bekçi `test_bulut_tel_aynasi` §8).
// Audit ailesi buluta HİÇ gitmez; kişi adı taşıyan rapor v1 dışıdır.
import { isCloudPermission, type CloudPermission } from "./permissions";

export const REPORT_KEY_PERMISSION: Readonly<Record<string, CloudPermission>> = {
  "sales/order-intake": "bulut:siparis:oku",
  "sales/shipment-scorecard": "bulut:sevkiyat:oku",
  "customer/scorecard": "bulut:siparis:oku",
  "quality/scorecard": "bulut:uretim:oku",
  "subcontract/scorecard": "bulut:uretim:oku",
  "inventory/scorecard": "bulut:stok:oku",
  "finance/aging": "bulut:cari-bakiye:oku",
  "finance/cheque-due": "bulut:cek:oku",
};

/** Buluttan İSTENEMEYEN raporlar (aile ya da tam anahtar). */
export const REPORTS_NOT_IN_CLOUD: readonly string[] = ["audit/*", "production/operator-performance"];

const KEY_PATTERN = /^([a-z][a-z0-9-]{0,39})\/([a-z0-9][a-z0-9-]{0,79})$/;
const REPORT_READ: CloudPermission = "bulut:rapor:oku";

/** Rapor sonucunun RLS adı — rapor BAŞINA (`rapor.<aile>-<ad>`); tekilliği bekçi ölçer. */
export function reportProjectionName(key: string): string {
  return `rapor.${key.replace("/", "-")}`;
}

export type ReportVerdict =
  | { readonly ok: true; readonly family: string; readonly permission: CloudPermission; readonly projection: string }
  | { readonly ok: false; readonly reason: "BICIM" | "BULUTTA_YOK" | "RAPOR_BILINMIYOR" };

export function reportVerdict(key: string): ReportVerdict {
  const m = KEY_PATTERN.exec(key);
  if (!m) return { ok: false, reason: "BICIM" };
  const family = m[1]!;
  if (REPORTS_NOT_IN_CLOUD.includes(key) || REPORTS_NOT_IN_CLOUD.includes(`${family}/*`)) return { ok: false, reason: "BULUTTA_YOK" };
  const permission = Object.hasOwn(REPORT_KEY_PERMISSION, key) ? REPORT_KEY_PERMISSION[key] : undefined;
  if (!permission) return { ok: false, reason: "RAPOR_BILINMIYOR" };
  return { ok: true, family, permission, projection: reportProjectionName(key) };
}

/**
 * Raporu okumak için gereken izinler: `bulut:rapor:oku` + bulutun anahtar izni + (varsa) fabrikanın kataloğunda
 * beyan ettiği izin — ikisi ayrışırsa DAR olan (ikisi birden) uygulanır; tanınmayan beyan RED (`null`).
 */
export function requiredReportPermissions(permission: CloudPermission, factoryDeclared: unknown): CloudPermission[] | null {
  const out = new Set<CloudPermission>([REPORT_READ, permission]);
  if (factoryDeclared !== undefined && factoryDeclared !== null) {
    if (typeof factoryDeclared !== "string" || !isCloudPermission(factoryDeclared)) return null;
    out.add(factoryDeclared);
  }
  return [...out];
}

/** Rapor ailesine göre gruplu anahtarlar (geçiş adı `rapor.<aile>` için). */
function familyKeys(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const key of Object.keys(REPORT_KEY_PERMISSION)) {
    const family = key.split("/")[0]!;
    out.set(family, [...(out.get(family) ?? []), key]);
  }
  return out;
}

/**
 * Hesabın okuyabileceği rapor sonucu projeksiyonları — `bulut:rapor:oku` şart. Rapor başına ad + GEÇİŞ: eski
 * aile adlı sonuç satırı (`rapor.<aile>`) yalnız ailenin BÜTÜN raporlarını okuyabilen hesaba açıktır (sızıntı yok);
 * eski satırlar `RAPOR_SONUC_SAKLAMA_GUN` sonunda budanınca bu kol işlevsizleşir.
 */
export function readableReportProjections(permissions: ReadonlySet<CloudPermission>): string[] {
  if (!permissions.has(REPORT_READ)) return [];
  const perKey = Object.entries(REPORT_KEY_PERMISSION)
    .filter(([, p]) => permissions.has(p))
    .map(([key]) => reportProjectionName(key));
  const legacy = [...familyKeys()]
    .filter(([, keys]) => keys.every((k) => permissions.has(REPORT_KEY_PERMISSION[k]!)))
    .map(([family]) => `rapor.${family}`);
  return [...perKey, ...legacy];
}

/** Bütün rapor sonucu adları (rapor başına + geçiş aile adları) — bakım budaması bunların hepsini görmeli. */
export function allReportProjections(): string[] {
  return [...Object.keys(REPORT_KEY_PERMISSION).map(reportProjectionName), ...[...familyKeys().keys()].map((f) => `rapor.${f}`)];
}
