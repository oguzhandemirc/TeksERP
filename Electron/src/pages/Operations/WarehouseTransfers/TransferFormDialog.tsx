import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMultiWarehouse, WAREHOUSES_QUERY_KEY } from "@/hooks/useWarehouses";
import { createTransfer, lookupRollsByBarcodes } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

interface PickedRoll {
  id: string;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  qty: number;
  warehouseId: string | null;
  status: string;
}

export function TransferFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { warehouses } = useMultiWarehouse();
  const qc = useQueryClient();

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [scan, setScan] = useState("");
  const [picked, setPicked] = useState<PickedRoll[]>([]);

  /** Okutulan/yapıştırılan barkodları topa çevirir (birden fazlası boşlukla). */
  const addM = useMutation({
    mutationFn: (raw: string) => lookupRollsByBarcodes(raw.split(/[\s,;]+/).filter(Boolean)),
    onSuccess: (rows, raw) => {
      const requested = raw.split(/[\s,;]+/).filter(Boolean);
      const found = new Set(rows.map((r) => r.barcode?.toUpperCase()));
      const missing = requested.filter((b) => !found.has(b.trim().toUpperCase()));
      // Bulunamayan barkod SESSİZ GEÇMEZ — operatör hangi topu okutamadığını bilmeli.
      if (missing.length) toast.warning(`Bulunamadı: ${missing.slice(0, 5).join(", ")}`);
      setPicked((p) => {
        const seen = new Set(p.map((x) => x.id));
        return [...p, ...rows.filter((r) => !seen.has(r.id))];
      });
      setScan("");
    },
  });

  const createM = useMutation({
    mutationFn: () =>
      createTransfer({
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        rollIds: picked.map((p) => p.id),
        clientToken: crypto.randomUUID(),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Transfer tamamlandı.");
      void qc.invalidateQueries({ queryKey: ["warehouse-transfers"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
      setPicked([]);
      setFromId("");
      setToId("");
      onCreated(res.data.id);
    },
  });

  // Kaynak depoda OLMAYAN toplar backend'de zaten reddedilir (atomik: TÜM
  // transfer düşer). Ekranda ÖNCEDEN işaretlemek, operatörün 20 top okutup
  // tek satır yüzünden hepsini kaybetmesini engeller.
  const mismatched = fromId ? picked.filter((p) => p.warehouseId !== fromId) : [];
  const valid = fromId && toId && fromId !== toId && picked.length > 0 && mismatched.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Yeni Depo Transferi</DialogTitle>
          <DialogDescription>
            Toplar tek işlemde taşınır — biri uygun değilse HİÇBİRİ taşınmaz (yarım transfer olmaz).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Çıkan Depo</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
              >
                <option value="">Seçin…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Giren Depo</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
              >
                <option value="">Seçin…</option>
                {warehouses.filter((w) => w.id !== fromId).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label>Barkod okut / yapıştır</Label>
            <div className="mt-1 flex gap-2">
              <Input
                value={scan}
                autoFocus
                placeholder="Barkodu okutun veya birden fazlasını boşlukla yapıştırın"
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && scan.trim()) {
                    e.preventDefault();
                    addM.mutate(scan.trim());
                  }
                }}
              />
              <Button variant="outline" disabled={!scan.trim() || addM.isPending} onClick={() => addM.mutate(scan.trim())}>
                Ekle
              </Button>
            </div>
          </div>

          {mismatched.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {mismatched.length} top seçilen çıkan depoda DEĞİL ({mismatched.map((m) => m.barcode).slice(0, 3).join(", ")}
              {mismatched.length > 3 ? "…" : ""}). Transfer bunlar listede olduğu sürece reddedilir.
            </div>
          )}

          <div className="max-h-[35vh] overflow-auto rounded-md border">
            {picked.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Henüz top eklenmedi.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Barkod</th>
                    <th className="p-2 text-left">Ürün / Renk</th>
                    <th className="p-2 text-right">Metre</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {picked.map((p) => (
                    <tr key={p.id} className={`border-t ${fromId && p.warehouseId !== fromId ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}>
                      <td className="p-2 font-mono text-xs">{p.barcode}</td>
                      <td className="p-2">{p.itemName}{p.colorName ? ` · ${p.colorName}` : ""}</td>
                      <td className="p-2 text-right tabular-nums">{p.qty}</td>
                      <td className="p-2 text-right">
                        <Button variant="ghost" size="icon" onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button disabled={!valid || createM.isPending} onClick={() => createM.mutate()}>
            {createM.isPending ? "Taşınıyor…" : `Transferi Yap (${picked.length} top)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
