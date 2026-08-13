import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { customerService } from "@/pages/Customers/service";
import { useMultiWarehouse, useDefaultWarehouse, WAREHOUSES_QUERY_KEY } from "@/hooks/useWarehouses";
import type { Item } from "@/pages/Items/types";
import type { Color } from "@/pages/Colors/types";
import type { Customer } from "@/pages/Customers/types";
import { createGoodsReceipt, type GoodsReceiptLineInput } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

interface DraftLine extends GoodsReceiptLineInput {
  key: string;
}

function emptyLine(): DraftLine {
  return { key: crypto.randomUUID(), itemId: "", colorId: null, initialQty: 0, width: null };
}

export function GoodsReceiptFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const defaultWarehouse = useDefaultWarehouse();
  const qc = useQueryClient();

  const [warehouseId, setWarehouseId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [deliveryNoteNo, setDeliveryNoteNo] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  // ⚠️ TEK DEPOLU KURULUMDA SEÇİCİ ÇİZİLMEZ — depo otomatik varsayılandır.
  // Kullanıcıya tek seçenekli bir liste göstermek, cevabı belli bir soruyu
  // sormaktır (mobil `PlaceActions` kuralının aynısı).
  const effectiveWarehouseId = multiWarehouse ? warehouseId : (defaultWarehouse?.id ?? "");

  const valid = useMemo(
    () => Boolean(effectiveWarehouseId) && lines.some((l) => l.itemId && l.initialQty > 0),
    [effectiveWarehouseId, lines],
  );

  const createM = useMutation({
    mutationFn: () =>
      createGoodsReceipt({
        warehouseId: effectiveWarehouseId,
        supplierId,
        deliveryNoteNo: deliveryNoteNo || null,
        // Fişin KENDİ idempotency anahtarı — çift tıklama ikinci fiş açmaz.
        clientToken: crypto.randomUUID(),
        lines: lines
          .filter((l) => l.itemId && l.initialQty > 0)
          .map(({ key, ...l }) => ({ ...l, clientToken: key })),
      }),
    onSuccess: (res) => {
      // Atlanan satır varsa SESSİZ GEÇME — sebebiyle söyle.
      const failed = res.data.failed ?? [];
      if (failed.length > 0) {
        toast.warning(`${failed.length} satır atlandı: ${failed.map((f) => f.reason).slice(0, 2).join(" · ")}`);
      } else {
        toast.success(res.message ?? "Mal kabul fişi oluşturuldu.");
      }
      void qc.invalidateQueries({ queryKey: ["goods-receipts"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
      setLines([emptyLine()]);
      setDeliveryNoteNo("");
      setSupplierId(null);
      onCreated(res.data.id);
    },
  });

  const patch = (key: string, p: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Yeni Mal Kabul</DialogTitle>
          <DialogDescription>
            Tedarikçiden gelen mal depoya alınır; her satır bir TOP olarak doğar ve barkod + etiket üretilir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {multiWarehouse && (
              <div>
                <Label>Depo</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                >
                  <option value="">Depo seçin…</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label>Tedarikçi (opsiyonel)</Label>
              <div className="mt-1">
                <ReferenceSelect<Customer>
                  value={supplierId}
                  onChange={setSupplierId}
                  service={customerService}
                  queryKey="customers"
                  getLabel={(c) => `${c.code} — ${c.name}`}
                  placeholder="Tedarikçi ara..."
                />
              </div>
            </div>
            <div>
              <Label>Tedarikçi İrsaliye No (opsiyonel)</Label>
              <Input
                className="mt-1"
                value={deliveryNoteNo}
                onChange={(e) => setDeliveryNoteNo(e.target.value)}
                placeholder="IRS-..."
              />
            </div>
          </div>

          <div className="rounded-md border">
            <div className="grid grid-cols-[1fr_180px_110px_110px_40px] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
              <span>Kumaş</span>
              <span>Renk</span>
              <span>Metre</span>
              <span>En (cm)</span>
              <span />
            </div>
            <div className="max-h-[40vh] space-y-2 overflow-auto p-3">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-[1fr_180px_110px_110px_40px] items-center gap-2">
                  <ReferenceSelect<Item>
                    value={l.itemId || null}
                    onChange={(v) => patch(l.key, { itemId: v ?? "" })}
                    service={itemService}
                    queryKey="items"
                    getLabel={(it) => `${it.code} — ${it.name}`}
                    placeholder="Kumaş ara..."
                  />
                  <ReferenceSelect<Color>
                    value={l.colorId ?? null}
                    onChange={(v) => patch(l.key, { colorId: v })}
                    service={colorService}
                    queryKey="colors"
                    getLabel={(c) => c.name}
                    placeholder="Renk..."
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.initialQty || ""}
                    onChange={(e) => patch(l.key, { initialQty: Number(e.target.value) })}
                  />
                  <Input
                    type="number"
                    min={0}
                    value={l.width ?? ""}
                    onChange={(e) => patch(l.key, { width: e.target.value ? Number(e.target.value) : null })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="border-t p-2">
              <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                <Plus className="mr-1 h-4 w-4" />
                Satır ekle
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button disabled={!valid || createM.isPending} onClick={() => createM.mutate()}>
            {createM.isPending ? "Kaydediliyor…" : "Fişi Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
