// Rapor Merkezi çizim kümesi — SAF. Kendi süzgeci YOKTUR: dört kapı da mevcut tek kaynaklardan
// okunur (yüzey `isReportSurfaced` · izin · modül `isRouteModuleOpen` = route kapısının aynısı ·
// rapor kapısı `ctx.isReportOpen`). Karo, route ve palet aynı yüklemi okusun diye tek fonksiyon.
import { REPORT_CATALOG, type ReportCatalogEntry, type ReportKategoriV2 } from "@/lib/report-catalog";
import { isReportSurfaced } from "@/lib/report-gate";
import { isRouteModuleOpen } from "@/lib/route-modules";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

/** Levent raporu modülden ayrıca devere ister (v1 levent karolarıyla aynı beyan; uç `requireDevereEnabled`). */
const DEVERE_REQUIRED: ReadonlySet<string> = new Set(["dokuma/levent-dengesi"]);

export interface CenterAccess {
  isAdmin: boolean;
  hasPermission: (code: string) => boolean;
  ctx: OperationsVisibilityContext;
}

/** Kişiden bağımsız kısım (yüzey · modül · rapor kapısı) — palet bunu okur, izni girişin `permission`ı taşır. */
export function isCenterEntryOpen(entry: ReportCatalogEntry, ctx: OperationsVisibilityContext): boolean {
  if (!isReportSurfaced(entry)) return false;
  if (!isRouteModuleOpen(`/${entry.panelYolu}`, ctx)) return false;
  if (DEVERE_REQUIRED.has(entry.key) && !ctx.devereEnabled) return false;
  return ctx.isReportOpen(entry.key);
}

/** Bu satır Merkez'de çizilir mi, adresi açılır mı — TEK yüklem (izin + `isCenterEntryOpen`). */
export function isCenterEntryVisible(entry: ReportCatalogEntry, a: CenterAccess): boolean {
  return (a.isAdmin || a.hasPermission(entry.izin)) && isCenterEntryOpen(entry, a.ctx);
}

/** Merkez'in kategori sırası ve görünen adları (plan §4.2). */
export const CENTER_CATEGORIES: ReadonlyArray<{ key: ReportKategoriV2; title: string }> = [
  { key: "satis-sevkiyat", title: "Satış ve sevkiyat" },
  { key: "uretim", title: "Üretim" },
  { key: "kalite", title: "Kalite" },
  { key: "dokuma", title: "Dokuma" },
  { key: "para", title: "Para" },
  { key: "muhasebe-araclari", title: "Muhasebe araçları" },
];

export interface CenterGroup {
  key: ReportKategoriV2;
  title: string;
  entries: ReportCatalogEntry[];
}

/** Görünür satırlar kategoriye göre; boş kategori çizilmez. Yalnız `kategoriV2` taşıyan satırlar. */
export function centerGroups(a: CenterAccess, catalog: readonly ReportCatalogEntry[] = REPORT_CATALOG): CenterGroup[] {
  const visible = catalog.filter((e) => e.kategoriV2 !== null && isCenterEntryVisible(e, a));
  return CENTER_CATEGORIES.map((c) => ({ ...c, entries: visible.filter((e) => e.kategoriV2 === c.key) })).filter((g) => g.entries.length > 0);
}

/** İstemci araması (katalog küçük): başlık + soru, Türkçe katlamalı. */
export function filterGroups(groups: CenterGroup[], term: string, includes: (hay: string, needle: string) => boolean): CenterGroup[] {
  if (!term.trim()) return groups;
  return groups
    .map((g) => ({ ...g, entries: g.entries.filter((e) => includes(`${e.baslik} ${e.soru}`, term)) }))
    .filter((g) => g.entries.length > 0);
}
