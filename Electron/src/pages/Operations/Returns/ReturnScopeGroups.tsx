import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Package, Truck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { candidateOrders, selectedInGroup, type ReturnScope } from "./returnScope";
import type { ReturnLookupRoll, ReturnScopeGroup, ReturnScopeSack } from "./service";

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

/**
 * KAPSAM LİSTESİ — sevkiyat başına bir kart; kartta çuvallar (katlanır), çuvalda
 * toplar (onay kutulu). Sipariş seçimi SEVKİYAT BAŞINA (belge o sevkiyata bağlanır),
 * adaylar seçili topların hepsine uyanlardır — seçim değişince aday listesi de değişir.
 * Tek top / tek çuval kapsamında da aynı bileşen: yol değişir, görünüm değişmez.
 */
export function ReturnScopeGroups({
  scope,
  selected,
  onToggle,
  onSetMany,
  orderByGroup,
  onOrder,
}: {
  scope: ReturnScope;
  selected: ReadonlySet<string>;
  onToggle: (rollId: string) => void;
  onSetMany: (rollIds: string[], checked: boolean) => void;
  orderByGroup: ReadonlyMap<string, string | null>;
  onOrder: (shipmentId: string, orderId: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      {scope.groups.map((g) => (
        <GroupCard
          key={g.shipment.id}
          g={g}
          single={scope.kind === "ROLL"}
          selected={selected}
          onToggle={onToggle}
          onSetMany={onSetMany}
          orderId={orderByGroup.get(g.shipment.id) ?? null}
          onOrder={(v) => onOrder(g.shipment.id, v)}
          showOrder={scope.groups.length > 1 || scope.kind === "SHIPMENT"}
        />
      ))}
    </div>
  );
}

function GroupCard({
  g, single, selected, onToggle, onSetMany, orderId, onOrder, showOrder,
}: {
  g: ReturnScopeGroup; single: boolean; selected: ReadonlySet<string>; onToggle: (id: string) => void;
  onSetMany: (ids: string[], checked: boolean) => void; orderId: string | null; onOrder: (v: string | null) => void; showOrder: boolean;
}) {
  const chosen = selectedInGroup(g, selected);
  const total = g.sacks.reduce((n, s) => n + s.rolls.length, 0);
  const meters = g.sacks.flatMap((s) => s.rolls).filter((r) => selected.has(r.id)).reduce((m, r) => m + Number(r.currentQty || 0), 0);
  const cands = candidateOrders(g, selected);
  return (
    <div className="rounded-md border bg-card/40">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
        <Truck className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono font-semibold">{g.shipment.shipmentNo}</span>
        <span className="text-xs text-muted-foreground">
          {g.customer?.name ?? "—"}{g.branch ? ` · ${g.branch.name}` : ""}
        </span>
        <span className="ml-auto rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
          {chosen.length}/{total} top · {DEC.format(meters)} m
        </span>
      </div>
      {/* Sipariş — çok gruplu kapsamda her sevkiyat kendi siparişine bağlanır. */}
      {showOrder && chosen.length > 0 && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
          <span className="w-16 shrink-0 text-muted-foreground">Sipariş</span>
          {cands.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" /> uyan sipariş yok — siparişsiz kaydedilir
            </span>
          ) : (
            <Select value={orderId ?? ""} onValueChange={(v) => onOrder(v || null)}>
              <SelectTrigger className="h-7 w-64 text-xs"><SelectValue placeholder="Sipariş seçin…" /></SelectTrigger>
              <SelectContent>
                {cands.map((o) => (<SelectItem key={o.id} value={o.id}>{o.orderNumber}</SelectItem>))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      <div className="divide-y">
        {g.sacks.map((s) => (
          <SackRows key={s.id} s={s} single={single} selected={selected} onToggle={onToggle} onSetMany={onSetMany} collapsible={g.sacks.length > 1} />
        ))}
      </div>
    </div>
  );
}

function SackRows({
  s, single, selected, onToggle, onSetMany, collapsible,
}: {
  s: ReturnScopeSack; single: boolean; selected: ReadonlySet<string>; onToggle: (id: string) => void; onSetMany: (ids: string[], checked: boolean) => void; collapsible: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const ids = s.rolls.map((r) => r.id);
  const n = ids.filter((id) => selected.has(id)).length;
  const all = n === ids.length && ids.length > 0;
  const some = n > 0 && !all;
  return (
    <div>
      {!single && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
          <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(c) => onSetMany(ids, c === true)} aria-label={`${s.sackNo} tümü`} />
          <button type="button" className="inline-flex items-center gap-1 font-mono font-medium" onClick={() => collapsible && setOpen((v) => !v)}>
            {collapsible && (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
            <Package className="h-3.5 w-3.5 text-muted-foreground" />
            {s.sackNo}
          </button>
          {s.packageNo != null && <span className="rounded bg-muted px-1.5 text-[11px]">Ambalaj {s.packageNo}</span>}
          {s.packingGroupName && <span className="text-muted-foreground">{s.packingGroupName}</span>}
          <span className="ml-auto tabular-nums text-muted-foreground">{n}/{ids.length} top</span>
        </div>
      )}
      {open && (
        <ul className={cn("divide-y", !single && "border-t bg-background/40")}>
          {s.rolls.map((r) => (<RollRow key={r.id} r={r} checked={selected.has(r.id)} onToggle={() => onToggle(r.id)} indent={!single} />))}
        </ul>
      )}
    </div>
  );
}

function RollRow({ r, checked, onToggle, indent }: { r: ReturnLookupRoll; checked: boolean; onToggle: () => void; indent: boolean }) {
  return (
    <li className={cn("flex items-center gap-2 py-1.5 pr-3 text-xs", indent ? "pl-8" : "pl-3")}>
      <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`${r.barcode ?? r.id} seç`} />
      <span className="w-32 shrink-0 font-mono">{r.barcode ?? r.id.slice(0, 8)}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {r.item?.name ?? "—"}{r.color ? ` · ${r.color.name}` : ""}{r.width != null ? ` · ${r.width} cm` : ""}{r.qualityGrade ? ` · ${r.qualityGrade}` : ""}
      </span>
      <span className="shrink-0 tabular-nums">{DEC.format(Number(r.currentQty))} m</span>
    </li>
  );
}

/** Kapsam boşken (henüz sorgu yok) küçük yönlendirme. */
export function ScopeEmptyHint() {
  return (
    <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
      Top barkodu, çuval kodu (CV…) ya da sevkiyat no (SVK…) okutun — ya da üstteki çiplerden Sevkiyat / Sevk partisi seçin.
    </div>
  );
}
