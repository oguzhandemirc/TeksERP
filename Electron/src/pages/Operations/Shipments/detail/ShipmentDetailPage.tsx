import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useTabsStore } from "@/store/tabs";
import { shipmentService } from "../service";
import { ShipmentDetailHeader } from "./ShipmentDetailHeader";
import { ShipmentDetailBody } from "./ShipmentDetailBody";

const LIST_PATH = "/operations/shipments";

/**
 * Çuval sevkiyatı tam-sayfa detayı. Veri mevcut `shipmentService.getDetail` +
 * `["shipment-detail", id]` (Sheet ve Sevk İrsaliyesi ile paylaşılan cache).
 * Header'da aksiyonlar; gövdede özet/künye/sipariş/çuval/iade + sayfa-içi hızlı filtre.
 */
export function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const openTarget = useOpenTarget();

  const detail = useQuery({
    queryKey: ["shipment-detail", id],
    queryFn: () => shipmentService.getDetail(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
  const d = detail.data?.data ?? null;

  useEffect(() => {
    if (!d?.shipmentNo || !id) return;
    const title = `Sevkiyat · ${d.shipmentNo}`;
    const tab = useTabsStore.getState().tabs.find((t) => t.path === `/operations/shipments/${id}`);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, title);
  }, [d?.shipmentNo, id]);

  return (
    <PageShell>
      <ShipmentDetailHeader shipmentId={id ?? null} d={d} onBack={() => openTarget(LIST_PATH)} />
      {/* Gövde kendi içsel kaydırma bölgesini yönetir (sanallaştırılmış çuval listesi):
       *  künye/araç çubuğu sabit, yalnız liste kayar → PageBody sarmalayıcısı YOK.
       *  Yükleniyor / bulunamadı durumları tek kaydırıcılı PageBody kullanır. */}
      {detail.isLoading && (
        <PageBody className="p-6">
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
        </PageBody>
      )}
      {!detail.isLoading && !d && (
        <PageBody className="p-6">
          <div className="py-16 text-center text-sm text-muted-foreground">Sevkiyat bulunamadı.</div>
        </PageBody>
      )}
      {d && <ShipmentDetailBody key={d.id} d={d} />}
    </PageShell>
  );
}
