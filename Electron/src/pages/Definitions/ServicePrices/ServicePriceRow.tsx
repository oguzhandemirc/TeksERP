// Kademe tablosunun tek satırı: ad · genel · (müşteri) · ileri tarihli · uygulanan fiyat + rozet · işlemler.
import { AlertTriangle, CalendarClock, History, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import type { PriceSlot, ServicePriceTierRow } from "./service";
import { PriceCell } from "./PriceCell";
import { SourceBadge } from "./SourceBadge";
import { cellKey, formatPrice, type EditScope } from "./servicePrices";

export interface GridRow {
  valueId: string | null;
  label: string;
  sub: string | null;
  general: PriceSlot;
  customer: PriceSlot | null;
  tier: ServicePriceTierRow | null;
}

interface Props {
  row: GridRow;
  first: boolean;
  hasCustomer: boolean;
  hasTiers: boolean;
  editable: boolean;
  canWrite: boolean;
  savingKey: string | null;
  onCommit: (scope: EditScope) => (price: number, move: 1 | -1 | 0) => Promise<boolean>;
  onMove: (scope: EditScope, delta: 1 | -1) => void;
  onHistory: () => void;
  onRemove: (id: string, text: string) => void;
}

const REMOVE_LABELS = [
  ["Bekleyen genel fiyatı kaldır", "genel ileri tarihli"],
  ["Bekleyen müşteri fiyatını kaldır", "müşteri ileri tarihli"],
  ["Genel fiyatı kaldır", "genel"],
  ["Müşteri fiyatını kaldır", "müşteri"],
] as const;

function Pending({ slot }: { slot: PriceSlot | null }) {
  if (!slot?.pending) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">
      <CalendarClock className="h-3 w-3" />
      {formatPrice(slot.pending.price)} · {fmtFactoryDate(slot.pending.validFrom)}
    </span>
  );
}

function Effective({ row, hasTiers }: { row: GridRow; hasTiers: boolean }) {
  const eff = row.tier?.effective;
  if (row.tier === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {hasTiers ? "kademesi tabloda olmayan işe uygulanmaz" : "kademe yokken uygulanır"}
      </span>
    );
  }
  if (eff?.tierMissing) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"
        title="Tabloda bu kademenin fiyatı yok — fatura satırı fiyatsız gelir, kalem fiyatına düşülmez"
      >
        <AlertTriangle className="h-3.5 w-3.5" /> Fiyatsız
      </span>
    );
  }
  if (!eff?.price) return <span className="text-xs text-muted-foreground">fiyat yok</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-medium tabular-nums">{formatPrice(eff.price)}</span>
      {eff.source && <SourceBadge source={eff.source} formula={eff.gramFormula} />}
    </span>
  );
}

function RowActions({
  row,
  hasCustomer,
  canWrite,
  onHistory,
  onRemove,
}: Pick<Props, "row" | "hasCustomer" | "canWrite" | "onHistory" | "onRemove">) {
  const slots = [
    row.general.pending,
    hasCustomer ? row.customer?.pending : null,
    row.general.current,
    hasCustomer ? row.customer?.current : null,
  ];
  const removable = REMOVE_LABELS.map(([action, what], k) => ({ cell: slots[k] ?? null, action, what }));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`${row.label} işlemleri`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onHistory}>
          <History className="mr-2 h-4 w-4" /> Fiyat geçmişi
        </DropdownMenuItem>
        {canWrite &&
          removable.map(({ cell: c, action, what }) =>
            c ? (
              <DropdownMenuItem
                key={c.id}
                className="text-destructive"
                onSelect={() => onRemove(c.id, `${row.label} · ${what} fiyat ${formatPrice(c.price)}`)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> {action}
              </DropdownMenuItem>
            ) : null,
          )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ServicePriceRow(p: Props) {
  const { row, hasCustomer } = p;
  const cell = (scope: EditScope, slot: PriceSlot | null, placeholder?: string) => (
    <td className="px-1 py-1">
      <PriceCell
        cellId={cellKey(row.valueId, scope)}
        slot={slot}
        editable={p.editable}
        saving={p.savingKey === cellKey(row.valueId, scope)}
        onCommit={p.onCommit(scope)}
        onMove={(d) => p.onMove(scope, d)}
        placeholder={placeholder}
      />
    </td>
  );
  return (
    <tr className={cn("border-t", p.first && "bg-muted/30", row.tier && !row.tier.mapped && "opacity-60")}>
      <td className="px-3 py-1.5">
        <div className="font-medium">{row.label}</div>
        {row.sub && <div className="text-xs text-muted-foreground">{row.sub}</div>}
        {row.tier && row.tier.customerOverrideCount > 0 && !hasCustomer && (
          <div className="text-xs text-muted-foreground">
            {row.tier.customerOverrideCount} müşteriye özel fiyat
          </div>
        )}
      </td>
      {cell("general", row.general)}
      {hasCustomer && cell("customer", row.customer, "genel uygulanır")}
      <td className="space-x-1 px-2 py-1">
        <Pending slot={row.general} />
        {hasCustomer && <Pending slot={row.customer} />}
      </td>
      <td className="px-3 py-1 text-right">
        <Effective row={row} hasTiers={p.hasTiers} />
      </td>
      <td className="px-1 py-1">
        <RowActions
          row={row}
          hasCustomer={hasCustomer}
          canWrite={p.canWrite}
          onHistory={p.onHistory}
          onRemove={p.onRemove}
        />
      </td>
    </tr>
  );
}
