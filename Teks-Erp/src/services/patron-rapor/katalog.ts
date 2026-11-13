// =============================================================================
// Patron raporu (ERP kipi, V5a) — istenebilir rapor kümesi + kapılar
// =============================================================================
// Küme = bulut uzaktan hesap listesi (`REMOTE_REPORTS`) ∩ katalogun YENİ nesli (v2): koşucu, şema ve modül kapısı
// orada tek kaynaktır, burada yeniden yazılmaz. `CLOUD_HELD_REPORT_KEYS` UYGULANMAZ: bekletme bulutun saatlik
// planının maliyeti içindi (arşiv 2026-11 D1), ERP kipinde hesap yalnız istek üzerine ve veri fabrikadan çıkmaz.
// =============================================================================
import { REPORT_BY_KEY, isReportSurfaced, type ReportCatalogEntry } from "../../constants/report-catalog";
import { REMOTE_REPORTS, remoteReportAvailability, type RemoteReport } from "../../cloud-sync/report-requests";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { AppError } from "../../utils/app-error";

export interface PatronReport {
  readonly remote: RemoteReport;
  readonly entry: ReportCatalogEntry;
  /** Panel ucunun istediği ERP izinlerinin HEPSİ (katalog `izin` + uçtaki ek guard). */
  readonly erpPermissions: readonly string[];
}

/** Panel ucunda katalog izninin YANINDA istenen guard'lar (`routes/reports/maliyet.report.routes.ts` `/karlilik`). */
const EXTRA_ROUTE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  "maliyet/karlilik": ["report:finance"],
};

/** Açılışta kurulur; sıra = `REMOTE_REPORTS` sırası. Kişi adlı v2 rapor (`production/uretim-akisi`) listede yok (K-KISI). */
export const PATRON_REPORTS: ReadonlyMap<string, PatronReport> = new Map(
  REMOTE_REPORTS.flatMap((remote) => {
    const entry = REPORT_BY_KEY.get(remote.key);
    if (!entry || entry.nesil !== "v2") return [];
    return [[remote.key, { remote, entry, erpPermissions: [entry.izin, ...(EXTRA_ROUTE_PERMISSIONS[remote.key] ?? [])] }] as const];
  }),
);

export const hasReportPermission = (perms: readonly string[], r: PatronReport): boolean =>
  r.erpPermissions.every((p) => matchesPermission(perms, p));

/** Kullanıcının izniyle OKUYABİLECEĞİ rapor anahtarları (geçmiş listesi süzgeci; modül kapısı burada aranmaz). */
export function readableReportKeys(perms: readonly string[]): string[] {
  return [...PATRON_REPORTS.values()].filter((r) => hasReportPermission(perms, r)).map((r) => r.remote.key);
}

/** Tanınmayan anahtar 404 (fail-closed) — izinli listede olmayan rapor istenemez. */
export function patronReportOf(key: string): PatronReport {
  const r = PATRON_REPORTS.get(key);
  if (!r) throw AppError.notFound("Bu rapor patron uygulamasından istenemez.", { code: "RAPOR_BILINMIYOR", rapor: key.slice(0, 80) });
  return r;
}

export function assertReportPermission(perms: readonly string[], r: PatronReport): void {
  if (!hasReportPermission(perms, r)) {
    throw AppError.forbidden(`"${r.entry.baslik}" raporu için yetkiniz yok.`, { code: "RAPOR_IZNI_YOK", rapor: r.remote.key, gerekli: r.erpPermissions });
  }
}

/** Modül + rapor görünürlüğü (bulutla AYNI okuyucu, yüzey yüklemi `isReportSurfaced`). */
export async function reportOpen(r: PatronReport): Promise<"ACIK" | "RAPOR_KAPALI" | "MODUL_KAPALI"> {
  return remoteReportAvailability(r.remote, isReportSurfaced);
}

export async function assertReportOpen(r: PatronReport): Promise<void> {
  const state = await reportOpen(r);
  if (state === "MODUL_KAPALI") throw AppError.forbidden(`"${r.entry.baslik}" raporunun modülü bu kurulumda kapalı.`, { code: "MODULE_DISABLED", rapor: r.remote.key });
  if (state === "RAPOR_KAPALI") throw AppError.forbidden(`"${r.entry.baslik}" raporu bu kurulumda kapalı.`, { code: "REPORT_DISABLED", rapor: r.remote.key });
}
