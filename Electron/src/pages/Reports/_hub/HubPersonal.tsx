// Rapor Merkezi kişisel kutuları — son açtıklarım, özel raporlarım, favoriler + sık açtıklarım.
// Kaynak yalnız kişinin kendi tercih blob'u (favori, açılış kaydı) ve özel rapor listesi; uydurma puan/sayı yok.
// Görünmeyen (kapanan, izni alınan) rapor `visible` haritasında olmadığı için çizilmez.
import { FileBarChart } from "lucide-react";
import { ActivityList, type ActivityItem } from "@/components/insight/ActivityList";
import { ReportCard } from "@/components/insight/ReportCard";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import type { ReportCatalogEntry, ReportKategoriV2 } from "@/lib/report-catalog";
import { hareketZamani } from "@/pages/Dashboard/pano/pano-bicim";
import type { ReportOpenRecord } from "@/types/preferences";
import { useCustomReportList, type DefinitionSummary } from "../_v2/custom/custom-api";
import { sortByCount, sortByRecent } from "../_v2/opened";
import { CATEGORY_LOOK } from "./hub-meta";

export interface VisibleEntry {
  entry: ReportCatalogEntry;
  category: ReportKategoriV2;
  categoryTitle: string;
}

export type VisibleMap = ReadonlyMap<string, VisibleEntry>;

const RECENT_LIMIT = 7;
const FREQUENT_LIMIT = 3;
const SAVED_LIMIT = 6;

export function RecentBox({ opened, visible }: { opened: readonly ReportOpenRecord[]; visible: VisibleMap }) {
  const items: ActivityItem[] = sortByRecent(opened)
    .flatMap((r) => {
      const v = visible.get(r.key);
      if (!v) return [];
      const look = CATEGORY_LOOK[v.category];
      return [{ key: r.key, icon: look.icon, tone: look.tone, title: v.entry.baslik, subtitle: v.categoryTitle, meta: hareketZamani(r.lastAt), to: `/${v.entry.panelYolu}` }];
    })
    .slice(0, RECENT_LIMIT);
  return (
    <SectionCard title="Son açtıklarım">
      <ActivityList items={items} label="Son açtıklarım" emptyText="Açtığınız raporlar burada sırayla listelenir." />
    </SectionCard>
  );
}

const VISIBILITY_TEXT: Record<DefinitionSummary["gorunurluk"], string> = { OZEL: "Yalnız ben", PAYLASIMLI: "Paylaşıldı", HERKES: "Herkese açık" };

/** "Zamanlanmış raporlar" karşılığı: zamanlama özelliği yok → kişinin kayıtlı özel raporları (kendi + paylaşılan). */
export function SavedReportsBox({ onShowAll }: { onShowAll: () => void }) {
  const mine = useCustomReportList("benim", true);
  const shared = useCustomReportList("paylasilan", true);
  const all = [...(mine.data?.items ?? []), ...(shared.data?.items ?? [])];
  const items: ActivityItem[] = all.slice(0, SAVED_LIMIT).map((d) => ({
    key: d.id,
    icon: FileBarChart,
    tone: "sky",
    title: d.ad,
    subtitle: d.kategori.ad,
    meta: <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{mine.data?.items.includes(d) ? VISIBILITY_TEXT[d.gorunurluk] : "Paylaşılan"}</span>,
    to: `/reports/ozel/${d.id}`,
  }));
  const loading = mine.isLoading || shared.isLoading;
  const failed = mine.isError || shared.isError;
  return (
    <SectionCard
      title="Kayıtlı raporlarım"
      action={all.length > 0 ? <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onShowAll}>Tümü ({all.length})</Button> : undefined}
    >
      {loading ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Yükleniyor…</p>
      ) : failed ? (
        <p className="py-6 text-center text-xs text-destructive">Özel raporlar okunamadı.</p>
      ) : (
        <ActivityList items={items} label="Kayıtlı raporlarım" emptyText="Kurduğunuz ya da sizinle paylaşılan özel raporlar burada görünür." />
      )}
    </SectionCard>
  );
}

interface FavoritesProps {
  favorites: readonly string[];
  opened: readonly ReportOpenRecord[];
  visible: VisibleMap;
  onToggleFavorite: (key: string) => void;
}

/** "Popüler raporlar" karşılığı: favorilerim, ardından en sık açtıklarım (favori olmayanlar). Puan yok; yıldız = favori. */
export function FavoritesColumn({ favorites, opened, visible, onToggleFavorite }: FavoritesProps) {
  const counts = new Map(opened.map((r) => [r.key, r.count]));
  const favs = favorites.flatMap((k) => visible.get(k) ?? []);
  const frequent = sortByCount(opened)
    .filter((r) => !favorites.includes(r.key))
    .flatMap((r) => visible.get(r.key) ?? [])
    .slice(0, FREQUENT_LIMIT);
  const card = (v: VisibleEntry, fav: boolean) => {
    const look = CATEGORY_LOOK[v.category];
    const n = counts.get(v.entry.key);
    return (
      <li key={v.entry.key}>
        <ReportCard to={`/${v.entry.panelYolu}`} title={v.entry.baslik} description={v.entry.soru} icon={look.icon} tone={look.tone}
          meta={n ? `${v.categoryTitle} · ${n} kez açtınız` : v.categoryTitle}
          favorite={{ active: fav, onToggle: () => onToggleFavorite(v.entry.key) }} />
      </li>
    );
  };
  return (
    <section aria-label="Favorilerim" className="flex min-w-0 flex-col rounded-xl border border-card-border bg-card p-4 shadow-card">
      <h2 className="text-sm font-bold tracking-tight">Favorilerim ve sık açtıklarım</h2>
      {favs.length === 0 && frequent.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">Rapor kartındaki yıldıza basarak favorilere ekleyin; sık açtıklarınız da burada birikir.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {favs.length > 0 && <ul className="flex flex-col gap-2.5">{favs.map((v) => card(v, true))}</ul>}
          {frequent.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Sık açtıklarım</h3>
              <ul aria-label="Sık açtıklarım" className="flex flex-col gap-2.5">{frequent.map((v) => card(v, false))}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
