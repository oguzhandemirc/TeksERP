import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Pencil, X, UserX } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { labelService } from "@/services/labelService";

interface Props {
  rollId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Bir etiket HTML string'ini görünmez geçici iframe'e basıp yazıcıya gönderir —
 * görünür önizlemeyi bozmadan "Müşterisiz (Stok)" tek-dokunuş baskısı için.
 * print() dialog kapanana kadar bloklar; ardından iframe temizlenir.
 */
function printHtmlString(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    frame.srcdoc = html;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        window.setTimeout(() => frame.remove(), 300);
        resolve();
      }
    };
    document.body.appendChild(frame);
  });
}

export function RollLabelDialog({ rollId, onOpenChange }: Props) {
  const open = Boolean(rollId);
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Payload — orderLineId (Edit gating) ve LabelEditDialog için master adlar.
  const payloadQuery = useQuery({
    queryKey: ["label-roll", rollId],
    queryFn: () => labelService.getRollLabel(rollId!),
    enabled: open,
  });

  // Etiket HTML'i — backend LabelTemplate config'iyle render edilir; mobil
  // basımı ve LabelTemplates önizlemesiyle birebir aynı çıktı.
  const htmlQuery = useQuery({
    queryKey: ["label-roll-html", rollId],
    queryFn: () => labelService.getRollLabelHtml(rollId!),
    enabled: open,
    staleTime: 0,
  });

  const [editOpen, setEditOpen] = useState(false);

  const printMut = useMutation({
    mutationFn: () => labelService.printRollLabel(rollId!),
    onSuccess: () => {
      toast.success("Etiket basıldı (audit kaydı oluşturuldu).");
    },
  });

  const handlePrint = () => {
    iframeRef.current?.contentWindow?.print();
    printMut.mutate();
  };

  // "Müşterisiz (Stok)" — müşteri bilgisi OLMADAN (stok) etiketi tek dokunuşta bas.
  // Görünür önizlemeyi değiştirmeden stok HTML'ini ayrı çeker + basar; backend
  // snapshot'ı stok işaretler (varsa bozuk müşteri snapshot'ı düzelir). Sonra
  // önizleme tazelenir → müşterisiz hâli yansır.
  const printStockMut = useMutation({
    mutationFn: async () => {
      const html = await labelService.getRollLabelHtml(rollId!, { stock: true });
      await printHtmlString(html);
      await labelService.printRollLabel(rollId!, { stock: true });
    },
    onSuccess: () => {
      toast.success("Müşterisiz (stok) etiketi basıldı.");
      void qc.invalidateQueries({ queryKey: ["label-roll", rollId] });
      void qc.invalidateQueries({ queryKey: ["label-roll-html", rollId] });
    },
    onError: (e: Error) => toast.error(`Basılamadı: ${e.message}`),
  });

  const payload = payloadQuery.data?.data;
  const canEdit = Boolean(payload?.orderLineId) && hasPermission("label:edit");
  const canPrint = hasPermission("label:print");
  const hasBarcode = Boolean(payload?.barcode);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Top Etiketi</DialogTitle>
            <DialogDescription>
              Bas tuşuna basınca bu etiket olduğu gibi yazıcıya gider.
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
            {htmlQuery.isLoading ? (
              <Skeleton className="h-[640px] w-full" />
            ) : htmlQuery.isError ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">
                Etiket alınamadı: {(htmlQuery.error as Error).message}
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                title="Top etiketi"
                srcDoc={htmlQuery.data ?? ""}
                sandbox="allow-same-origin allow-modals"
                className="h-[640px] w-full rounded border bg-white"
              />
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
                    variant="outline"
                    title="Müşteri bilgisi olmadan (stok) etiketi bas"
                    disabled={!hasBarcode || htmlQuery.isLoading || printStockMut.isPending}
                    onClick={() => printStockMut.mutate()}
                    className="gap-1"
                  >
                    <UserX className="h-3.5 w-3.5" /> Müşterisiz (Stok)
                  </Button>
                )}
                {canPrint && payload && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!hasBarcode || htmlQuery.isLoading || printMut.isPending}
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
            void qc.invalidateQueries({ queryKey: ["label-roll-html", rollId] });
          }}
        />
      )}
    </>
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
