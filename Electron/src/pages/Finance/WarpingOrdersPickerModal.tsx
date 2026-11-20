// Devere kabulü ÇOKLU seçici — carinin deverecisine ait siparişler, kabul (irsaliye) başına satır. Sipariş satırı
// seçilebilir bütün kabullerini ekler/çıkarır; başka faturaya bağlı kabul kilitli görünür. Sayılar sunucudan.
import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoPopover } from "@/components/ui/info-popover";
import { cn } from "@/lib/utils";
import { factoryLocaleDateString } from "@/lib/factory-time";
import { money } from "./service";
import {
  FEE_STATE_CLASS, FEE_STATE_LABEL, LUMP_INFO, expectedText, feePriceText, feeQtyText, isLumpPrice, orderCheckState, selectedExpected,
  toggleKey, toggleOrder, type WarpingFeeOrder, type WarpingFeeReceipt,
} from "./warpingFee";

interface Props {
  onOpenChange: (open: boolean) => void;
  orders: WarpingFeeOrder[];
  isLoading: boolean;
  isError: boolean;
  value: string[];
  /** Yeni faturada "Taslak oluştur", düzenlemede "Uygula". */
  applyLabel: string;
  onApply: (keys: string[]) => void;
}

export function WarpingOrdersPickerModal({ onOpenChange, orders, isLoading, isError, value, applyLabel, onApply }: Props) {
  const [selected, setSelected] = useState<string[]>(value);
  const sum = selectedExpected(orders, selected);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Devere siparişlerine bağla</DialogTitle>
          <DialogDescription>Deverecinin kabul edilen leventleri, irsaliye başına. Sipariş satırı bütün faturasız kabullerini seçer; tek kabulü ayrıca işaretleyebilirsin.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto rounded-md border" role="listbox" aria-multiselectable="true" data-testid="warping-picker">
          {isLoading ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : isError ? (
            <p className="p-4 text-center text-sm text-destructive">Liste okunamadı — bu, kabul yok demek DEĞİLDİR. Kapatıp tekrar deneyin.</p>
          ) : orders.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Bu carinin deverecisine ait kabul edilmiş levent yok.</p>
          ) : (
            orders.map((o) => (
              <OrderBlock key={o.id} order={o} selected={selected} onOrder={() => setSelected((s) => toggleOrder(o, s))} onReceipt={(k) => setSelected((s) => toggleKey(k, s))} />
            ))
          )}
        </div>
        <SelectionFooter sum={sum} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button type="button" disabled={isLoading || isError} onClick={() => { onApply(selected); onOpenChange(false); }} data-testid="devere-uygula">
            {applyLabel} ({selected.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SelectionFooter({ sum }: { sum: ReturnType<typeof selectedExpected> }) {
  if (sum.orderCount === 0) return <p className="text-xs text-muted-foreground">Seçim yok.</p>;
  const amounts = sum.byCurrency.map((c) => money(c.amount, c.currency)).join(" + ");
  return (
    <div className="space-y-1 text-sm" data-testid="warping-picker-sum">
      <p>
        <span className="text-muted-foreground">{sum.orderCount} sipariş · beklenen </span>
        <span className="font-medium tabular-nums">{amounts || "—"}</span>
      </p>
      {sum.byCurrency.length > 1 && <p className="text-xs text-destructive">Seçimde farklı para birimleri var — bir fatura tek para biriminde kesilir; ayrı faturalar kesin.</p>}
      {sum.missingPrice && <p className="text-xs text-amber-700 dark:text-amber-300">Bazı siparişlerde devere ücreti girilmemiş — o satırlar fiyatsız gelir.</p>}
    </div>
  );
}

function CheckBox({ state }: { state: "all" | "some" | "none" }) {
  return (
    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", state === "none" ? "border-muted-foreground/40" : "border-primary bg-primary text-primary-foreground")}>
      {state === "all" && <Check className="h-3.5 w-3.5" />}
      {state === "some" && <Minus className="h-3.5 w-3.5" />}
    </span>
  );
}

function OrderBlock({ order: o, selected, onOrder, onReceipt }: { order: WarpingFeeOrder; selected: string[]; onOrder: () => void; onReceipt: (key: string) => void }) {
  const set = new Set(selected);
  const state = orderCheckState(o, set);
  const locked = o.receipts.every((r) => !(r.selectable ?? r.invoice === null));
  return (
    <div className="border-b last:border-b-0">
      <button type="button" role="option" aria-selected={state === "all"} disabled={locked} onClick={onOrder} className={cn("flex w-full items-center gap-3 bg-muted/30 px-3 py-2 text-left text-sm hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60")}>
        <CheckBox state={locked ? "none" : state} />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{o.orderNo}</span> <span className="text-muted-foreground">{o.warpSpecName}</span>
          <span className="block text-xs text-muted-foreground">{feePriceText(o.fee)}</span>
        </span>
        <span className="shrink-0 text-right text-xs tabular-nums">
          {feeQtyText(o.totals.qty, o.fee.unit)}
          <span className="block font-medium">{expectedText(o.totals.expectedAmount, o.fee.currency)}</span>
        </span>
        {o.invoiceState && <span className={cn("shrink-0 rounded-badge px-1.5 py-0.5 text-[11px]", FEE_STATE_CLASS[o.invoiceState])}>{FEE_STATE_LABEL[o.invoiceState]}</span>}
      </button>
      {isLumpPrice(o.fee.unitPrice) && (
        <p className="flex items-center gap-1 px-11 pt-1 text-[11px] text-muted-foreground">Taslakta götürü satır (miktar 1) <InfoPopover desc={LUMP_INFO} label="Götürü satır" /></p>
      )}
      {o.receipts.map((r) => <ReceiptRow key={r.receiptKey} r={r} order={o} checked={set.has(r.receiptKey)} onToggle={() => onReceipt(r.receiptKey)} />)}
    </div>
  );
}

function ReceiptRow({ r, order, checked, onToggle }: { r: WarpingFeeReceipt; order: WarpingFeeOrder; checked: boolean; onToggle: () => void }) {
  const can = r.selectable ?? r.invoice === null;
  return (
    <button type="button" role="option" aria-selected={checked} disabled={!can} onClick={onToggle} className={cn("flex w-full items-center gap-3 py-1.5 pl-11 pr-3 text-left text-xs hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60", checked && "bg-primary/5")}>
      <CheckBox state={checked ? "all" : "none"} />
      <span className="min-w-0 flex-1 truncate">
        {r.deliveryNoteNo ? `İrsaliye ${r.deliveryNoteNo}` : "İrsaliyesiz"} · {factoryLocaleDateString(r.receivedAt, "tr-TR")} · {r.beamCount} levent
      </span>
      <span className="shrink-0 tabular-nums">{feeQtyText(r.qty, order.fee.unit)}</span>
      <span className="w-24 shrink-0 text-right tabular-nums">{expectedText(r.expectedAmount, order.fee.currency)}</span>
      <span className="w-28 shrink-0 truncate text-right text-muted-foreground">{r.invoice && !can ? `Faturalı: ${r.invoice.docNo}` : r.invoice ? `Bu fatura` : "Faturasız"}</span>
    </button>
  );
}
