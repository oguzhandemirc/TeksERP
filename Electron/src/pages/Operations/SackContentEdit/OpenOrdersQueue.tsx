import { useMemo } from "react";
import { ClipboardList, Search, AlertTriangle, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import type { OpenOrder } from "./types";

const groupKey = (o: OpenOrder) => `${o.order.customer.id}|${o.order.branch?.id ?? "_"}`;

/** Siparişin depo karşılanma oranı — sum(min(depo, açık)) / sum(açık). Paketçi
 *  "şu an ne kadarını paketleyebilirim" sinyali. Açık yoksa (0) tam kabul. */
function coverage(o: OpenOrder): { pct: number; label: string; tone: string } {
  const open = o.lines.reduce((s, l) => s + Math.max(0, l.openQty), 0);
  if (open <= 0) return { pct: 100, label: "Hazır", tone: "border-emerald-300 text-emerald-700 dark:text-emerald-400" };
  const avail = o.lines.reduce((s, l) => s + Math.min(Math.max(0, l.warehouseAvailable), Math.max(0, l.openQty)), 0);
  const pct = Math.round((avail / open) * 100);
  if (pct >= 100) return { pct: 100, label: "Hazır", tone: "border-emerald-300 text-emerald-700 dark:text-emerald-400" };
  if (pct <= 0) return { pct: 0, label: "Stok yok", tone: "border-destructive/40 text-destructive" };
  return { pct, label: `Kısmi %${pct}`, tone: "border-amber-300 text-amber-700 dark:text-amber-400" };
}

/** Termin aciliyeti — geçmiş (kırmızı) / ≤3 gün (amber) / normal. now: client saati. */
function urgency(deadline: string | null): { tone: string; strip: string; icon: typeof Clock | null; text: string } | null {
  if (!deadline) return null;
  const d = new Date(deadline).getTime();
  if (Number.isNaN(d)) return null;
  const days = Math.ceil((d - Date.now()) / 86_400_000);
  if (days < 0) return { tone: "text-destructive", strip: "border-l-destructive", icon: AlertTriangle, text: `${-days} gün geçti` };
  if (days <= 3) return { tone: "text-amber-600 dark:text-amber-500", strip: "border-l-amber-400", icon: Clock, text: days === 0 ? "bugün" : `${days} gün kaldı` };
  return { tone: "text-muted-foreground", strip: "border-l-transparent", icon: null, text: safeFormat(deadline, "dd.MM.yyyy") };
}

interface Props {
  openOrders: OpenOrder[];
  search: string;
  onSearchChange: (v: string) => void;
  selected: Set<string>;
  selectedGroup: string | null;
  onToggle: (o: OpenOrder) => void;
  className?: string;
}

/** Sol pano — açık sipariş kuyruğu: arama + müşteri/şube grupları + aciliyet +
 *  karşılanma%. Tek müşteri+şube seçilir (başlıkta yazılı; diğer gruplar soluk). */
export function OpenOrdersQueue({
  openOrders,
  search,
  onSearchChange,
  selected,
  selectedGroup,
  onToggle,
  className,
}: Props) {
  const groups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("tr-TR");
    const m = new Map<string, { key: string; label: string; orders: OpenOrder[] }>();
    for (const o of openOrders) {
      const label = `${o.order.customer.name}${o.order.branch ? ` · ${o.order.branch.name}` : ""}`;
      if (term) {
        const hay = `${label} ${o.order.orderNumber}`.toLocaleLowerCase("tr-TR");
        if (!hay.includes(term)) continue;
      }
      const k = groupKey(o);
      if (!m.has(k)) m.set(k, { key: k, label, orders: [] });
      m.get(k)!.orders.push(o);
    }
    // Aciliyete göre: en erken terminli grup üstte (geçmiş/yakın önce).
    return [...m.values()].sort((a, b) => {
      const ad = earliest(a.orders);
      const bd = earliest(b.orders);
      return ad - bd;
    });
  }, [openOrders, search]);

  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ClipboardList className="h-4 w-4" /> Açık Siparişler
        </h3>
        <span className="text-[11px] text-muted-foreground">tek müşteri+şube seçilir</span>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Müşteri / sipariş no ara…"
          className="pl-8"
        />
      </div>

      {groups.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {search.trim() ? "Aramaya uyan açık sipariş yok." : "Paketlenecek açık sipariş yok."}
        </p>
      ) : (
        <div className="space-y-4 overflow-auto">
          {groups.map((g) => {
            const dimmed = selectedGroup !== null && g.key !== selectedGroup;
            return (
              <div key={g.key} className={cn("rounded-lg border", dimmed && "opacity-50")}>
                <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">{g.label}</div>
                <ul className="divide-y">
                  {g.orders.map((o) => {
                    const checked = selected.has(o.order.id);
                    const cov = coverage(o);
                    const urg = urgency(o.order.deadline);
                    return (
                      <li key={o.order.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-3 border-l-2 px-3 py-2 text-sm hover:bg-muted/40",
                            urg?.strip ?? "border-l-transparent",
                            checked && "bg-primary/5",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggle(o)}
                            className="mt-1 h-4 w-4 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-mono font-medium">{o.order.orderNumber}</span>
                              <span className="text-xs text-muted-foreground">{o.lines.length} kalem</span>
                              {urg && (
                                <span className={cn("flex items-center gap-1 text-xs font-medium", urg.tone)}>
                                  {urg.icon && <urg.icon className="h-3 w-3" />}
                                  {urg.text}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 space-y-0.5">
                              {o.lines.slice(0, 3).map((l) => (
                                <div key={l.lineId} className="truncate text-xs text-muted-foreground">
                                  {l.customerItemName ?? l.item.name}
                                  {l.color ? ` · ${l.customerColorName ?? l.color.name}` : ""}
                                  {l.width != null ? ` · ${l.width}cm` : ""}
                                  {" — "}
                                  <span className={cn("tabular-nums", l.openQty > 0 && "font-medium text-foreground")}>
                                    {Math.round(l.openQty)}m açık
                                  </span>
                                </div>
                              ))}
                              {o.lines.length > 3 && (
                                <div className="text-xs text-muted-foreground">+{o.lines.length - 3} kalem daha</div>
                              )}
                            </div>
                          </div>
                          <Badge variant="outline" className={cn("mt-0.5 shrink-0 text-[10px]", cov.tone)}>
                            {cov.label}
                          </Badge>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Grubun en erken termini (ms) — sıralama için; terminsizler en sona. */
function earliest(orders: OpenOrder[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const o of orders) {
    if (!o.order.deadline) continue;
    const t = new Date(o.order.deadline).getTime();
    if (!Number.isNaN(t) && t < min) min = t;
  }
  return min;
}
