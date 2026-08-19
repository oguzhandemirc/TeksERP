import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { ImportDialog } from "@/components/import/ImportDialog";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import { ConfigBundleCard } from "./ConfigBundleCard";
import { EntityPreviewDialog } from "@/components/import/EntityPreviewDialog";
import { importService, type ImportEntityInfo, type ImportRunRow } from "@/services/importService";
import { safeFormat } from "@/lib/format";
import type { ExportColumn } from "@/lib/list-export";

/**
 * Veri Aktarımı — TEK merkezî yüzey.
 *
 * Ana veri ekranlarının kendi "İçe Aktar" düğmesi zaten var; bu ekran iki
 * boşluğu kapatır: (1) kendi ekranı olmayan / bilinçli salt-okunur olan
 * varlıklar (ör. Kalite Sınıfları — o liste seed'den yönetilir ve panelden
 * düzenlenmez, ama bir kurulumdan diğerine taşınabilmeli), (2) "kim ne zaman
 * ne yükledi" geçmişi.
 *
 * Sektör emsali: SAP Migration Cockpit / Dynamics "Data Management" workspace.
 */
export function DataImportPage() {
  const [importEntity, setImportEntity] = useState<string | null>(null);
  // Şablon ve veri artık DOĞRUDAN inmiyor: önce ne indireceğini gösteren bir
  // önizleme açılıyor, indirme düğmesi onun içinde. Bir tık ekliyor, yanlış
  // dosyayı indirip Excel'de açma turunu kaldırıyor.
  const [preview, setPreview] = useState<{ entity: string; mode: "template" | "data" } | null>(null);

  const entitiesQuery = useQuery({
    queryKey: ["import-entities"],
    queryFn: importService.entities,
    staleTime: 5 * 60 * 1000,
  });

  const runsQuery = useQuery({
    queryKey: ["import-runs"],
    queryFn: () => importService.runs({ limit: 100 }),
    refetchOnMount: "always",
  });

  const entities = entitiesQuery.data?.data ?? [];
  const runs = runsQuery.data?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Veri Aktarımı"
        description="Excel/CSV ile toplu kayıt oluşturma ve güncelleme — şablon indir, doldur, önizle, uygula."
        actions={<RefreshButton queryKey="import-runs" />}
      />

      <div className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Önizleme adımında <strong>hiçbir kayıt yazılmaz</strong>; ne olacağını satır satır görürsünüz.
          Varsayılan davranış: tek satırda bile hata varsa <strong>hiçbir şey yazılmaz</strong>.
        </span>
      </div>

      <h2 className="mb-2 text-sm font-medium">Aktarılabilir Veriler</h2>
      {entitiesQuery.isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entities.map((e) => (
            <div key={e.entity} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{e.label}</p>
                  <p className="text-xs text-muted-foreground">Anahtar: {e.keyColumns.join(" + ")}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!e.canWrite}
                  title={e.canWrite ? "Şablonun sütunlarını ve kurallarını gör" : "Bu veriye yazma yetkiniz yok"}
                  onClick={() => setPreview({ entity: e.entity, mode: "template" })}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Şablon
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!e.canRead}
                  title={e.canRead ? "Mevcut kayıtları şablon biçiminde gör ve indir" : "Okuma yetkiniz yok"}
                  onClick={() => setPreview({ entity: e.entity, mode: "data" })}
                >
                  <Download className="h-3.5 w-3.5" /> Veriyi gör
                </Button>
                <Button
                  size="sm"
                  disabled={!e.canWrite}
                  title={e.canWrite ? undefined : "Bu veriye yazma yetkiniz yok"}
                  onClick={() => setImportEntity(e.entity)}
                >
                  <Upload className="h-3.5 w-3.5" /> İçe Aktar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-6 mb-2 text-sm font-medium">Yapılandırma Taşıma</h2>
      <ConfigBundleCard />

      <div className="mt-6 mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Geçmiş</h2>
        <ListExportMenu
          name="İçe Aktarım Geçmişi"
          rows={runs}
          columns={RUN_EXPORT_COLUMNS}
          notes={["Son 100 koşum.", "Kayıtlar kalıcıdır (denetim log'undan bağımsız, arşivlenmez)."]}
        />
      </div>
      {runsQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : runs.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          Henüz içe aktarım yapılmamış.
        </p>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="px-2 py-1.5 text-left">Tarih</th>
                <th className="px-2 py-1.5 text-left">Veri</th>
                <th className="px-2 py-1.5 text-left">Dosya</th>
                <th className="px-2 py-1.5 text-left">Kullanıcı</th>
                <th className="px-2 py-1.5 text-right">Satır</th>
                <th className="px-2 py-1.5 text-right">Yeni</th>
                <th className="px-2 py-1.5 text-right">Güncel</th>
                <th className="px-2 py-1.5 text-right">Hata</th>
                <th className="px-2 py-1.5 text-left">Durum</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {safeFormat(r.createdAt, "dd.MM.yyyy HH:mm")}
                  </td>
                  <td className="px-2 py-1.5">{entityLabel(entities, r.entity)}</td>
                  <td className="px-2 py-1.5">{r.fileName ?? "—"}</td>
                  <td className="px-2 py-1.5">{r.user?.fullName ?? r.user?.username ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.rowCount}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.created}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.updated}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.failed}</td>
                  <td className="px-2 py-1.5">
                    <StatusBadge run={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview ? (
        <EntityPreviewDialog
          open={Boolean(preview)}
          onOpenChange={(o) => !o && setPreview(null)}
          entity={preview.entity}
          mode={preview.mode}
        />
      ) : null}

      {importEntity ? (
        <ImportDialog
          open={Boolean(importEntity)}
          onOpenChange={(open) => !open && setImportEntity(null)}
          entity={importEntity}
          onDone={() => void runsQuery.refetch()}
        />
      ) : null}
    </PageShell>
  );
}

