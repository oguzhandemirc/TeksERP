import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ContractView } from "../binding/contract";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: ContractView;
  current: string | null;
  onPick: (tableKey: string) => void;
}

/** `data-each` kaynağı — yalnız sözleşmenin `tablolar.*` dizileri listelenir. */
export function TableSourceModal({ open, onOpenChange, contract, current, onPick }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tablo kaynağı seç</DialogTitle>
          <DialogDescription>Satırlar seçilen listenin her kaydı için tekrarlanır.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {contract.tablolar.map((t) => (
            <button
              key={t.anahtar}
              type="button"
              onClick={() => { onPick(t.anahtar); onOpenChange(false); }}
              className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm hover:bg-muted ${current === t.anahtar ? "border-primary" : ""}`}
            >
              <span className="font-medium">{t.etiket}</span>
              <span className="font-mono text-xs text-muted-foreground">tablolar.{t.anahtar} · {t.kolonlar.length} kolon</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
