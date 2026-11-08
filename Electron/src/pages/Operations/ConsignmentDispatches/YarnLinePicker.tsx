// İplik kalemi: aday ucundan lot × depo satırı (doğrudan modal), sonra kg. YARN kaleminde lot ZORUNLU (sözleşme +
// DB CHECK); depo adayın kendisinde — bakiye lot × depo düzeyinde, sunucu önizlemesi yine ölçer.
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
import { cn } from "@/lib/utils";
import { CandidatePickerDialog } from "./CandidatePickerDialog";
import { blockedReasonText, fmtNum, parseKg } from "./consignmentText";
import type { DraftItem } from "./draft";
import type { ConsignmentYarnCandidate } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ownerCustomerId: string;
  takenKeys: ReadonlySet<string>;
  onPick: (item: DraftItem) => void;
}

export const yarnKey = (y: Pick<ConsignmentYarnCandidate, "lotId" | "warehouseId">): string => `yarn:${y.lotId}:${y.warehouseId}`;

export function lotDisabledReason(y: ConsignmentYarnCandidate, taken: ReadonlySet<string>): string | null {
  if (taken.has(yarnKey(y))) return "Belgede zaten var — miktarı satırdan değiştirin";
  return blockedReasonText(y.blockedReason);
}

export function YarnLinePicker({ open, onOpenChange, ownerCustomerId, takenKeys, onPick }: Props) {
  const [lot, setLot] = useState<ConsignmentYarnCandidate | null>(null);
  const close = () => {
    setLot(null);
    onOpenChange(false);
  };
  return (
    <>
      <CandidatePickerDialog<ConsignmentYarnCandidate>
        open={open && !lot}
        onOpenChange={(o) => !o && close()}
        title="İplik lotu seç"
        description="Seçili müşterinin depoda bakiyesi olan emanet lotları (lot × depo). Sonra kg girilir."
        ownerCustomerId={ownerCustomerId}
        pick={(d) => ({ rows: d.yarns, truncated: d.truncated.yarns, moduleOn: d.modules.iplik })}
        rowKey={yarnKey}
        renderRow={(y) => (
          <>
            <span className="font-medium">Lot {y.lotNo}</span>
            <span className="text-xs text-muted-foreground">
              {y.itemName} · {y.warehouseName} · {fmtNum(y.balanceKg)} kg
            </span>
          </>
        )}
        disabledReason={(y) => lotDisabledReason(y, takenKeys)}
        onPick={setLot}
        emptyText="Bu müşterinin depoda bakiyeli emanet lotu yok."
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

function QtyDialog({ lot, onCancel, onDone }: { lot: ConsignmentYarnCandidate; onCancel: () => void; onDone: (it: DraftItem) => void }) {
  const [kgRaw, setKgRaw] = useState(lot.balanceKg.replace(/\.?0+$/, "").replace(".", ","));
  const kg = parseKg(kgRaw);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Lot {lot.lotNo} — çıkış miktarı</DialogTitle>
          <DialogDescription>
            {lot.itemName} · {lot.warehouseName} deposundaki bakiye {fmtNum(lot.balanceKg)} kg
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="consignment-kg">Miktar (kg)</Label>
          <Input
            id="consignment-kg"
            inputMode="decimal"
            value={kgRaw}
            onChange={(e) => setKgRaw(e.target.value)}
            className={cn(kg === null && "border-destructive")}
          />
          {kg === null && <p className="text-xs text-destructive">0'dan büyük bir kg girin (en çok 3 ondalık).</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Lotu değiştir
          </Button>
          <Button
            disabled={kg === null}
            onClick={() =>
              kg &&
              onDone({
                key: yarnKey(lot),
                input: { kind: "YARN", yarnItemId: lot.yarnItemId, warehouseId: lot.warehouseId, lotId: lot.lotId, qtyKg: kg },
                label: `İplik lot ${lot.lotNo}`,
                sub: `${lot.itemName} · ${fmtNum(kg)} kg · ${lot.warehouseName}`,
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
