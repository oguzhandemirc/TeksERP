// Geçiş yüzeyi (R0-GECIS) — SAF. Eski (v1) rapor nereye gitti, bu kişiye gösterilebilir mi:
// band, Merkez'in "Eski raporlar" bölümü, taşınan araç karoları ve palet AYNI yüklemleri okur.
// Bayrak kapalıyken hiçbiri bir şey döndürmez (panel bayt-eşit kalır).
import type { LucideIcon } from "lucide-react";
import { CalendarClock, ClipboardList, FileSearch, Footprints, ScrollText, UserRoundSearch, Waypoints } from "lucide-react";
import { REPORT_BY_KEY, REPORT_CATALOG, type ReportCatalogEntryV1 } from "@/lib/report-catalog";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { reportKeyOfPath } from "@/lib/report-gate";
import { SYSTEM_ACTIVITY_ACCESS } from "@/lib/permissions";
import { isCenterEntryVisible, type CenterAccess } from "./center-model";

export type LegacyAccess = CenterAccess;

/**
 * Rapor menüsünden çıkan araçların YENİ girişi. Yer (`host`) katalogdaki `yeniHali.panelYolu`ndan
 * okunur (test eşitliği ölçer); burada yalnız yerin adı, izni ve aracın kendi adresi durur.
 * Uç ve izin DEĞİŞMEZ: `to` aracın bugünkü adresi, `permission` o adresin route izni.
 */
export interface RelocatedTool {
  reportKey: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Aracın açıldığı adres (eski adres; Cari Ekstre diyaloğu olduğu için cari ekranı). */
  to: string;
  /** `to` adresinin route izni (rapor izni; ekstrede cari ekranının izni). */
  permission: string;
  hostLabel: string;
  hostPermission?: string;
  hostPermissionAny?: readonly string[];
}

type RelocatedToolSpec = Omit<RelocatedTool, "reportKey"> & { reportKey?: string };

// Anahtar rapor adresinden türer (`reportKeyOfPath`): adresi olan araçta ikinci yazım yok.
const RELOCATED_TOOL_SPECS: readonly RelocatedToolSpec[] = [
  { title: "İz Sürme · Parti", description: "Bir parti hangi adımlardan geçti, şu an nerede", icon: Waypoints,
    to: "/reports/production/batch-trace", permission: "report:production", hostLabel: "Operasyon" },
  { title: "İz Sürme · Top", description: "Bir topun refakat kartı hangi istasyonlarda okutuldu", icon: Footprints,
    to: "/reports/production/traveler-trace", permission: "report:production", hostLabel: "Operasyon" },
  { title: "Karne Listesi ve Mühür", description: "Vardiya karneleri, mühürleme ve mühür açma", icon: ClipboardList,
    to: "/reports/dokuma/karne", permission: "report:production", hostLabel: "Tezgah Salonu", hostPermission: "loom:live-view" },
  { title: "Levent Bitiş Tahmini", description: "Tezgahtaki leventler ne zaman biter", icon: CalendarClock,
    to: "/reports/dokuma/levent-bitis-tahmini", permission: "report:production", hostLabel: "Leventler", hostPermission: "warpbeam:read" },
  // Cari Ekstre diyalogdur, kendi adresi yok: anahtar elle.
  { reportKey: "finance/statement", title: "Cari Ekstre", description: "Cari satırındaki Ekstre düğmesi: dönem hareketleri ve bakiye", icon: ScrollText,
    to: "/finance/cari", permission: "finance:read", hostLabel: "Cari Hesaplar", hostPermission: "finance:read" },
  { title: "Denetim Kaydı Özeti", description: "Hangi kayıtlara kim, ne sıklıkla dokundu", icon: FileSearch,
    to: "/reports/audit/system-log-summary", permission: "report:audit", hostLabel: "Sistem Kayıtları", hostPermissionAny: SYSTEM_ACTIVITY_ACCESS },
  { title: "Kullanıcı Aktivitesi Raporu", description: "Kullanıcı başına işlem sayıları ve son etkinlik", icon: UserRoundSearch,
    to: "/reports/audit/user-activity", permission: "report:audit", hostLabel: "Etkinlik", hostPermissionAny: SYSTEM_ACTIVITY_ACCESS },
];

export const RELOCATED_TOOLS: readonly RelocatedTool[] = RELOCATED_TOOL_SPECS.map((t) => ({
  ...t,
  reportKey: t.reportKey ?? reportKeyOfPath(t.to) ?? "",
}));

/** Taşınan aracın yeni yeri (katalogdan); satır `tasindi` değilse `null`. */
export function relocatedHostOf(reportKey: string): string | null {
  const e = REPORT_BY_KEY.get(reportKey);
  return e?.nesil === "v1" && e.yeniHali.tur === "tasindi" ? `/${e.yeniHali.panelYolu}` : null;
}

function hasHostAccess(tool: RelocatedTool, a: LegacyAccess): boolean {
  if (a.isAdmin) return true;
  if (tool.hostPermission) return a.hasPermission(tool.hostPermission);
  if (tool.hostPermissionAny) return tool.hostPermissionAny.some((p) => a.hasPermission(p));
  return true;
}

