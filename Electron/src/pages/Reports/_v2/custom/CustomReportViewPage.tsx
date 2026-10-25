import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Pencil, RefreshCw, Share2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useAuthStore } from "@/store/auth";
import { errorCodeOf } from "@/pages/Operations/LoomAlarms/alarm-access";
import { customReportApi, REPORT_BUILDER_PERMISSION, REPORT_PUBLISH_PERMISSION, type DefinitionIssue } from "./custom-api";
import { DefinitionResultView } from "./DefinitionResultView";
import { ShareDialog } from "./ShareDialog";
import { VersionsDialog } from "./VersionsDialog";

const chartKindsOf = (body: unknown) => {
  const blocks = (body as { bloklar?: Array<{ id: string; gorsel?: string }> } | null)?.bloklar ?? [];
  return (id: string) => blocks.find((b) => b.id === id)?.gorsel ?? "cubuk";
};

function RunFailure({ error }: { error: unknown }) {
  const code = errorCodeOf(error);
  const details = (error as { response?: { data?: { details?: { hatalar?: DefinitionIssue[]; panelYolu?: string | null } } } }).response?.data?.details;
  if (code === "RAPOR_SISTEM_TANIMI" && details?.panelYolu) return <Navigate to={`/${details.panelYolu}`} replace />;
  if (code === "RAPOR_TANIMI_BOZUK") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        <p className="font-medium">Bu rapor artık çalışmıyor; tanımındaki bir ölçü ya da kırılım değişmiş.</p>
        <ul className="mt-1 list-disc pl-5">{(details?.hatalar ?? []).map((h) => <li key={h.yol}>{h.mesaj}</li>)}</ul>
      </div>
    );
  }
  return <p className="text-sm text-destructive">Rapor çalıştırılamadı; biraz sonra yeniden deneyin.</p>;
}

/** Kayıtlı (özel) rapor — `reports/ozel/:id`: koşu sonucu + yeni hâlini al + paylaş + sürümler. */
export function CustomReportViewPage() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const userId = useAuthStore((s) => s.user?.userId);
  const [dialog, setDialog] = useState<"share" | "versions" | null>(null);
  const detail = useQuery({ queryKey: ["custom-report", id], queryFn: () => customReportApi.get(id), retry: false });
  const run = useQuery({ queryKey: ["custom-report-run", id], queryFn: () => customReportApi.run(id, false), retry: false, enabled: detail.isSuccess });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(["custom-report-run", id], await customReportApi.run(id, true));
    } catch {
      await run.refetch();
    } finally {
      setRefreshing(false);
    }
  };
  if (detail.isError) return <Navigate to="/forbidden" replace />;
  const d = detail.data;
  const canPublish = hasPermission(REPORT_PUBLISH_PERMISSION);
  const canShare = d?.tur === "OZEL" && (d.sahip?.id === userId || canPublish);
  const canEdit = Boolean(d?.duzenleyebilir) && hasPermission(REPORT_BUILDER_PERMISSION);

  return (
    <PageShell>
      <PageHeader
        title={d?.ad ?? "Rapor"}
        description={d ? `${d.kategori.ad}${d.sahip ? ` · ${d.sahip.ad}` : ""}${d.aktifSurum ? ` · Sürüm ${d.aktifSurum.no}` : ""}` : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={refreshing || !run.data} onClick={() => void refresh()}>
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Yeni hâlini al
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog("versions")}>
              <History className="h-4 w-4" /> Sürümler
            </Button>
            {canShare ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog("share")}>
                <Share2 className="h-4 w-4" /> Paylaş
              </Button>
            ) : null}
            {canEdit ? (
              <Button size="sm" asChild className="gap-1.5">
                <Link to={`/reports/ozel/${id}/duzenle`}>
                  <Pencil className="h-4 w-4" /> Düzenle
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <PageBody className="p-4 sm:p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          {run.isLoading || detail.isLoading ? <p className="text-sm text-muted-foreground">Rapor hazırlanıyor…</p> : null}
          {run.isError ? <RunFailure error={run.error} /> : null}
          {run.data && d ? <DefinitionResultView result={run.data} chartKindOf={chartKindsOf(d.govde)} /> : null}
        </div>
      </PageBody>
      {d ? <ShareDialog definitionId={id} open={dialog === "share"} canPublish={canPublish} onClose={() => setDialog(null)} /> : null}
      {d ? <VersionsDialog definitionId={id} open={dialog === "versions"} onClose={() => setDialog(null)} /> : null}
    </PageShell>
  );
}
