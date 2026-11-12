import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/layout/PageShell";
import type { ReportCatalogEntry } from "@/lib/report-catalog";
import { cn } from "@/lib/utils";
import { useReportFavorites } from "./favorites";
import { SaveMenu } from "./SaveMenu";
import { useReportV2 } from "./useReportV2";
import { useTrackReportOpen } from "./opened";
import { ReportV2Frame } from "./view/ReportV2Frame";

interface Props {
  entry: ReportCatalogEntry;
}

/**
 * Raporlar v2 ortak şablonu (plan §4.1) — her temel raporun TEK görünüşü. Yalnız sunucunun
 * `RaporSunumu`nu çizer: sayı, anlatı, grafik, tablo ve tanım metni sunucudan; istemci cümle kurmaz.
 */
export function ReportV2Page({ entry }: Props) {
  const query = useReportV2(entry);
  useTrackReportOpen(entry.key);
  const { isFavorite, toggle } = useReportFavorites();
  const fav = isFavorite(entry.key);

  return (
    <PageShell className="overflow-hidden">
      <ReportV2Frame
        entry={entry}
        query={query}
        parent={{ label: "Rapor Merkezi", to: "/reports" }}
        leadingActions={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => toggle(entry.key)}
            aria-pressed={fav}
            title={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
          >
            <Star className={cn("h-4 w-4", fav && "fill-warning text-warning")} />
          </Button>
        }
        saveMenu={<SaveMenu reportKey={entry.key} />}
      />
    </PageShell>
  );
}
