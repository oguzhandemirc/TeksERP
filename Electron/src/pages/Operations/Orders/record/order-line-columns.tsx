// Kalemler sekmesi sütunları — hücreler TEK SATIR (tam metin `title`da). Sevk çubuğu sunucunun kalem sevk
// miktarından (`shippedQty`, BRÜT); fiyat sütunları yalnız fiyatlandırma açıkken.
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AnimatedProgress } from "@/components/motion/AnimatedProgress";
import type { RecordColumn } from "@/components/record/RecordTable";
import { ToneChip } from "@/components/record/RecordBits";
import { formatAmount, formatDisplay, formatMeasure, formatMoney, formatQty } from "@/lib/format";
import { isMeasuredUnit, unitLabel } from "@/lib/item-unit";
import { TERIM } from "@/lib/terim";
import type { OrderLine } from "../types";
import { lineAmount } from "./order-record";

export interface LineRowState {
  selectable: boolean;
  selected: boolean;
  disabledReason: string | null;
}

export interface LineColumnArgs {
  currency: string;
  pricing: boolean;
  canCancel: boolean;
  /** İE seçimi açık mı (durum + izin + rejim). */
  woSelect: boolean;
  rowState: (l: OrderLine) => LineRowState;
  onToggle: (l: OrderLine) => void;
  onCancel: (l: OrderLine) => void;
  customerName: (l: OrderLine) => string | null;
}

function shipPct(l: OrderLine): number | null {
  if (!isMeasuredUnit(l.unit) || !(Number(l.quantity) > 0)) return null;
  return Math.min(100, Math.round((Number(l.shippedQty ?? 0) / Number(l.quantity)) * 100));
}

function ShipBar({ line }: { line: OrderLine }) {
  const pct = shipPct(line);
  if (pct == null) return <span className="text-xs text-muted-foreground">Ölçülmüyor</span>;
  return (
    <span className="flex w-36 items-center gap-2" title={`${formatMeasure(line.shippedQty ?? 0, "m")} sevk`}>
      <AnimatedProgress value={pct} className="h-1.5 flex-1" />
      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">%{formatDisplay(pct, 0)}</span>
    </span>
  );
}

export function orderLineColumns(a: LineColumnArgs): RecordColumn<OrderLine>[] {
  const cols: RecordColumn<OrderLine>[] = [];
  if (a.woSelect) {
    cols.push({
      key: "sel",
      label: "",
      className: "w-8",
      render: (l) => {
        const st = a.rowState(l);
        if (!st.selectable) return null;
        return <Checkbox checked={st.selected} disabled={Boolean(st.disabledReason)} title={st.disabledReason ?? undefined} onCheckedChange={() => a.onToggle(l)} aria-label={`Kalemi ${TERIM.terbiyeIsEmri.tekilKucuk} için seç`} />;
      },
    });
  }
  cols.push(
    {
      key: "item",
      label: "Kumaş",
      className: "max-w-[18rem] truncate font-medium",
      title: (l) => [l.item?.name, a.customerName(l) ? `Müşteride: ${a.customerName(l)}` : null, l.cutNote ? `Kesim notu: ${l.cutNote}` : null].filter(Boolean).join(" · "),
      render: (l) => (
        <span className={l.cancelledAt ? "line-through" : undefined}>
          {l.item?.name ?? "—"}
          {l.cancelledAt && <ToneChip tone="rose" className="ml-2 align-middle">İptal</ToneChip>}
        </span>
      ),
    },
    {
      key: "color",
      label: "Renk",
      className: "max-w-[12rem] truncate",
      title: (l) => l.color?.name,
      render: (l) =>
        l.color ? (
          <span className="inline-flex items-center gap-1.5">
            {l.color.hex && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: l.color.hex }} />}
            {l.color.name}
          </span>
        ) : "—",
    },
    { key: "width", label: "En", align: "right", render: (l) => (l.width != null ? `${formatQty(l.width)} cm` : "—") },
    { key: "qty", label: "Miktar", align: "right", render: (l) => <span className="font-semibold">{formatQty(l.quantity)}</span> },
    { key: "unit", label: "Birim", render: (l) => unitLabel(l.unit) },
    { key: "tol", label: "Tolerans", align: "right", render: (l) => (l.tolerancePct != null && l.tolerancePct !== "" ? `%${formatQty(l.tolerancePct)}` : "—") },
  );
  if (a.pricing) {
    cols.push(
      { key: "price", label: "Birim fiyat", align: "right", render: (l) => (l.unitPrice ? `${formatAmount(l.unitPrice, 2, 4)} ${a.currency}` : "—") },
      { key: "amount", label: "Tutar", align: "right", render: (l) => { const n = lineAmount(l); return n == null ? "—" : formatMoney(n, a.currency); } },
    );
  }
  cols.push(
    { key: "ship", label: "Sevk", render: (l) => <ShipBar line={l} /> },
    {
      key: "wo",
      label: TERIM.terbiyeIsEmri.tekil,
      className: "max-w-[12rem] truncate",
      title: (l) => (l.workOrderLinks ?? []).map((w) => w.workOrder.workOrderNumber).join(", "),
      render: (l) => (l.workOrderLinks ?? []).map((w) => w.workOrder.workOrderNumber).join(", ") || "—",
    },
  );
  if (a.canCancel) {
    cols.push({
      key: "act",
      label: "",
      align: "right",
      render: (l) =>
        l.cancelledAt ? null : (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Bu kalemi iptal et" aria-label="Kalemi iptal et" onClick={(e) => { e.stopPropagation(); a.onCancel(l); }}>
            <Ban className="h-3.5 w-3.5" />
          </Button>
        ),
    });
  }
  return cols;
}
