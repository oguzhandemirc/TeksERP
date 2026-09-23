import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package, Scale, Layers, Truck, Pencil, Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { sackStoreService } from "./service";
import { ShipmentSackReadonly } from "./ShipmentSackReadonly";
import { ShipmentDestinationAlign } from "./ShipmentDestinationAlign";
import {
  sackStoreStatusLabels,
  type ContentSack,
  type SackStoreShipment,
} from "./types";
import { PROCEDURE_CODE_BOS, procedureCodeView } from "./procedureCode";

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
 * Sevk Kapısı board kartına tıklayınca açılan slide-over. Sevkiyatın çuval+top
 * dökümünü LAZY çeker (`sack-contents`) ve SALT-OKUNUR gösterir — içerik düzenleme
 * (rol çıkar/taşı) Paketleme havuz ekranındadır. PLANNED sevkiyatta her çuval
 * havuza geri çıkarılabilir ("Çuval Çıkar"). destination/procedure buradan düzenlenir.
 */
export function ShipmentContentsSheet({ shipment, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["sack-store", "contents", shipment?.id],
    queryFn: () => sackStoreService.shipmentContents(shipment!.id),
    enabled: open && !!shipment,
  });
  const contents = query.data?.data;
  const isPlanned = shipment?.status === "PLANNED";

  // Çuval çıkarma yıkıcı-benzeri (sevkiyattan çıkar, havuza döner) → somut onay.
  const [pendingRemove, setPendingRemove] = useState<ContentSack | null>(null);
  useEffect(() => {
    setPendingRemove(null);
  }, [shipment?.id]);

  const removeMut = useMutation({
    mutationFn: (sackId: string) => sackStoreService.removeSack(shipment!.id, sackId),
    onSuccess: () => {
      toast.success("Çuval sevkiyattan çıkarıldı — havuza döndü");
      // Çuval havuza döner; board sayaçları + havuz + arama + sevkiyat tazelensin.
      void qc.invalidateQueries({ queryKey: ["sack-store"] });
      void qc.invalidateQueries({ queryKey: ["pool"] });
      void qc.invalidateQueries({ queryKey: ["sack-search"] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      if (shipment) void qc.invalidateQueries({ queryKey: ["shipment-detail", shipment.id] });
      setPendingRemove(null);
    },
  });

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

            {contents && (contents.plateNumber || contents.driverName || contents.carrier) && (
              <Card>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-xs">
                  <span className="flex items-center gap-1 font-medium text-muted-foreground">
                    <Truck className="h-3.5 w-3.5" /> Taşıma
                  </span>
                  {contents.plateNumber && <span className="font-mono">{contents.plateNumber}</span>}
                  {contents.driverName && <span>{contents.driverName}</span>}
                  {contents.carrier && <span className="text-muted-foreground">{contents.carrier}</span>}
                </CardContent>
              </Card>
            )}

            {/* Çuvallar → içindeki toplar (salt-okunur; PLANNED'de çuval çıkarılabilir) */}
            <p className="text-xs font-medium text-muted-foreground">Çuvallar</p>
            {query.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : contents && contents.sacks.length > 0 ? (
              <div className="space-y-2">
                {contents.sacks.map((sk) => (
                  <ShipmentSackReadonly
                    key={sk.id}
                    sack={sk}
                    canRemove={!!isPlanned}
                    removing={removeMut.isPending && pendingRemove?.id === sk.id}
                    onRemove={setPendingRemove}
                  />
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">İçerik yüklenemedi.</p>
            )}
          </div>
        )}

        <ConfirmDialog
          open={pendingRemove !== null}
          onOpenChange={(o) => !o && !removeMut.isPending && setPendingRemove(null)}
          title={pendingRemove ? `${pendingRemove.sackNo} sevkiyattan çıkarılsın mı?` : ""}
          description="Çuval bu sevkiyattan çıkarılır ve çuval havuzuna geri döner; sevkiyatta kalan çuvallarla karşılanma yeniden hesaplanır."
          confirmLabel="Çuval Çıkar"
          destructive
          isPending={removeMut.isPending}
          onConfirm={() => {
            if (pendingRemove) removeMut.mutate(pendingRemove.id);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

/**
 * Saha #19+#21: yurtiçi/yurtdışı (cariden/şubeden kilitli — ShipmentDestinationAlign) +
 * prosedür/ihracat kodu düzenleme. Board kartından açılan slide-over içinde.
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

  const gumruk = procedureCodeView(shipment);

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
          <span className="font-medium text-muted-foreground">Kapsam</span>
          <ShipmentDestinationAlign shipment={shipment} onMutated={onMutated} />
          {shipment.destination === "EXPORT" && (
            <span className="text-[10px] text-muted-foreground">(çuval tartısı zorunlu)</span>
          )}
        </div>

        {/* Yalnız YURTDIŞI (carinin ihracat kodu alanıyla aynı yüklem); yedek değer uydurulmaz. */}
        {gumruk.goster && (
        <div className="flex items-center gap-2">
          <span className="font-medium text-muted-foreground">Gümrük/İhracat No</span>
          <PermissionGate
            permission="shipping:write"
            fallback={
              <span className="font-mono">{gumruk.deger ?? PROCEDURE_CODE_BOS}</span>
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
                {gumruk.deger ?? <span className="italic text-muted-foreground">{PROCEDURE_CODE_BOS}</span>}
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </PermissionGate>
        </div>
        )}
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