/** Yeni yer bu kişiye açılır mı (izin + modül) — bağlantı yalnız açılan yere verilir. */
export function isHostReachable(tool: RelocatedTool, a: LegacyAccess): boolean {
  const host = relocatedHostOf(tool.reportKey);
  return host !== null && hasHostAccess(tool, a) && isRouteModuleOpen(host, a.ctx);
}

/** Taşınan araç yeni yerinde çizilir mi: bayrak + rapor görünür (izin · modül · kapı) + aracın adresi açılır. */
export function isRelocatedToolOpen(tool: RelocatedTool, a: LegacyAccess): boolean {
  if (a.ctx.reportsV2Enabled !== true) return false;
  const entry = REPORT_BY_KEY.get(tool.reportKey);
  if (!entry || !isCenterEntryVisible(entry, a)) return false;
  return tool.to === "/finance/cari" ? isHostReachable(tool, a) : true;
}

export function relocatedToolsAt(host: string, a: LegacyAccess): RelocatedTool[] {
  return RELOCATED_TOOLS.filter((t) => relocatedHostOf(t.reportKey) === host && isRelocatedToolOpen(t, a));
}

export type LegacyBannerModel =
  | { kind: "merged"; targetTitle: string; to: string }
  | { kind: "moved"; place: string; hostLabel: string; to: string };

/** Eski rapor sayfasının üst bandı — `null` ⇒ band çizilmez (bayrak kapalı · uzman · hedef açılmıyor). */
export function legacyBannerModel(reportKey: string | undefined, a: LegacyAccess): LegacyBannerModel | null {
  if (a.ctx.reportsV2Enabled !== true || !reportKey) return null;
  const entry = REPORT_BY_KEY.get(reportKey);
  if (!entry || entry.nesil !== "v1") return null;
  const next = entry.yeniHali;
  if (next.tur === "birlesti") {
    const target = REPORT_BY_KEY.get(next.anahtar);
    // Ölü bağlantı yok: hedef yüzeye çıkmadıysa (`hazir:false`), izinsizse ya da kapalıysa band yok.
    if (!target || !isCenterEntryVisible(target, a)) return null;
    return { kind: "merged", targetTitle: target.baslik, to: `/${target.panelYolu}` };
  }
  if (next.tur === "tasindi") {
    const tool = RELOCATED_TOOLS.find((t) => t.reportKey === reportKey);
    if (!tool || !isHostReachable(tool, a)) return null;
    return { kind: "moved", place: next.aciklama, hostLabel: tool.hostLabel, to: `/${next.panelYolu}` };
  }
  return null; // uzman: muhasebe aracı olarak kalır, yeni hâli yok
}

export interface LegacyCard {
  entry: ReportCatalogEntryV1;
  /** Kartın açtığı adres; açılamıyorsa kart çizilmez. */
  to: string;
  banner: LegacyBannerModel | null;
  expert: boolean;
}

export interface LegacyGroup {
  key: string;
  title: string;
  cards: LegacyCard[];
}

function legacyCardOf(entry: ReportCatalogEntryV1, a: LegacyAccess): LegacyCard | null {
  if (!isCenterEntryVisible(entry, a)) return null;
  let to = entry.panelYolu ? `/${entry.panelYolu}` : null;
  if (to === null) {
    // Diyalog raporu (Cari Ekstre): kendi adresi yok, aracın bugünkü evine gider.
    const tool = RELOCATED_TOOLS.find((t) => t.reportKey === entry.key);
    to = tool && isHostReachable(tool, a) ? tool.to : null;
  }
  if (to === null) return null;
  return { entry, to, banner: legacyBannerModel(entry.key, a), expert: entry.yeniHali.tur === "uzman" };
}

/**
 * "Eski raporlar" bölümü — eski hub'ın kategori sırası/adıyla (`categories` = eski hub'ın AYNI
 * süzgeçten geçmiş karoları), içinde v1 satırları. Arama başlık + soru üzerinde.
 */
export function legacyGroups(
  categories: ReadonlyArray<{ key: string; title: string }>,
  a: LegacyAccess,
  search: { term: string; includes: (hay: string, needle: string) => boolean } = { term: "", includes: (h, n) => h.includes(n) },
): LegacyGroup[] {
  if (a.ctx.reportsV2Enabled !== true) return [];
  const q = search.term.trim();
  const { includes } = search;
  return categories
    .map((c) => ({
      key: c.key,
      title: c.title,
      cards: REPORT_CATALOG
        .filter((e): e is ReportCatalogEntryV1 => e.nesil === "v1" && e.key.startsWith(`${c.key}/`))
        .filter((e) => !q || includes(`${e.baslik} ${e.soru}`, q))
        .map((e) => legacyCardOf(e, a))
        .filter((x): x is LegacyCard => x !== null),
    }))
    .filter((g) => g.cards.length > 0);
}
