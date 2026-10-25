import { RefreshCw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import type { ReportCatalogEntry } from "@/lib/report-catalog";
import { cn } from "@/lib/utils";
import { ReportExportBar } from "../_components/ReportExportBar";
import { buildExportSpec } from "./export-spec";
import { useReportFavorites } from "./favorites";
import { ParamChips } from "./ParamChips";
import { ReportBody } from "./ReportBody";
import { ReportFailureState, ReportLoadingState } from "./ReportStates";
import { SaveMenu } from "./SaveMenu";
import { failureOf, useReportV2 } from "./useReportV2";

interface Props {
  entry: ReportCatalogEntry;
}

/**
 * Raporlar v2 ortak şablonu (plan §4.1) — her temel raporun TEK görünüşü. Yalnız sunucunun
 * `RaporSunumu`nu çizer: sayı, anlatı, grafik, tablo ve tanım metni sunucudan; istemci cümle kurmaz.
 */
export function ReportV2Page({ entry }: Props) {
  const query = useReportV2(entry);
  const { isFavorite, toggle } = useReportFavorites();
  const fav = isFavorite(entry.key);
  const data = query.data;
  const failure = query.isError ? failureOf(query.error) : null;

  return (
    <PageShell className="overflow-hidden">
      <PageHeader
        title={data?.baslik ?? entry.baslik}
        parent={{ label: "Rapor Merkezi", to: "/reports" }}
        pageFavorite={false}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => toggle(entry.key)}
              aria-pressed={fav}
              title={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
            >
              <Star className={cn("h-4 w-4", fav && "fill-amber-400 text-amber-500")} />
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="Yenile">
              <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} /> <span className="hidden lg:inline">Yenile</span>
            </Button>
            <SaveMenu reportKey={entry.key} />
            <ReportExportBar buildSpec={() => (data ? buildExportSpec(data) : null)} disabled={!data} />
          </div>
        }
      />
      <p className="border-b bg-muted/20 px-4 py-2 text-sm">
        <span className="font-medium">{data?.soru ?? entry.soru}</span>
      </p>
      <ParamChips entry={entry} params={data?.parametreler ?? []} personNamed={data?.kisiAdi === true} />
      <PageBody className="p-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          {failure ? (
            <ReportFailureState failure={failure} error={query.error} onRetry={() => void query.refetch()} />
          ) : data ? (
            <ReportBody presentation={data} fetchedAt={query.dataUpdatedAt} />
          ) : (
            <ReportLoadingState />
          )}
        </div>
      </PageBody>
    </PageShell>
  );
}
