// =============================================================================
// YENİ SAYIM — depo seçimi + fotoğraf
// =============================================================================
// ⚠️ SAYIM AÇMAK YIKICI DEĞİLDİR ve diyalog bunu AÇIKÇA söyler. Kullanıcı bu
// ekrandan geri döndüğünde "acaba bir şey mi sildim" diye düşünmemeli: açılış
// yalnız defterin o anki FOTOĞRAFINI satırlara yazar. Yıkıcı olan adım
// "Tamamla"dır ve onun kendi onay ekranı var.
//
// ⚠️ DEPO SEÇİCİ TEK DEPOLU KURULUMDA ÇİZİLMEZ (`useMultiWarehouse` — "fabrikada
// sıfır görünür fark" kuralının arayüz ayağı): seçilecek ikinci depo yokken
// seçici yalnız gürültüdür ve "yanlış depoyu seçtim" hatasının kapısını açar.
// Tek depoda hedef GÖRÜNÜR biçimde yazılır (gizli varsayılan değil).
// =============================================================================
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDefaultWarehouse, useMultiWarehouse } from "@/hooks/useWarehouses";
import { createStockCount } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

export function NewStockCountDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const fallback = useDefaultWarehouse();
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");

  // Tek depolu kurulumda hedef seçilmez, ÇÖZÜLÜR. Depo listesi geç gelirse
  // (ilk açılış) effect onu yakalar; aksi halde düğme sebepsiz kapalı kalırdı.
  useEffect(() => {
    if (!open) return;
    if (!multiWarehouse && fallback && !warehouseId) setWarehouseId(fallback.id);
  }, [open, multiWarehouse, fallback, warehouseId]);

  const createM = useMutation({
    mutationFn: () => createStockCount({ warehouseId, notes: notes.trim() || null }),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.countNo} açıldı.`);
      void qc.invalidateQueries({ queryKey: ["stock-counts"] });
      setNotes("");
      onOpenChange(false);
      onCreated(res.data.id);
    },
  });

  const target = warehouses.find((w) => w.id === warehouseId) ?? fallback;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni stok sayımı</DialogTitle>
          <DialogDescription>
            Seçilen deponun o anki içeriği satır satır donar: sayılabilir toplar (ham stok, bitmiş
            depo, 2. kalite) ve sıfır olmayan iplik bakiyeleri.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {multiWarehouse ? (
            <div>
              <Label htmlFor="sc-warehouse">Sayılacak depo</Label>
              <select
                id="sc-warehouse"
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
          ) : (
            <p className="text-sm">
              Sayılacak depo: <b>{target?.name ?? "—"}</b>
            </p>
          )}

          <div>
            <Label htmlFor="sc-notes">Not (opsiyonel)</Label>
            <Textarea
              id="sc-notes"
              className="mt-1"
              rows={2}
              maxLength={500}
              placeholder="Örn. yıl sonu sayımı, A rafı — vardiya 2."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Not, sayım tutanağının üzerine basılır.
            </p>
          </div>

          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Sayım açmak hiçbir deftere yazmaz — stok, bakiye ve belgeler olduğu gibi kalır. Fark
              yalnız “Tamamla” adımında kaydedilir. Aynı depoda aynı anda tek bir açık sayım olabilir.
            </span>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!warehouseId || createM.isPending} onClick={() => createM.mutate()}>
            {createM.isPending ? "Açılıyor…" : "Sayımı Aç"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
