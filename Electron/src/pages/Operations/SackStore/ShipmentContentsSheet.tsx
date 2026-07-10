import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package, Scale, Layers, Truck, Globe, Pencil, Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { SackList } from "@/pages/Operations/SackContentEdit/SackList";
import { useShipmentDetail } from "@/pages/Operations/SackContentEdit/useShipmentDetail";
import { sackStoreService } from "./service";
import {
  sackStoreStatusLabels,
  destinationLabels,
  type SackStoreShipment,
  type ShipmentDestination,
} from "./types";

const fmtKg = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });
const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });

interface Props {
  /** Açılan sevkiyat (board kartı) — null ise sheet kapalı. */
  shipment: SackStoreShipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Çuval Depo board kartına tıklayınca açılan slide-over. Sevkiyatın çuval+rulo
 * dökümünü LAZY çeker (board listesi rulo taşımaz). Tek sevkiyat = sınırlı kapsam.
 */
export function ShipmentContentsSheet({ shipment, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  // Düzenlenebilir içerik için tam sevkiyat detayı (Çuval Düzelt ile ortak kaynak).
  const query = useShipmentDetail(open && shipment ? shipment.id : null);
  const detail = query.data?.data;

  // Kapıda içerik düzeltme "Düzelt" toggle'ı arkasında — kazara top çıkarıp
  // tartı sıfırlatma vakalarını azaltır. Büyük düzeltmenin yolu Hazırlığa Geri
  // Al → Paketleme'dir; bu toggle son-dakika küçük düzeltme içindir.
  const [editMode, setEditMode] = useState(false);
  useEffect(() => {
    setEditMode(false);
  }, [shipment?.id]);

  const invalidateBoard = () => {
    void qc.invalidateQueries({ queryKey: ["sack-store"] });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{shipment?.shipmentNo}</span>
            {shipment && (
              <Badge variant="outline" className="text-[10px]">
                {sackStoreStatusLabels[shipment.status]}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {shipment?.customer.name}
            {shipment?.branch ? ` · ${shipment.branch.name}` : ""}
          </SheetDescription>
        </SheetHeader>

        {shipment && (
          <div className="mt-4 space-y-4">
            {/* Saha #19+#21+#22: yurtiçi/yurtdışı + prosedür kodu (board'dan düzenlenebilir) */}
            <DestinationProcedureEditor shipment={shipment} onMutated={invalidateBoard} />

            {/* Özet sayaçlar + taşıma bilgisi */}
            <div className="grid grid-cols-3 gap-2">
              <SummaryStat icon={Package} label="Çuval" value={fmtInt(shipment.sackCount)} />
              <SummaryStat icon={Scale} label="Kg" value={fmtKg(shipment.totalKg)} />
              <SummaryStat icon={Layers} label="Metraj" value={`${fmtM(shipment.totalQty)} m`} />
            </div>

            {detail && (detail.plateNumber || detail.driverName || detail.carrier) && (
              <Card>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-xs">
                  <span className="flex items-center gap-1 font-medium text-muted-foreground">
                    <Truck className="h-3.5 w-3.5" /> Taşıma
                  </span>
                  {detail.plateNumber && <span className="font-mono">{detail.plateNumber}</span>}
                  {detail.driverName && <span>{detail.driverName}</span>}
                  {detail.carrier && <span className="text-muted-foreground">{detail.carrier}</span>}
                </CardContent>
              </Card>
            )}

            {/* Çuvallar → içindeki toplar; düzeltme aksiyonları toggle arkasında */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Çuvallar</p>
              <PermissionGate permission="shipping:write">
                <Button
                  type="button"
                  variant={editMode ? "secondary" : "outline"}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setEditMode((v) => !v)}
                >
                  <Pencil className="h-3 w-3" />
                  {editMode ? "Düzeltmeyi Kapat" : "Düzelt"}
                </Button>
              </PermissionGate>
            </div>
            {query.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : detail ? (
              <SackList detail={detail} editLocked={!editMode} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">İçerik yüklenemedi.</p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Saha #19+#21: yurtiçi/yurtdışı toggle + prosedür/ihracat kodu düzenleme.
 * Board kartından açılan slide-over içinde; sevk edilmemiş her durumda serbest.
 */
function DestinationProcedureEditor({
  shipment,
  onMutated,
}: {
  shipment: SackStoreShipment;
  onMutated: () => void;
}) {
  const [editingCode, setEditingCode] = useState(false);
  const [code, setCode] = useState(shipment.procedureCode ?? "");
  useEffect(() => {
    setCode(shipment.procedureCode ?? "");
    setEditingCode(false);
  }, [shipment.id, shipment.procedureCode]);

  const destMut = useMutation({
    mutationFn: (d: ShipmentDestination) => sackStoreService.setDestination(shipment.id, d),
    onSuccess: (res) => {
      toast.success(res.message ?? "Güncellendi");
      onMutated();
    },
  });
  const codeMut = useMutation({
    mutationFn: (c: string | null) => sackStoreService.setProcedureCode(shipment.id, c),
    onSuccess: (res) => {
      toast.success(res.message ?? "Güncellendi");
      setEditingCode(false);
      onMutated();
    },
  });

  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 font-medium text-muted-foreground">
            <Globe className="h-3.5 w-3.5" /> Kapsam
          </span>
          <PermissionGate
            permission="shipping:write"
            fallback={<Badge variant="outline">{destinationLabels[shipment.destination]}</Badge>}
          >
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {(["DOMESTIC", "EXPORT"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={destMut.isPending}
                  onClick={() => shipment.destination !== d && destMut.mutate(d)}
                  className={cn(
                    "rounded px-2 py-0.5 font-medium transition-colors",
                    shipment.destination === d
                      ? d === "EXPORT"
                        ? "bg-sky-600 text-white"
                        : "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {destinationLabels[d]}
                </button>
              ))}
            </div>
          </PermissionGate>
          {shipment.destination === "EXPORT" && (
            <span className="text-[10px] text-muted-foreground">(çuval tartısı zorunlu)</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="font-medium text-muted-foreground">Prosedür / İhracat No</span>
          <PermissionGate
            permission="shipping:write"
            fallback={
              <span className="font-mono">
                {shipment.procedureCode || shipment.branch?.code || shipment.customer.code || "—"}
              </span>
            }
          >
            {editingCode ? (
              <span className="flex items-center gap-1">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="örn. gümrük beyanname no"
                  className="h-7 w-48 font-mono text-xs"
                  maxLength={64}
                  autoFocus
                />
                <Button
                  size="icon"
                  className="h-7 w-7"
                  disabled={codeMut.isPending}
                  onClick={() => codeMut.mutate(code.trim() || null)}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setEditingCode(true)}
                className="flex items-center gap-1 font-mono hover:text-primary"
              >
                {shipment.procedureCode || (
                  <span className="italic text-muted-foreground">
                    {shipment.branch?.code || shipment.customer.code || "kod yok"} (varsayılan)
                  </span>
                )}
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </PermissionGate>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryStat({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="rounded border bg-card p-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
