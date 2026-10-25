// Muayeneler ekranından "Muayene raporu": sevkiyat seçici modal → rapor görüntüleyicisi.
// Rapor kaynağı Shipment'tır; fasondan doğrudan sevk (DIRECT) satırı seçicide gösterilmez.
import { useState } from "react";
import { FileText } from "lucide-react";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import type { CrudService } from "@/services/crudService";
import { shipmentService } from "@/pages/Operations/Shipments/service";
import type { ShipmentListItem } from "@/pages/Operations/Shipments/types";
import { InspectionReportDialog } from "./InspectionReportDialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";

const shipmentPickService: CrudService<ShipmentListItem> = {
  ...shipmentService,
  listCursor: (p) => shipmentService.listCursor(p).then((r) => ({ ...r, data: r.data.filter((s) => s.kind === "SHIPMENT") })),
};

export function InspectionReportPicker({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  const { hasPermission } = useRoleAccess();
  // Sevkiyat listesi sevk okuma izni ister; izinsiz kullanıcıya boş 403 modalı açılmaz.
  if (!hasPermission("shipping:read") && !hasPermission("shipping:write")) return null;
  return (
    <>
      <EntityPickerModal<ShipmentListItem>
        value={null}
        onChange={(id) => setPicked(id)}
        service={shipmentPickService}
        queryKey="inspection-report-shipments"
        getLabel={(s) => s.shipmentNo}
        getSubLabel={(s) => s.customer?.name}
        icon={FileText}
        placeholder="Muayene raporu (Yazdır / PDF)"
        title="Muayene raporu — sevkiyat seç"
        description="Sevk toplarının 4 puan muayeneleri, müşteri kuralına göre etiket ve sonuç."
        hideChevron
        defaultOpen={defaultOpen}
      />
      {picked && <InspectionReportDialog shipmentId={picked} onClose={() => setPicked(null)} />}
    </>
  );
}
