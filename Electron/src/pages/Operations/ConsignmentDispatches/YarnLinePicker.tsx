// İplik kalemi: önce lot seçici (doğrudan modal), sonra depo + kg. YARN kaleminde lot ZORUNLU (sözleşme + DB CHECK);
// bakiye lot × depo düzeyinde sunucu önizlemesinde ölçülür (yetmezse satır engelli işaretlenir).
import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { useDefaultWarehouse, useMultiWarehouse } from "@/hooks/useWarehouses";
import { listYarnLots, type YarnLotRow } from "@/pages/Operations/Yarn/service";
import { cn } from "@/lib/utils";
import type { Warehouse } from "@/pages/Warehouses/types";
import { OwnedPickerDialog } from "./OwnedPickerDialog";
import { fmtNum, parseKg } from "./consignmentText";
import type { DraftItem } from "./draft";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ownerCustomerId: string;
  onPick: (item: DraftItem) => void;
}

export function lotDisabledReason(l: YarnLotRow, ownerCustomerId: string): string | null {
  if (!l.ownerCustomerId) return "Bizim lot — emanet değil, sahibine çıkışı olmaz";
  if (l.ownerCustomerId !== ownerCustomerId) return `Sahibi başka müşteri: ${l.ownerCustomer?.name ?? "—"}`;
  if (!(l.balanceKg > 0)) return "Lotun bakiyesi yok";
  return null;
}

export function YarnLinePicker({ open, onOpenChange, ownerCustomerId, onPick }: Props) {
  const [lot, setLot] = useState<YarnLotRow | null>(null);
  const close = () => {
    setLot(null);
    onOpenChange(false);
  };
  return (
    <>
      <OwnedPickerDialog<YarnLotRow>
        open={open && !lot}
        onOpenChange={(o) => !o && close()}
        title="İplik lotu seç"
        description="Emanet iplik lotları. Yalnız seçili müşterinin lotu seçilebilir; sonra depo ve kg girilir."
        queryKey={["yarn", "lots", "consignment-picker"]}
        fetchPage={async (cursor, search) => {
          const r = await listYarnLots({
            limit: 50,
            cursor: cursor ?? undefined,
            search: search || undefined,
            isActive: true,
          });
          return { rows: r.data, nextCursor: r.pagination.nextCursor };
        }}
        renderRow={(l) => (
          <>
            <span className="font-medium">Lot {l.lotNo}</span>
            <span className="text-xs text-muted-foreground">
              {l.item.name} · {fmtNum(l.balanceKg)} kg · {l.ownerCustomer?.name ?? "Bizim"}
            </span>
          </>
        )}
        disabledReason={(l) => lotDisabledReason(l, ownerCustomerId)}
        onPick={setLot}
        emptyText="Aktif iplik lotu yok."
      />
      {lot && (
        <QtyDialog
          lot={lot}
          onCancel={() => setLot(null)}
          onDone={(it) => {
            onPick(it);
            close();
          }}
        />
      )}
    </>
  );
}

function QtyDialog({
  lot,
  onCancel,
  onDone,
}: {
  lot: YarnLotRow;
  onCancel: () => void;
  onDone: (it: DraftItem) => void;
}) {
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const fallback = useDefaultWarehouse();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [kgRaw, setKgRaw] = useState(String(lot.balanceKg).replace(".", ","));
  const wh = warehouses.find((w) => w.id === (warehouseId ?? (multiWarehouse ? null : fallback?.id))) ?? null;
  const kg = parseKg(kgRaw);
  const ok = wh !== null && kg !== null;
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Lot {lot.lotNo} — çıkış miktarı</DialogTitle>
          <DialogDescription>
            {lot.item.name} · lot bakiyesi {fmtNum(lot.balanceKg)} kg (tüm depolar)
          </DialogDescription>
        </DialogHeader>
        {multiWarehouse && <WarehouseChoice warehouses={warehouses} selectedId={wh?.id ?? null} onSelect={setWarehouseId} />}
        <div className="space-y-1">
          <Label htmlFor="consignment-kg">Miktar (kg)</Label>
          <Input
            id="consignment-kg"
            inputMode="decimal"
            value={kgRaw}
            onChange={(e) => setKgRaw(e.target.value)}
            className={cn(kg === null && "border-destructive")}
          />
          {kg === null && (
            <p className="text-xs text-destructive">0'dan büyük bir kg girin (en çok 3 ondalık).</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Lotu değiştir
          </Button>
          <Button
            disabled={!ok}
            onClick={() =>
              wh &&
              kg &&
              onDone({
                key: `yarn:${lot.id}:${wh.id}`,
                input: { kind: "YARN", yarnItemId: lot.itemId, warehouseId: wh.id, lotId: lot.id, qtyKg: kg },
                label: `İplik lot ${lot.lotNo}`,
                sub: `${lot.item.name} · ${fmtNum(kg)} kg · ${wh.name}`,
              })
            }
          >
            Belgeye ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WarehouseChoice({ warehouses, selectedId, onSelect }: { warehouses: Warehouse[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>Çıkacağı depo</Label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Depo">
        {warehouses.map((w) => (
          <Button key={w.id} type="button" size="sm" role="radio" aria-checked={selectedId === w.id} variant={selectedId === w.id ? "default" : "outline"} onClick={() => onSelect(w.id)}>
            {w.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
