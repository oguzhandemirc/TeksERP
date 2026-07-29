import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useTabsStore } from "@/store/tabs";
import { useDirectShipmentDetail, DirectShipmentDetailContent } from "../DirectShipmentDetailContent";

const LIST_PATH = "/operations/shipments";

/**
 * Fasondan doğrudan sevk (DirectShipment) tam-sayfa detayı — ince kabuk: header +
 * mevcut `DirectShipmentDetailContent` (künye + toplar + karşılanan siparişler +
 * İrsaliye). İçerik query'si Sheet/Modal ile paylaşılır (dedupe).
 */
export function DirectShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const openTarget = useOpenTarget();
  const q = useDirectShipmentDetail(id ?? null, true);
  const d = q.data?.data ?? null;

  useEffect(() => {
    if (!d?.shipmentNo || !id) return;
    const title = `Fasondan Sevk · ${d.shipmentNo}`;
    const tab = useTabsStore
      .getState()
      .tabs.find((t) => t.path === `/operations/shipments/direct/${id}`);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, title);
  }, [d?.shipmentNo, id]);

  return (
    <PageShell>
      <PageHeader
        title={d?.shipmentNo ?? "Fasondan Sevk"}
        titleExtra={
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
            Fasondan Sevk
          </Badge>
        }
        description={
          d
            ? `${d.customer.name}${d.branch ? " · " + d.branch.name + (d.branch.code ? ` (${d.branch.code})` : "") : ""}`
            : undefined
        }
        parent={{ label: "Sevkiyatlar", to: LIST_PATH }}
        onBack={() => openTarget(LIST_PATH)}
      />
      <PageBody className="p-6">
        <div className="mx-auto max-w-3xl">
          <DirectShipmentDetailContent directShipmentId={id ?? null} />
        </div>
      </PageBody>
    </PageShell>
  );
}
