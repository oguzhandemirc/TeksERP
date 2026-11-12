import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody } from "@/components/layout/PageShell";
import type { ReportCatalogEntry } from "@/lib/report-catalog";
import { cn } from "@/lib/utils";
import { ReportExportBar } from "../../_components/ReportExportBar";
import { buildExportSpec } from "../export-spec";
import { ParamChips } from "../ParamChips";
import { ReportBody } from "../ReportBody";
import type { ReportRowLink } from "../ReportTable";
import { ReportFailureState, ReportLoadingState } from "../ReportStates";
import type { RaporSunumu } from "../sunum";
import { failureOf } from "../useReportV2";

/** `useReportV2` dönüşünün çerçevenin okuduğu dilimi. */
export interface ReportFrameQuery {
  data?: RaporSunumu;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  dataUpdatedAt: number;
  refetch: () => unknown;
}

interface Props {
  entry: ReportCatalogEntry;
  query: ReportFrameQuery;
  parent: { label: string; to: string };
  /** Başlığın solundaki ek eylemler (favori yıldızı) ve Kaydet menüsü. */
  leadingActions?: ReactNode;
  saveMenu?: ReactNode;
  /** Soru satırının altında kalan sayfaya özel bağlam ("hesap: …"). */
  questionExtra?: ReactNode;
  rowLink?: ReportRowLink;
  personNamed?: boolean;
  /** Sorgu bilerek atılmadıysa (modül kapalı) gövdenin yerine çizilen açıklama. */
  blockedNote?: ReactNode;
}

/**
 * v2 rapor yaprağının TEK çerçevesi: sabit başlık (eylemler ikonlu) → TEK kaydırıcı. Soru cümlesi
 * kaydırıcının içinde soluk alt başlıktır (sabit bant değil; ⓘ ipucunda da durur); yalnız ince süzgeç
 * bandı yapışkandır. Gövde tam genişlik — dar ortalanmış sütun yok.
 */
export function ReportV2Frame({ entry, query, parent, leadingActions, saveMenu, questionExtra, rowLink, personNamed, blockedNote }: Props) {
  const data = query.data;
  const failure = query.isError ? failureOf(query.error) : null;
  const question = data?.soru ?? entry.soru;
  return (
    <>
      <PageHeader
        title={data?.baslik ?? entry.baslik}
        description={question}
        parent={parent}
        pageFavorite={false}
        actionsAlign="center"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1">
            {leadingActions}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={blockedNote != null || query.isFetching}
              onClick={() => void query.refetch()}
              aria-label="Yenile"
              title="Yenile"
            >
              <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} />
            </Button>
            {saveMenu}
            <ReportExportBar buildSpec={() => (data ? buildExportSpec(data) : null)} disabled={!data} compact />
          </div>
        }
      />
      <PageBody className="relative" data-testid="report-scroll">
        <div className="px-4 pt-2 pb-1.5">
          <p className="truncate text-sm text-muted-foreground" data-testid="report-question" title={question}>
            {question}
          </p>
          {questionExtra}
        </div>
        <ParamChips entry={entry} params={data?.parametreler ?? []} personNamed={personNamed === true || data?.kisiAdi === true} />
        <div className="p-4">
          {blockedNote != null ? (
            <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">{blockedNote}</p>
          ) : failure ? (
            <ReportFailureState failure={failure} error={query.error} onRetry={() => void query.refetch()} />
          ) : data ? (
            <ReportBody presentation={data} fetchedAt={query.dataUpdatedAt} rowLink={rowLink} />
          ) : (
            <ReportLoadingState />
          )}
        </div>
      </PageBody>
    </>
  );
}
