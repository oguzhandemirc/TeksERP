import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PackageCheck,
  RefreshCw,
  ChevronRight,
  Building2,
  ClipboardList,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SlideOverPanel } from "@/components/ui/SlideOverPanel";
import { subcontractorService } from "@/services/subcontractorService";

export default function ReceiptsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["receipts"],
    queryFn: () => subcontractorService.listReceipts({ limit: 100 }),
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["receipts", selectedId],
    queryFn: () => subcontractorService.getReceipt(selectedId!),
    enabled: !!selectedId,
  });

  const list = data?.data ?? [];
  const detail = detailData?.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Fason Kabul Belgeleri</h1>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" /> Yenile
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Kabul Listesi
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
              Henüz kabul belgesi yok.
            </p>
          ) : (
            <div className="space-y-2">
              {list.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className="w-full text-left rounded-lg border p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{r.receiptNo}</span>
                        <Badge variant="outline" className="text-xs">
                          İrsaliye: {r.manifestNo}
                        </Badge>
                        {r.company && (
                          <Badge variant="outline" className="text-xs flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {r.company.code}
                          </Badge>
                        )}
                        {r.workOrder && (
                          <Badge variant="secondary" className="text-xs">
                            {r.workOrder.batchNumber}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{new Date(r.receivedAt).toLocaleString("tr-TR")}</span>
                        <span>{r.items?.length ?? 0} top</span>
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
        title={detail ? `Kabul: ${detail.receiptNo}` : "Detay"}
      >
        {detailLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : detail ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">İrsaliye No:</span>
              <span className="font-medium">{detail.manifestNo}</span>
              <span className="text-muted-foreground">Parti:</span>
              <span className="font-medium">{detail.workOrder?.batchNumber}</span>
              <span className="text-muted-foreground">Firma:</span>
              <span className="font-medium">{detail.company?.name}</span>
              <span className="text-muted-foreground">Tarih:</span>
              <span>{new Date(detail.receivedAt).toLocaleString("tr-TR")}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Metraj / ağırlık / fire ölçümü bu belgede saklanmaz — sonraki
              istasyonun FINISH kaydına bakın.
            </p>

            {detail.notes && (
              <div className="rounded-md border p-2 bg-muted/30 text-xs">
                {detail.notes}
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                Kabul Edilen Toplar ({detail.items?.length ?? 0})
              </p>
              <div className="space-y-1">
                {detail.items?.map((it, i) => (
                  <div
                    key={it.id}
                    className="flex flex-col gap-1 rounded border px-2 py-1.5 bg-background text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{i + 1}</Badge>
                      <span className="font-mono">
                        {it.newRoll?.barcode ?? it.newRollId}
                      </span>
                    </div>
                    {it.notes && (
                      <span className="text-[11px] text-muted-foreground">
                        {it.notes}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </SlideOverPanel>
    </div>
  );
}
