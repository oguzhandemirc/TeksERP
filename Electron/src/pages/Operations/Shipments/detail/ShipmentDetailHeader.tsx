import { useState } from "react";
import { AlertTriangle, Ban, FileText, Globe, Truck, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { shipmentStatusLabels, shipmentStatusTones, type ShipmentDetail } from "../types";
import { ShipmentDocDialog } from "../ShipmentDocDialog";
import { CancelShipmentDialog } from "../CancelShipmentDialog";
import { UndoDispatchDialog } from "../UndoDispatchDialog";
import { DispatchConfirmDialog } from "@/pages/Operations/SackStore/DispatchConfirmDialog";

/**
 * Tam-sayfa sevkiyat detayının sabit başlığı — kimlik (sevkiyat no + statü + ihracat
 * rozeti) + aksiyonlar (Sevk İrsaliyesi; PLANNED ise Sevk Et + İptal Et; DISPATCHED
 * ise Sevki Geri Al). Dialoglar mevcut (Sheet ile paylaşılan) bileşenlerin yeniden
 * kullanımı — "Sevk Et" Sevk Kapısı'nın ORTAK onay dialog'udur (2026-08-22: planlı
 * sevkiyat o ekrana muhtaç olmasın; ekran yalnız sevk onayı bayrağı açıkken menüde).
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
  const [undoOpen, setUndoOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const canCancel = d != null && d.status !== "DISPATCHED" && d.status !== "CANCELLED";
  const canDispatch = d != null && d.status === "PLANNED";
  // Storno yalnız SEVK EDİLMİŞ sevkiyatta anlamlı. Uygunluğun geri kalanı
  // (fatura/iade/aynı gün) backend'in tek kaynağından gelir ve dialog içinde
  // `blockReason` ile söylenir — burada kopyalanmaz.
  const canUndoDispatch = d != null && d.status === "DISPATCHED";

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
              {/* DEFTER BOŞLUĞU (2026-09-06) — mal çıkmış ama sipariş defterine
                  yazılamamış metraj. Bu sayı bugüne kadar YALNIZ audit izindeydi,
                  hiçbir ekranda görünmüyordu; sipariş "Açık" kaldığı için aynı mal
                  yeniden üretime verilebiliyordu. */}
              {d.defterBoslugu != null && d.defterBoslugu > 0.001 && (
                <Badge
                  variant="outline"
                  className="gap-0.5 border-amber-400/60 text-[10px] text-amber-700 dark:text-amber-400"
                  title="Bu metraj sipariş defterine işlenmedi — sipariş 'Açık' kalır. Operasyon → Siparişe Yazılamayanlar ekranından onarılabilir."
                >
                  <AlertTriangle className="h-3 w-3" /> Deftere yazılmayan{" "}
                  {Math.round(d.defterBoslugu)} m
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
              {canDispatch && (
                <PermissionGate permission="shipping:write">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="gap-1"
                    onClick={() => setDispatchOpen(true)}
                  >
                    <Truck className="h-3.5 w-3.5" /> Sevk Et
                  </Button>
                </PermissionGate>
              )}
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
              {canUndoDispatch && (
                <PermissionGate permission="shipping:undo-dispatch">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1 text-destructive hover:text-destructive"
                    onClick={() => setUndoOpen(true)}
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Sevki Geri Al
                  </Button>
                </PermissionGate>
              )}
            </>
          ) : undefined
        }
      />

      <ShipmentDocDialog
        shipmentId={shipmentId}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        shipmentNo={d?.shipmentNo}
        status={d?.status}
        returns={d ? { count: d.summary.returnedCount, meters: d.summary.returnedMeters } : undefined}
      />
      <CancelShipmentDialog
        shipmentId={cancelOpen ? shipmentId : null}
        onOpenChange={(o) => setCancelOpen(o)}
      />
      <UndoDispatchDialog
        shipmentId={undoOpen ? shipmentId : null}
        onOpenChange={(o) => setUndoOpen(o)}
      />
      <DispatchConfirmDialog
        shipment={
          dispatchOpen && d
            ? { id: d.id, shipmentNo: d.shipmentNo, customerName: d.customer.name, branchName: d.branch?.name ?? null }
            : null
        }
        onOpenChange={(o) => setDispatchOpen(o)}
      />
    </>
  );
}