function entityLabel(entities: ImportEntityInfo[], entity: string): string {
  return entities.find((e) => e.entity === entity)?.label ?? entity;
}

function StatusBadge({ run }: { run: ImportRunRow }) {
  if (run.status === "APPLIED") {
    return (
      <span className="flex items-center gap-1 text-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> Tamamlandı
      </span>
    );
  }
  if (run.status === "PARTIAL") {
    return (
      <span className="flex items-center gap-1 text-warning" title={`Yazma ${run.stoppedAtRowNo}. satırda durdu`}>
        <AlertTriangle className="h-3.5 w-3.5" /> Yarıda kesildi
        {run.stoppedAtRowNo ? ` (satır ${run.stoppedAtRowNo})` : ""}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-destructive">
      <XCircle className="h-3.5 w-3.5" /> Başarısız
    </span>
  );
}

const STATUS_LABEL: Record<ImportRunRow["status"], string> = {
  APPLIED: "Tamamlandı",
  PARTIAL: "Yarıda kesildi",
  FAILED: "Başarısız",
};

const RUN_EXPORT_COLUMNS: ExportColumn<ImportRunRow>[] = [
  { label: "Tarih", value: (r) => safeFormat(r.createdAt, "dd.MM.yyyy HH:mm") },
  { label: "Veri", value: (r) => r.entity },
  { label: "Dosya", value: (r) => r.fileName ?? "" },
  { label: "Kullanıcı", value: (r) => r.user?.fullName ?? r.user?.username ?? "" },
  { label: "Satır", value: (r) => r.rowCount, summable: true },
  { label: "Yeni", value: (r) => r.created, summable: true },
  { label: "Güncellenen", value: (r) => r.updated, summable: true },
  { label: "Değişmeyen", value: (r) => r.skipped, summable: true },
  { label: "Hata", value: (r) => r.failed, summable: true },
  { label: "Durum", value: (r) => STATUS_LABEL[r.status] },
  { label: "Durduğu Satır", value: (r) => r.stoppedAtRowNo ?? "" },
  { label: "Süre (sn)", value: (r) => Math.round(r.durationMs / 100) / 10 },
];
