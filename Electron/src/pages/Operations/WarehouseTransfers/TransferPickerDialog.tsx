// =============================================================================
// TRANSFER — "LİSTEDEN SEÇ" (barkodsuz yol)
// =============================================================================
// Transferin tek girişi barkod okutmak/yapıştırmaktı; etiket basmayan
// kullanıcı (alım-satım personası) bu ekranı fiilen kullanamıyordu.
//
// ⚠️ OKUTMA YOLU KALDIRILMADI. Bu İKİNCİ bir kapı: fiziksel etiketle çalışan
// depocu için okutmak hâlâ en hızlı yol ve elindeki maldan emin olmasını
// sağlar. Yeni yol onu YAVAŞLATMAMALI — bu yüzden ayrı diyalog, ayrı düğme.
//
// ⚠️ SEÇİM KİMLİĞİ id'dir, barkod değil: liste barkodsuz topu da gösterir ve
// seçtirir (etiket hiç basılmamış olabilir).
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Layers, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { listWarehouseRolls, listWarehouseSacks, type PickedRoll, type PickedSack } from "./service";
import { RollChecklist, toggleInSet } from "@/components/operations/roll-picker/RollChecklist";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kaynak depo — seçilmeden bu diyalog açılmaz (transfer bir depodan çıkar). */
  warehouseId: string;
  /** Formda zaten seçili olanlar — listede işaretli ve tekrar eklenmez. */
  alreadyRollIds: string[];
  alreadySackIds: string[];
  onConfirm: (picked: { rolls: PickedRoll[]; sacks: PickedSack[] }) => void;
}

export function TransferPickerDialog({
  open, onOpenChange, warehouseId, alreadyRollIds, alreadySackIds, onConfirm,
}: Props) {
  const [search, setSearch] = useState("");
  const [rollSel, setRollSel] = useState<Set<string>>(new Set());
  const [sackSel, setSackSel] = useState<Set<string>>(new Set());

  const rollsQ = useQuery({
    queryKey: ["transfer-pick-rolls", warehouseId, search],
    queryFn: () => listWarehouseRolls({ warehouseId, search: search || undefined }),
    enabled: open && Boolean(warehouseId),
  });
  const sacksQ = useQuery({
    queryKey: ["transfer-pick-sacks", warehouseId, search],
    queryFn: () => listWarehouseSacks({ warehouseId, search: search || undefined }),
    enabled: open && Boolean(warehouseId),
  });

  const rolls = (rollsQ.data ?? []).filter((r) => !alreadyRollIds.includes(r.id));
  const sacks = (sacksQ.data ?? []).filter((s) => !alreadySackIds.includes(s.id));
  const total = rollSel.size + sackSel.size;

  const confirm = () => {
    onConfirm({
      rolls: rolls.filter((r) => rollSel.has(r.id)),
      sacks: sacks.filter((s) => sackSel.has(s.id)),
    });
    setRollSel(new Set());
    setSackSel(new Set());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Listeden Seç</DialogTitle>
          <DialogDescription>
            Çıkan depodaki mallar. Barkod okutmanız gerekmez — işaretleyip ekleyin.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Kumaş / renk / kod ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Tabs defaultValue="rolls">
          <TabsList>
            <TabsTrigger value="rolls" className="gap-1.5">
              <Package className="h-4 w-4" /> Toplar ({rolls.length})
            </TabsTrigger>
            <TabsTrigger value="sacks" className="gap-1.5">
              <Layers className="h-4 w-4" /> Çuvallar ({sacks.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rolls">
            <RollChecklist
              rolls={rolls}
              selected={rollSel}
              onToggle={(id) => setRollSel((s) => toggleInSet(s, id))}
              loading={rollsQ.isLoading}
              emptyText="Bu depoda transfer edilebilir top bulunamadı."
            />
          </TabsContent>

          <TabsContent value="sacks">
            <div className="max-h-[42vh] overflow-auto rounded-md border">
              {sacksQ.isLoading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
              ) : sacks.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Bu depoda taşınabilir çuval yok. (Sevkiyata atanmış çuvallar listelenmez.)
                </p>
              ) : (
                sacks.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={sackSel.has(s.id)}
                      onCheckedChange={() => setSackSel((x) => toggleInSet(x, s.id))}
                    />
                    <span className="font-mono">{s.sackNo}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {s.customerName ?? "—"}
                    </span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {s.rollCount} top · {s.totalQty} m
                    </span>
                  </label>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button disabled={total === 0} onClick={confirm}>
            Ekle ({total})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
