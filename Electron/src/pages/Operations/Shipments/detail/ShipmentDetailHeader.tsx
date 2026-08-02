import { useState } from "react";
import { Ban, FileText, Globe } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { shipmentStatusLabels, shipmentStatusTones, type ShipmentDetail } from "../types";
import { ShipmentDispatchNote } from "../ShipmentDispatchNote";
import { CancelShipmentDialog } from "../CancelShipmentDialog";

/**
 * Tam-sayfa sevkiyat detayının sabit başlığı — kimlik (sevkiyat no + statü + ihracat
 * rozeti) + aksiyonlar (Sevk İrsaliyesi, PLANNED ise İptal Et). Dialoglar mevcut
 * (Sheet ile paylaşılan) bileşenlerin yeniden kullanımı.
 */
export function ShipmentDetailHeader({
  shipmentId,
  d,
  onBack,
}: {
  shipmentId: string | null;
  d: ShipmentDetail | null;
  onBack: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const canCancel = d != null && d.status !== "DISPATCHED" && d.status !== "CANCELLED";

  return (
    <>
      <PageHeader
        title={d?.shipmentNo ?? "Sevkiyat"}
        titleExtra={
          d ? (
            <span className="flex items-center gap-1.5">
              <StatusBadge status={d.status} labels={shipmentStatusLabels} tones={shipmentStatusTones} />
              {d.destination === "EXPORT" && (
                <Badge variant="outline" className="gap-0.5 border-info/40 text-[10px] text-info">
                  <Globe className="h-3 w-3" /> İhracat
                </Badge>
              )}
            </span>
          ) : undefined
        }
        description={
          d
            ? `${d.customer.name}${d.branch ? " · " + d.branch.name + (d.branch.code ? ` (${d.branch.code})` : "") : ""}`
            : undefined
        }
        parent={{ label: "Sevkiyatlar", to: "/operations/shipments" }}
        onBack={onBack}
        actions={
          d ? (
            <>
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setNoteOpen(true)}>
                <FileText className="h-3.5 w-3.5" /> Sevk İrsaliyesi
              </Button>
              {canCancel && (
                <PermissionGate permission="shipping:write">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1 text-destructive hover:text-destructive"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Ban className="h-3.5 w-3.5" /> İptal Et
                  </Button>
                </PermissionGate>
              )}
            </>
          ) : undefined
        }
      />

      <ShipmentDispatchNote
        shipmentId={shipmentId}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        returns={d ? { count: d.summary.returnedCount, meters: d.summary.returnedMeters } : undefined}
      />
      <CancelShipmentDialog
        shipmentId={cancelOpen ? shipmentId : null}
        onOpenChange={(o) => setCancelOpen(o)}
      />
    </>
  );
}
