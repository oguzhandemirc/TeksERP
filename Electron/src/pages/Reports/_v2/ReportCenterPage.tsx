import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Input } from "@/components/ui/input";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { REPORT_BY_KEY, type ReportCatalogEntry } from "@/lib/report-catalog";
import { foldedIncludes } from "@/lib/search-fold";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import type { ReportTile } from "../tile-config";
import { centerGroups, filterGroups, isCenterEntryVisible } from "./center-model";
import { useReportFavorites } from "./favorites";
import { FavoritesStrip, LegacyReportsSection, ReportGroupSection } from "./ReportCenterSections";

interface Props {
  /** Eski hub'ın AYNI süzgeçten geçmiş kategori karoları — "Eski raporlar" yer tutucusu (içeriği R0-GECIS). */
  legacyTiles: readonly ReportTile[];
}

/** Rapor Merkezi (plan §4.2) — `reports.v2Enabled` açıkken `/reports`un yerini alır. */
export function ReportCenterPage({ legacyTiles }: Props) {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const { favorites } = useReportFavorites();
  const [term, setTerm] = useState("");
  const access = useMemo(() => ({ isAdmin, hasPermission, ctx }), [isAdmin, hasPermission, ctx]);
  const groups = useMemo(() => filterGroups(centerGroups(access), term, foldedIncludes), [access, term]);
  const favEntries = favorites
    .map((k) => REPORT_BY_KEY.get(k))
    .filter((e): e is ReportCatalogEntry => e !== undefined && isCenterEntryVisible(e, access));

  return (
    <PageShell>
      <PageHeader
        title="Rapor Merkezi"
        description="Her rapor tek bir soruya cevap verir; sayının ne anlattığı altında günlük dille yazılır."
        actions={
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Rapor ara…" className="pl-8" aria-label="Rapor ara" />
          </div>
        }
      />
      <PageBody className="p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {favEntries.length > 0 && !term ? <FavoritesStrip entries={favEntries} /> : null}
          {groups.map((g) => (
            <ReportGroupSection key={g.key} title={g.title} entries={g.entries} />
          ))}
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {term ? `“${term}” ile eşleşen rapor yok.` : legacyTiles.length > 0 ? "Size açık yeni rapor henüz yok; önceki raporlar aşağıda." : "Size açık rapor henüz yok."}
            </p>
          ) : null}
          {!term && legacyTiles.length > 0 ? <LegacyReportsSection tiles={legacyTiles} /> : null}
        </div>
      </PageBody>
    </PageShell>
  );
}
