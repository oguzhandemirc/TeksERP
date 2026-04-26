import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Truck,
  RefreshCw,
  ChevronRight,
  Ruler,
  Building2,
  ClipboardList,
  Printer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SlideOverPanel } from "@/components/ui/SlideOverPanel";
import { subcontractorService } from "@/services/subcontractorService";
import SubcontractorDispatchPrintDialog from "@/pages/WorkOrders/SubcontractorDispatchPrintDialog";

export default function DispatchesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["dispatches"],
    queryFn: () => subcontractorService.listDispatches({ limit: 100 }),
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["dispatches", selectedId],
    queryFn: () => subcontractorService.getDispatch(selectedId!),
    enabled: !!selectedId,
  });

  const list = data?.data ?? [];
  const detail = detailData?.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Fason Sevk Belgeleri</h1>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" /> Yenile
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Sevk Listesi
            <Badge variant="secondary" className="ml-1">{list.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Henüz sevk belgesi yok.
            </p>
          ) : (
            <div className="space-y-2">
              {list.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className="w-full text-left rounded-lg border p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{d.dispatchNo}</span>
                        {d.company && (
                          <Badge variant="outline" className="text-xs flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {d.company.code}
                          </Badge>
                        )}
                        {d.workOrder && (
                          <Badge variant="secondary" className="text-xs">
                            {d.workOrder.batchNumber}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{new Date(d.dispatchedAt).toLocaleString("tr-TR")}</span>
                        {d.plateNumber && <span>🚚 {d.plateNumber}</span>}
                        <span className="flex items-center gap-1">
                          <Ruler className="h-3 w-3" />
                          {d.totalQty.toFixed(1)}m
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SlideOverPanel
        isOpen={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={detail ? `Sevk: ${detail.dispatchNo}` : "Detay"}
        headerActions={
          selectedId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPrintId(selectedId)}
            >
              <Printer className="h-4 w-4 mr-1" />
              İrsaliye
            </Button>
          )
        }
      >
        {detailLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : detail ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">Parti:</span>
              <span className="font-medium">{detail.workOrder?.batchNumber}</span>
              <span className="text-muted-foreground">Firma:</span>
              <span className="font-medium">{detail.company?.name}</span>
              <span className="text-muted-foreground">Plaka:</span>
              <span>{detail.plateNumber ?? "—"}</span>
              <span className="text-muted-foreground">Şoför:</span>
              <span>{detail.driverName ?? "—"}</span>
              <span className="text-muted-foreground">Toplam:</span>
              <span className="font-semibold">{detail.totalQty.toFixed(1)}m</span>
              <span className="text-muted-foreground">Tarih:</span>
              <span>{new Date(detail.dispatchedAt).toLocaleString("tr-TR")}</span>
            </div>

            {detail.notes && (
              <div className="rounded-md border p-2 bg-muted/30 text-xs">
                {detail.notes}
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                Sevk Edilen Toplar ({detail.items?.length ?? 0})
              </p>
              <div className="space-y-1">
                {detail.items?.map((it, i) => (
                  <div
                    key={it.id}
                    className="flex items-center gap-2 rounded border px-2 py-1.5 bg-background text-xs"
                  >
                    <Badge variant="outline" className="text-[10px]">{i + 1}</Badge>
                    <span className="font-mono">{it.roll?.barcode ?? it.rollId}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <Ruler className="h-3 w-3" /> {it.dispatchedQty.toFixed(1)}m
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </SlideOverPanel>

      <SubcontractorDispatchPrintDialog
        open={!!printId}
        onOpenChange={(o) => { if (!o) setPrintId(null); }}
        dispatchId={printId}
      />
    </div>
  );
}
