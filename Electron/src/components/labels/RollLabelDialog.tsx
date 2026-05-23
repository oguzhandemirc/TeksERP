import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, User, Home, Printer, Pencil, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import {
  labelService,
  type LabelNameSource,
  type RollLabelPayload,
} from "@/services/labelService";

interface Props {
  rollId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function RollLabelDialog({ rollId, onOpenChange }: Props) {
  const open = Boolean(rollId);
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();

  const query = useQuery({
    queryKey: ["label-roll", rollId],
    queryFn: () => labelService.getRollLabel(rollId!),
    enabled: open,
  });

  const [editOpen, setEditOpen] = useState(false);

  const printMut = useMutation({
    mutationFn: () => labelService.printRollLabel(rollId!),
    onSuccess: () => {
      toast.success("Etiket basıldı (audit kaydı oluşturuldu).");
    },
  });

  const handlePrint = () => {
    window.print();
    printMut.mutate();
  };

  const payload = query.data?.data;
  const canEdit = Boolean(payload?.orderLineId) && hasPermission("label:edit");
  const canPrint = hasPermission("label:print");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Top Etiketi</DialogTitle>
            <DialogDescription>
              Etiket önizlemesi. Müşteri tarafındaki ad veriler bu siparişe özel veya master alias'tan gelir.
            </DialogDescription>
          </DialogHeader>

          <PermissionGate
            permission="label:read"
            fallback={
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Bu top için etiket görüntüleme yetkisi yok.
              </div>
            }
          >
            {query.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : payload ? (
              <LabelPreview payload={payload} />
            ) : (
              <div className="text-sm text-muted-foreground">Etiket bilgisi bulunamadı.</div>
            )}

            <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                Yetkiler:{" "}
                <span className="font-medium">
                  {canEdit ? "Düzenleme ✓" : "Düzenleme ✗"} ·{" "}
                  {canPrint ? "Basım ✓" : "Basım ✗"}
                </span>
              </div>
              <div className="flex gap-2">
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditOpen(true)}
                    className="gap-1"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Düzenle
                  </Button>
                )}
                {canPrint && payload && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!payload.barcode || printMut.isPending}
                    onClick={handlePrint}
                    className="gap-1"
                  >
                    <Printer className="h-3.5 w-3.5" /> Bas
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                  Kapat
                </Button>
              </div>
            </DialogFooter>
          </PermissionGate>
        </DialogContent>
      </Dialog>

      {payload?.orderLineId && (
        <LabelEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          orderLineId={payload.orderLineId}
          initialItemName={
            payload.itemNameSource === "OVERRIDE" ? payload.itemName : ""
          }
          initialColorName={
            payload.colorNameSource === "OVERRIDE" ? payload.colorName ?? "" : ""
          }
          masterItemName={payload.itemName}
          masterColorName={payload.colorName}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["label-roll", rollId] });
          }}
        />
      )}
    </>
  );
}

const SOURCE_LABELS: Record<LabelNameSource, { icon: typeof Lock; tip: string }> = {
  OVERRIDE: { icon: Lock, tip: "Bu sipariş için sabitlenmiş ad" },
  MASTER: { icon: User, tip: "Müşteri tanımı (master alias)" },
  DEFAULT: { icon: Home, tip: "Standart ad" },
};

function SourceBadge({
  source,
  defaultName,
}: {
  source: LabelNameSource;
  defaultName: string | null;
}) {
  const conf = SOURCE_LABELS[source];
  const Icon = conf.icon;
  return (
    <span
      title={`${conf.tip}${defaultName ? ` (Bizdeki ad: ${defaultName})` : ""}`}
      className="inline-flex items-center gap-1 rounded border px-1 py-0 text-[10px] text-muted-foreground"
    >
      <Icon className="h-2.5 w-2.5" />
      {source}
    </span>
  );
}

function LabelPreview({ payload }: { payload: RollLabelPayload }) {
  return (
    <div className="print-area space-y-3 rounded-lg border bg-background p-4">
      <div className="flex items-start gap-4">
        {payload.barcode && (
          <div className="shrink-0 rounded bg-white p-2">
            <QRCodeSVG value={payload.barcode} size={96} level="M" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          {payload.barcode ? (
            <div className="break-all font-mono text-sm font-semibold">
              {payload.barcode}
            </div>
          ) : (
            <Badge variant="outline">Açık Kumaş — Barkodsuz</Badge>
          )}
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-semibold">{payload.itemName}</span>
            <SourceBadge
              source={payload.itemNameSource}
              defaultName={payload.itemNameDefault}
            />
          </div>
          {payload.colorName && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{payload.colorName}</span>
              {payload.colorNameSource && (
                <SourceBadge
                  source={payload.colorNameSource}
                  defaultName={payload.colorNameDefault}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-3 text-xs sm:grid-cols-4">
        <Field label="En" value={payload.widthCm ? `${payload.widthCm} cm` : "—"} />
        <Field
          label="Metre"
          value={payload.lengthMeters.toLocaleString("tr-TR")}
        />
        <Field
          label="Kalite"
          value={<Badge variant="muted">{payload.qualityGrade}</Badge>}
        />
        <Field
          label="Ağırlık"
          value={payload.weightKg != null ? `${payload.weightKg} kg` : "—"}
        />
      </div>

      {payload.customerName && (
        <div className="border-t pt-3 text-xs">
          <div className="text-muted-foreground">Müşteri</div>
          <div className="font-medium">{payload.customerName}</div>
          {payload.orderNumber && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {payload.orderNumber}
            </div>
          )}
        </div>
      )}

      {payload.ownerCustomerName && (
        <div className="rounded border border-dashed bg-muted/30 p-2 text-xs">
          <span className="font-medium">Fason mal:</span> {payload.ownerCustomerName}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function LabelEditDialog({
  open,
  onOpenChange,
  orderLineId,
  initialItemName,
  initialColorName,
  masterItemName,
  masterColorName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderLineId: string;
  initialItemName: string;
  initialColorName: string;
  masterItemName: string;
  masterColorName: string | null;
  onSaved: () => void;
}) {
  const [itemName, setItemName] = useState(initialItemName);
  const [colorName, setColorName] = useState(initialColorName);

  const mut = useMutation({
    mutationFn: () =>
      labelService.updateOrderLineOverride(orderLineId, {
        customerItemName: itemName.trim() === "" ? null : itemName.trim(),
        customerColorName: colorName.trim() === "" ? null : colorName.trim(),
      }),
    onSuccess: () => {
      toast.success("Etiket adı güncellendi.");
      onSaved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Etiket Adlarını Düzenle</DialogTitle>
          <DialogDescription>
            Bu siparişe özel ad sabitlenir. Boş bırakırsanız master alias veya standart ad'a düşer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Müşterideki ürün adı</label>
            <Input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder={masterItemName}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Boş bırakırsan etiketteki ad "{masterItemName}" olur.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium">Müşterideki renk adı</label>
            <Input
              value={colorName}
              onChange={(e) => setColorName(e.target.value)}
              placeholder={masterColorName ?? "(renk yok)"}
              disabled={!masterColorName}
            />
            {masterColorName && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Boş bırakırsan etiketteki ad "{masterColorName}" olur.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5" /> İptal
          </Button>
          <Button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
