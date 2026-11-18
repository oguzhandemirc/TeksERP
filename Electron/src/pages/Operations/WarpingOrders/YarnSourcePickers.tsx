// İplik sevk satırının DEPO ve LOT seçicileri — tetik düğmesi doğrudan modal açar (combobox yok).
// Depo listesi iplik kaleminin bakiyeli depoları (`/api/yarn/stocks`), lot listesi kalemin aktif lotları (`/api/yarn/lots`);
// kalitesi Serbest olmayan lot seçilemez (sevk serbest stoktan düşer).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { loadAllPagesForPicker } from "@/lib/picker-loader";
import { listAllActiveYarnLots, listYarnStocks } from "@/pages/Operations/Yarn/service";
import { lotQualityOf, YARN_LOT_QUALITY } from "@/pages/Operations/Yarn/yarnLotQuality";
import { fmtKg } from "./order-model";
import type { PickedRef } from "./dispatch-model";

export interface Option extends PickedRef {
  hint?: string;
  disabledReason?: string;
  badge?: { label: string; cls: string };
}

interface PickerProps {
  title: string;
  description: string;
  placeholder: string;
  ariaLabel: string;
  value: PickedRef | null;
  onChange: (v: PickedRef | null) => void;
  load: () => Promise<Option[]>;
  queryKey: unknown[];
  clearable?: boolean;
  emptyText: string;
}

function TriggerButton({ value, placeholder, ariaLabel, onOpen }: { value: PickedRef | null; placeholder: string; ariaLabel: string; onOpen: () => void }) {
  return (
    <Button type="button" variant="outline" aria-label={ariaLabel} aria-haspopup="dialog" className={cn("h-8 w-full min-w-0 justify-between px-2 font-normal", !value && "text-muted-foreground")} onClick={onOpen}>
      <span className="truncate">{value ? value.label : placeholder}</span>
      <ListFilter className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
    </Button>
  );
}

function OptionRow({ o, selected, onPick }: { o: Option; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={Boolean(o.disabledReason)}
      title={o.disabledReason}
      className={cn("flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50", selected && "bg-muted")}
      onClick={onPick}
    >
      <span className="min-w-0">
        <span className="font-medium">{o.label}</span>
        {(o.hint || o.disabledReason) && <span className="block truncate text-xs text-muted-foreground">{o.disabledReason ?? o.hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {o.badge && <Badge variant="outline" className={cn("font-normal", o.badge.cls)}>{o.badge.label}</Badge>}
        {o.balanceKg !== null && <span className="tabular-nums">{fmtKg(o.balanceKg)} kg</span>}
      </span>
    </button>
  );
}

export function SourcePicker(p: PickerProps) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: p.queryKey, queryFn: p.load, enabled: open, staleTime: 15_000 });
  const rows = q.data ?? [];
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <TriggerButton value={p.value} placeholder={p.placeholder} ariaLabel={p.ariaLabel} onOpen={() => setOpen(true)} />
      {p.clearable && p.value && (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`${p.ariaLabel} — seçimi kaldır`} onClick={() => p.onChange(null)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{p.title}</DialogTitle>
            <DialogDescription>{p.description}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto rounded-md border" role="listbox" aria-label={p.title}>
            {q.isLoading && <p className="p-3 text-sm text-muted-foreground">Yükleniyor…</p>}
            {!q.isLoading && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">{p.emptyText}</p>}
            {rows.map((o) => (
              <OptionRow key={o.id} o={o} selected={p.value?.id === o.id} onPick={() => { p.onChange({ id: o.id, label: o.label, balanceKg: o.balanceKg }); setOpen(false); }} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export async function loadWarehouseOptions(itemId: string): Promise<Option[]> {
  // Uç tavanı 200; depo sayısı bunu aşabilir → sayfa sayfa sonuna kadar (sessiz kesme yok).
  const rows = await loadAllPagesForPicker((page, pageSize) => listYarnStocks({ page, pageSize, itemId, onlyNonZero: true }));
  return rows.map((s) => ({ id: s.warehouse.id, label: s.warehouse.name, hint: s.warehouse.code, balanceKg: Number(s.balanceKg) }));
}

async function loadLotOptions(itemId: string): Promise<Option[]> {
  const rows = await listAllActiveYarnLots(itemId);
  return rows.map((l) => {
    const q = lotQualityOf(l);
    return {
      id: l.id, label: l.lotNo, balanceKg: Number(l.balanceKg),
      hint: [l.supplier?.name, l.ownerCustomer ? `sahip ${l.ownerCustomer.name}` : null].filter(Boolean).join(" · ") || undefined,
      badge: YARN_LOT_QUALITY[q],
      disabledReason: q === "RELEASED" ? undefined : `${YARN_LOT_QUALITY[q].label} — sevk edilemez`,
    };
  });
}

export function WarehousePicker({ itemId, code, value, onChange }: { itemId: string; code: string; value: PickedRef | null; onChange: (v: PickedRef | null) => void }) {
  return (
    <SourcePicker
      title={`${code} — depo`}
      description="İplik bu depodan çıkar. Listede yalnız bu iplikten bakiyesi olan depolar var."
      placeholder="Depo seç"
      ariaLabel={`${code} depo seç`}
      value={value}
      onChange={onChange}
      queryKey={["warping-dispatch", "warehouses", itemId]}
      load={() => loadWarehouseOptions(itemId)}
      emptyText="Bu iplikten hiçbir depoda bakiye yok."
    />
  );
}

export function LotPicker({ itemId, code, value, onChange }: { itemId: string; code: string; value: PickedRef | null; onChange: (v: PickedRef | null) => void }) {
  return (
    <SourcePicker
      title={`${code} — lot`}
      description="Lot seçimi lot kuralını belirler. Bakiye lotun tüm depolardaki toplamıdır."
      placeholder="Lotsuz"
      ariaLabel={`${code} lot seç`}
      value={value}
      onChange={onChange}
      clearable
      queryKey={["warping-dispatch", "lots", itemId]}
      load={() => loadLotOptions(itemId)}
      emptyText="Bu iplik için aktif lot yok."
    />
  );
}
