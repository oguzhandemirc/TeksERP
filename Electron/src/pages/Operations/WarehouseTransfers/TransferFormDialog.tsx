import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Package, ListChecks } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMultiWarehouse, WAREHOUSES_QUERY_KEY } from "@/hooks/useWarehouses";
import {
  createTransfer, lookupRollsByBarcodes, lookupSacksByCodes,
  type PickedRoll, type PickedSack,
} from "./service";
import { TransferPickerDialog } from "./TransferPickerDialog";
import { useAttemptToken } from "@/lib/attemptToken";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

export function TransferFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { warehouses } = useMultiWarehouse();
  const qc = useQueryClient();

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [scan, setScan] = useState("");
  const [picked, setPicked] = useState<PickedRoll[]>([]);
  const [pickedSacks, setPickedSacks] = useState<PickedSack[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  /**
   * Okutulan/yapıştırılan kodları çözer (birden fazlası boşlukla): önce TOP
   * araması, topta bulunamayanlar ÇUVAL olarak denenir. "CV ile mi başlıyor"
   * ön ayrımı BİLEREK yok — çuval no elle de verilebiliyor (manualSackNo) ve
   * deseni tahmin etmek elle numaralı çuvalı sessizce "bulunamadı"ya düşürürdü.
   */
  const addM = useMutation({
    mutationFn: async (raw: string) => {
      const codes = raw.split(/[\s,;]+/).filter(Boolean);
      const rolls = await lookupRollsByBarcodes(codes);
      const foundRolls = new Set(rolls.map((r) => r.barcode?.toUpperCase()));
      const rest = codes.filter((c) => !foundRolls.has(c.trim().toUpperCase()));
      const sackRes = rest.length ? await lookupSacksByCodes(rest) : { sacks: [], notFound: [] };
      return { rolls, sacks: sackRes.sacks, notFound: sackRes.notFound };
    },
    onSuccess: ({ rolls, sacks, notFound }) => {
      // Bulunamayan kod SESSİZ GEÇMEZ — operatör hangi kodu okutamadığını bilmeli.
      if (notFound.length) toast.warning(`Bulunamadı: ${notFound.slice(0, 5).join(", ")}`);
      const blocked = sacks.filter((sk) => sk.shipmentAssigned);
      if (blocked.length) {
        toast.warning(`Sevkiyata atanmış çuval taşınamaz: ${blocked.map((b) => b.sackNo).slice(0, 3).join(", ")}`);
      }
      const empty = sacks.filter((sk) => !sk.shipmentAssigned && sk.rollCount === 0);
      if (empty.length) {
        toast.warning(`Boş çuval taşınmaz: ${empty.map((b) => b.sackNo).slice(0, 3).join(", ")} — hedef depoda yeni çuval açın.`);
      }
      setPicked((p) => {
        const seen = new Set(p.map((x) => x.id));
        return [...p, ...rolls.filter((r) => !seen.has(r.id))];
      });
      setPickedSacks((p) => {
        const seen = new Set(p.map((x) => x.id));
        return [...p, ...sacks.filter((sk) => !sk.shipmentAssigned && sk.rollCount > 0 && !seen.has(sk.id))];
      });
      setScan("");
    },
  });

  const attempt = useAttemptToken();
  const createM = useMutation({
    mutationFn: () =>
      createTransfer({
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        rollIds: picked.map((p) => p.id),
        sackIds: pickedSacks.map((sk) => sk.id),
        clientToken: attempt.token(),
      }),
    onError: (e) => attempt.onFailure(e),
    onSuccess: (res) => {
      attempt.onSuccess();
      toast.success(res.message ?? "Transfer tamamlandı.");
      void qc.invalidateQueries({ queryKey: ["warehouse-transfers"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
      setPicked([]);
      setPickedSacks([]);
      setFromId("");
      setToId("");
      onCreated(res.data.id);
    },
  });

  // Kaynak depoda OLMAYAN toplar backend'de zaten reddedilir (atomik: TÜM
  // transfer düşer). Ekranda ÖNCEDEN işaretlemek, operatörün 20 top okutup
  // tek satır yüzünden hepsini kaybetmesini engeller.
  const mismatched = fromId ? picked.filter((p) => p.warehouseId !== fromId) : [];
  // Damgasız (konumu NULL) eski çuval uyarı SAYILMAZ: backend onu transferde
  // sahiplenir (lazy adoption) — üye topları zaten kaynak depoda doğrulanır.
  const mismatchedSacks = fromId ? pickedSacks.filter((sk) => sk.warehouseId !== null && sk.warehouseId !== fromId) : [];
  const totalRollCount = picked.length + pickedSacks.reduce((sum, sk) => sum + sk.rollCount, 0);
  const valid =
    fromId && toId && fromId !== toId && totalRollCount > 0 && mismatched.length === 0 && mismatchedSacks.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Yeni Depo Transferi</DialogTitle>
          <DialogDescription>
            Top barkodu veya çuval kodu okutun. Çuval BÜTÜN taşınır (içindeki tüm toplarla). Biri uygun değilse HİÇBİRİ taşınmaz — yarım transfer olmaz.
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
              {/* BARKODSUZ YOL — okutmanın yerine geçmez, yanına gelir.
                  Çıkan depo seçilmeden açılmaz: liste bir depoya aittir ve
                  "hangi depodan" sorusunu diyaloğun içinde ikinci kez sormak
                  formdaki seçimle çelişirdi. */}
              <Button
                variant="secondary"
                disabled={!fromId}
                title={fromId ? "Çıkan depodaki maldan seç" : "Önce çıkan depoyu seçin"}
                onClick={() => setPickerOpen(true)}
              >
                <ListChecks className="mr-1 h-4 w-4" /> Listeden Seç
              </Button>
            </div>
          </div>

          {mismatchedSacks.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {mismatchedSacks.length} çuval seçilen çıkan depoda DEĞİL (
              {mismatchedSacks.map((sk) => sk.sackNo).slice(0, 3).join(", ")}
              {mismatchedSacks.length > 3 ? "…" : ""}).
            </div>
          )}

          {pickedSacks.length > 0 && (
            <div className="rounded-md border">
              <div className="border-b bg-muted/50 px-2 py-1.5 text-xs font-medium uppercase text-muted-foreground">
                Çuvallar — bütün taşınır (içindeki tüm toplarla)
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {pickedSacks.map((sk) => (
                    <tr key={sk.id} className={`border-t first:border-t-0 ${fromId && sk.warehouseId !== null && sk.warehouseId !== fromId ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}>
                      <td className="p-2">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                          <Package className="h-3.5 w-3.5 text-muted-foreground" />
                          {sk.sackNo}
                        </span>
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {sk.customerName ?? "Genel stok"}
                        {sk.warehouseName ? ` · ${sk.warehouseName}` : " · konum damgasız (ilk transferde sahiplenilir)"}
                      </td>
                      <td className="p-2 text-right tabular-nums">{sk.rollCount} top · {sk.totalQty} m</td>
                      <td className="p-2 text-right">
                        <Button variant="ghost" size="icon" onClick={() => setPickedSacks((x) => x.filter((y) => y.id !== sk.id))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {mismatched.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {mismatched.length} top seçilen çıkan depoda DEĞİL ({mismatched.map((m) => m.barcode).slice(0, 3).join(", ")}
              {mismatched.length > 3 ? "…" : ""}). Transfer bunlar listede olduğu sürece reddedilir.
            </div>
          )}

          <div className="max-h-[35vh] overflow-auto rounded-md border">
            {picked.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {pickedSacks.length > 0 ? "Serbest top yok — yalnız çuval taşınacak." : "Henüz top veya çuval eklenmedi."}
              </p>
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
            {createM.isPending
              ? "Taşınıyor…"
              : `Transferi Yap (${totalRollCount} top${pickedSacks.length > 0 ? `, ${pickedSacks.length} çuval` : ""})`}
          </Button>
        </DialogFooter>
      </DialogContent>
      {/* Koşullu mount: her açılış taze seçim state'i (yarım kalmış işaretler
          bir sonraki açılışa taşınmaz). */}
      {pickerOpen && (
        <TransferPickerDialog
          open
          onOpenChange={setPickerOpen}
          warehouseId={fromId}
          alreadyRollIds={picked.map((r) => r.id)}
          alreadySackIds={pickedSacks.map((s) => s.id)}
          onConfirm={({ rolls, sacks }) => {
            // Mükerrer koruması iki katmanlı: picker zaten seçili olanları
            // listelemiyor, burada da id kümesiyle süzülüyor — aynı topu iki
            // kez eklemek transferi 400'e düşürürdü.
            setPicked((prev) => {
              const seen = new Set(prev.map((r) => r.id));
              return [...prev, ...rolls.filter((r) => !seen.has(r.id))];
            });
            setPickedSacks((prev) => {
              const seen = new Set(prev.map((s) => s.id));
              return [...prev, ...sacks.filter((s) => !seen.has(s.id))];
            });
          }}
        />
      )}
    </Dialog>
  );
}
