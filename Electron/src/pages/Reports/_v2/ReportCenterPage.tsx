import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Input } from "@/components/ui/input";
import { SPOTLIGHT_CLASS, SpotlightGroup } from "@/components/insight/SpotlightGroup";
import { useSpotlight, type SpotlightController } from "@/components/insight/useSpotlight";
import { useMenuLayout } from "@/hooks/useMenuLayout";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { foldedIncludes } from "@/lib/search-fold";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { fetchPano } from "@/pages/Dashboard/dashboardService";
import { PANO_UC_IZINLERI, type PanoDonem } from "@/pages/Dashboard/pano/types";
import { centerGroups, type CenterGroup } from "./center-model";
import { useReportFavorites } from "./favorites";
import { useOpenedReports } from "./opened";
import { CustomReportsSection } from "./custom/CustomReportsSection";
import { REPORT_BUILDER_PERMISSION, useCustomReportList } from "./custom/custom-api";
import { DEFAULT_PERIOD } from "../_hub/hub-meta";
import { EMPTY_FILTER, narrowGroups, personasIn, visibleGroups, type HubFilter } from "../_hub/hub-model";
import { HubTopPanel } from "../_hub/HubTopPanel";
import { HubInsightsRow } from "../_hub/HubInsightsRow";
import { HubReportList } from "../_hub/HubReportList";
import type { VisibleEntry } from "../_hub/HubPersonal";

const scrollTo = (el: HTMLElement | null) => el?.scrollIntoView?.({ behavior: "smooth", block: "start" });

/** Kategori kartı süzmez: bölümü spot ışığıyla öne çıkarır; açılır süzgeç onu gizlemişse nedenini duyurur. */
function spotlightCategory(spot: SpotlightController, groups: readonly CenterGroup[], key: string, title: string) {
  const n = groups.find((g) => g.key === key)?.entries.length ?? 0;
  spot.spotlight(key, `${title} bölümü vurgulandı, ${n} rapor.`, `${title} raporları seçili süzgeçle gizli; “Sıfırla” ile görünür.`);
}

/** Rapor Merkezi (plan §4.2) — `/reports`un tek yüzü. */
export function ReportCenterPage() {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const { favorites, isFavorite, toggle } = useReportFavorites();
  const { opened } = useOpenedReports();
  const [filter, setFilter] = useState<HubFilter>(EMPTY_FILTER);
  const [period, setPeriod] = useState<PanoDonem>(DEFAULT_PERIOD);
  const spot = useSpotlight();
  const customRef = useRef<HTMLDivElement>(null);
  const access = useMemo(() => ({ isAdmin, hasPermission, ctx }), [isAdmin, hasPermission, ctx]);
  const menu = useMenuLayout();
  // Görünürlük TEK yüklemden (`centerGroups`); aşağıdaki her kutu bu kümeden okur.
  const all = useMemo(() => centerGroups(access, undefined, menu), [access, menu]);
  const visible = useMemo(
    () => new Map<string, VisibleEntry>(all.flatMap((g) => g.entries.map((e) => [e.key, { entry: e, category: g.key, categoryTitle: g.title }] as const))),
    [all],
  );
  const narrowed = useMemo(() => narrowGroups(all, filter, foldedIncludes).filter((g) => g.entries.length > 0), [all, filter]);
  const groups = useMemo(() => visibleGroups(all, filter, foldedIncludes), [all, filter]);

  const insightsAllowed = isAdmin || PANO_UC_IZINLERI.some((p) => hasPermission(p));
  const pano = useQuery({ queryKey: ["dashboard", "pano", period], queryFn: () => fetchPano(period), enabled: insightsAllowed, staleTime: 60_000 });

  const canBuild = hasPermission(REPORT_BUILDER_PERMISSION);
  const mine = useCustomReportList("benim", true);
  const shared = useCustomReportList("paylasilan", true);
  const customTotal = (mine.data?.items.length ?? 0) + (shared.data?.items.length ?? 0);

  return (
    <PageShell>
      <PageHeader
        title="Rapor Merkezi"
        description="Her rapor tek bir soruya cevap verir; sayının ne anlattığı altında günlük dille yazılır."
        actions={
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={filter.term} onChange={(e) => setFilter({ ...filter, term: e.target.value })} placeholder="Rapor ara…" className="pl-8" aria-label="Rapor ara" />
          </div>
        }
      />
      <PageBody className="p-6">
        <SpotlightGroup controller={spot} className="@container mx-auto flex max-w-[96rem] flex-col gap-5">
          <HubTopPanel
            groups={narrowed}
            personas={personasIn(all)}
            filter={filter}
            onFilter={setFilter}
            onReset={() => setFilter(EMPTY_FILTER)}
            period={insightsAllowed ? period : null}
            onPeriod={setPeriod}
            canBuild={canBuild}
            customCount={canBuild || customTotal > 0 ? customTotal : null}
            onCategoryPicked={(key, title) => spotlightCategory(spot, groups, key, title)}
            spotKey={spot.activeKey}
            onShowCustom={() => scrollTo(customRef.current)}
          />
          <div {...spot.dimProps()} className={SPOTLIGHT_CLASS}><HubInsightsRow
            pano={insightsAllowed ? pano : null}
            period={period}
            opened={opened}
            favorites={favorites}
            visible={visible}
            onToggleFavorite={toggle}
            onShowCustom={() => scrollTo(customRef.current)}
          /></div>
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-bold tracking-tight">
              Tüm raporlar <span className="text-sm font-normal text-muted-foreground">({groups.reduce((n, g) => n + g.entries.length, 0)})</span>
            </h2>
            <HubReportList groups={groups} isFavorite={isFavorite} onToggleFavorite={toggle} regionProps={spot.regionProps} />
            {groups.length === 0 ? <EmptyListNote filter={filter} /> : null}
          </div>
          <div ref={customRef} {...spot.dimProps()} className={`scroll-mt-4 ${SPOTLIGHT_CLASS}`}>
            <CustomReportsSection term={filter.term} />
          </div>
        </SpotlightGroup>
      </PageBody>
    </PageShell>
  );
}

function EmptyListNote({ filter }: { filter: HubFilter }) {
  const term = filter.term.trim();
  let text: string;
  if (filter.category || filter.persona) text = "Seçili süzgeçlerle eşleşen rapor yok; “Sıfırla” ile hepsini görün.";
  else if (term) text = `“${term}” ile eşleşen rapor yok.`;
  else text = "Size açık rapor henüz yok.";
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
