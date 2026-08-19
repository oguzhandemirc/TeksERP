import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Search, Unlink, X } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { orderService } from "@/pages/Operations/Orders/service";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import type { Order, OrderLine } from "@/pages/Operations/Orders/types";
import { trCompare } from "@/lib/collate";

export interface PickedOrderLineProperty {
  id: string;
  name: string;
}

export interface PickedOrderLine {
  lineId: string;
  orderId: string;
  orderNumber: string;
  orderDeadline: string | null;
  customerId: string;
  customerName: string;
  /** Siparişin hedef şubesi (opsiyonel — yoksa null; gösterimde gizlenir). */
  branchName: string | null;
  branchCode: string | null;
  itemId: string;
  itemName: string;
  colorId: string | null;
  itemColorHex: string | null;
  itemColorName: string | null;
  quantity: number;
  /** Picker'da gösterilen "Açık" metraj (quantity − sevk). */
  openQty: number;
  width: number | null;
  requiredProperties: PickedOrderLineProperty[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Açılışta önceden seçili kalemler — Confirm öncesi tam veri (orderNumber, customer vb.) gerekir. */
  initialSelected: PickedOrderLine[];
  onConfirm: (lines: PickedOrderLine[]) => void;
  /**
   * Düzenleme modunda mevcut WO'nun kendi bağlarını "müsait" sayacak şekilde
   * backend'e iletilir. Olmazsa picker WO'nun zaten bağladığı kalemleri "başka
   * WO'ya bağlı" sayar ve listeden düşürür.
   */
  excludeWorkOrderId?: string | null;
  /**
   * Material committed WO'da yeni siparişler sadece WO'nun kumaşı + eni ile
   * uyumlu olmak zorunda. Set edilirse picker hard-filter olarak uygular.
   */
  requiredItemId?: string | null;
  requiredWidth?: number | null;
}

type DeadlinePreset = "all" | "week" | "month" | "overdue";
type SortKey = "deadline" | "customer" | "orderNumber";

interface Anchor {
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: number | null;
}

interface LineCompatTarget {
  itemId: string;
  colorId: string | null;
  width: number | null;
}

function mismatchReason(anchor: Anchor, line: LineCompatTarget): string | null {
  if (line.itemId !== anchor.itemId) return "Farklı kumaş";
  if ((line.colorId ?? null) !== (anchor.colorId ?? null)) return "Farklı renk";
  if ((line.width ?? null) !== (anchor.width ?? null)) return "Farklı en";
  return null;
}

interface RequiredConstraint {
  itemId: string;
  width: number | null;
}

function requiredMismatchReason(
  req: RequiredConstraint | null,
  line: LineCompatTarget,
): string | null {
  if (!req) return null;
  if (line.itemId !== req.itemId) return "İş emrinin kumaşıyla uyuşmuyor";
  if ((line.width ?? null) !== (req.width ?? null))
    return "İş emrinin eniyle uyuşmuyor";
  return null;
}

export function buildPicked(order: Order, line: OrderLine): PickedOrderLine {
  return {
    lineId: line.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderDeadline: order.deadline,
    customerId: order.customerId,
    customerName: order.customer?.name ?? "—",
    branchName: order.branch?.name ?? null,
    branchCode: order.branch?.code ?? null,
    itemId: line.itemId,
    itemName: line.item?.name ?? "—",
    colorId: line.colorId,
    itemColorHex: line.color?.hex ?? null,
    itemColorName: line.color?.name ?? null,
    quantity: line.quantity,
    openQty: line.openQty ?? line.quantity,
    width: line.width ?? null,
    requiredProperties: (line.requiredProperties ?? []).map((rp) => ({
      id: rp.propertyId,
      name: rp.property.name,
    })),
  };
}

function deadlineTone(d: string | null): "danger" | "warning" | "muted" {
  if (!d) return "muted";
  const days = (new Date(d).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "danger";
  if (days < 3) return "warning";
  return "muted";
}

function deadlineRangeOf(p: DeadlinePreset): { dateFrom?: string; dateTo?: string } | null {
  const now = new Date();
  if (p === "all") return null;
  if (p === "overdue") return { dateTo: now.toISOString() };
  const end = new Date(now);
  end.setDate(end.getDate() + (p === "week" ? 7 : 30));
  return { dateFrom: now.toISOString(), dateTo: end.toISOString() };
}

const DEADLINE_PRESETS: { value: DeadlinePreset; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "overdue", label: "Geçti" },
  { value: "week", label: "Bu hafta" },
  { value: "month", label: "Bu ay" },
];

const SORT_PRESETS: { value: SortKey; label: string }[] = [
  { value: "deadline", label: "Termin" },
  { value: "customer", label: "Müşteri" },
  { value: "orderNumber", label: "Sipariş No" },
];

export function OrderPickerDialog({
  open,
  onOpenChange,
  initialSelected,
  onConfirm,
  excludeWorkOrderId,
  requiredItemId,
  requiredWidth,
}: Props) {
  const required = useMemo<RequiredConstraint | null>(
    () =>
      requiredItemId
        ? { itemId: requiredItemId, width: requiredWidth ?? null }
        : null,
    [requiredItemId, requiredWidth],
  );
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [deadlinePreset, setDeadlinePreset] = useState<DeadlinePreset>("all");
  const [sortBy, setSortBy] = useState<SortKey>("deadline");
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [hideIncompatible, setHideIncompatible] = useState(true);
  const [selectedMap, setSelectedMap] = useState<Map<string, PickedOrderLine>>(new Map());

  useEffect(() => {
    if (open) {
      setSelectedMap(new Map(initialSelected.map((l) => [l.lineId, l])));
    } else {
      setSearch("");
      setDebounced("");
      setCustomerId(null);
      setDeadlinePreset("all");
      setSortBy("deadline");
      setShowOnlySelected(false);
      setHideIncompatible(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const range = useMemo(() => deadlineRangeOf(deadlinePreset), [deadlinePreset]);
  const backendSortBy: string = sortBy === "customer" ? "deadline" : sortBy;

  const query = useQuery({
    queryKey: [
      "orders",
      "wo-picker",
      debounced,
      customerId,
      deadlinePreset,
      backendSortBy,
      excludeWorkOrderId ?? null,
    ],
    queryFn: () =>
      orderService.getAvailableForWorkOrder(
        {
          page: 1,
          pageSize: 100,
          sortBy: backendSortBy,
          sortOrder: sortBy === "orderNumber" ? "desc" : "asc",
          search: debounced || undefined,
          filters: {
            status: "APPROVED,PARTIAL_SHIPPED",
            ...(customerId ? { customerId } : {}),
          },
          ...(range
            ? {
                dateField: "deadline",
                ...(range.dateFrom ? { dateFrom: range.dateFrom } : {}),
                ...(range.dateTo ? { dateTo: range.dateTo } : {}),
              }
            : {}),
        },
        excludeWorkOrderId ?? undefined,
      ),
    enabled: open && !showOnlySelected,
    staleTime: 30_000,
  });

  const fetchedOrders = query.data?.data ?? [];
  const sortedFetched = useMemo(() => {
    if (sortBy !== "customer") return fetchedOrders;
    return [...fetchedOrders].sort((a, b) =>
      trCompare(a.customer?.name, b.customer?.name),
    );
  }, [fetchedOrders, sortBy]);

  const selectedArray = useMemo(() => Array.from(selectedMap.values()), [selectedMap]);
  const totalQty = selectedArray.reduce((s, l) => s + Number(l.quantity), 0);
  const customerCount = new Set(selectedArray.map((l) => l.customerId)).size;

  const anchor: Anchor | null = useMemo(() => {
    const f = selectedArray[0];
    if (!f) return null;
    return {
      itemId: f.itemId,
      itemName: f.itemName,
      colorId: f.colorId,
      colorName: f.itemColorName,
      colorHex: f.itemColorHex,
      width: f.width,
    };
  }, [selectedArray]);

  // Hard-filter: required (WO commitment) ile uyuşmayanları her zaman çıkar.
  // Soft-filter: anchor (selection-derived) ile uyuşmayanları sadece
  // hideIncompatible açıkken çıkar.
  const visibleFetched = useMemo(() => {
    const softFilter = anchor && hideIncompatible;
    if (!required && !softFilter) return sortedFetched;
    return sortedFetched
      .map((o) => ({
        ...o,
        lines: (o.lines ?? []).filter((l) => {
          const target = {
            itemId: l.itemId,
            colorId: l.colorId,
            width: l.width ?? null,
          };
          if (requiredMismatchReason(required, target) !== null) return false;
          if (softFilter && mismatchReason(anchor!, target) !== null) return false;
          return true;
        }),
      }))
      .filter((o) => (o.lines?.length ?? 0) > 0);
  }, [sortedFetched, anchor, hideIncompatible, required]);

  const groupedSelected = useMemo(() => {
    const map = new Map<
      string,
      { id: string; orderNumber: string; customerName: string; branchName: string | null; branchCode: string | null; deadline: string | null; lines: PickedOrderLine[] }
    >();
    for (const p of selectedArray) {
      if (!map.has(p.orderId)) {
        map.set(p.orderId, {
          id: p.orderId,
          orderNumber: p.orderNumber,
          customerName: p.customerName,
          branchName: p.branchName,
          branchCode: p.branchCode,
          deadline: p.orderDeadline,
          lines: [],
        });
      }
      map.get(p.orderId)!.lines.push(p);
    }
    return Array.from(map.values());
  }, [selectedArray]);

  const addLine = (picked: PickedOrderLine) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      next.set(picked.lineId, picked);
      return next;
    });
  };
  const removeLine = (lineId: string) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      next.delete(lineId);
      return next;
    });
  };
  const toggleOrderFromFetched = (order: Order, checked: boolean) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      for (const line of order.lines ?? []) {
        // Anchor varsa sadece uyumlu satırları seç; required ile uyuşmayanlar
        // her zaman dışarıda kalır. Uncheck'te kısıt yok.
        const target = {
          itemId: line.itemId,
          colorId: line.colorId,
          width: line.width ?? null,
        };
        const incompatible =
          checked &&
          (requiredMismatchReason(required, target) !== null ||
            (anchor && mismatchReason(anchor, target) !== null));
        if (incompatible) continue;
        if (checked) next.set(line.id, buildPicked(order, line));
        else next.delete(line.id);
      }
      return next;
    });
  };
  const clearAllSelected = () => setSelectedMap(new Map());

  const handleConfirm = () => {
    onConfirm(selectedArray);
    onOpenChange(false);
  };

  // Tek tıkla tüm sipariş bağlarını kaldır ve kapat — bağlı kalemleri tek tek
  // uncheck etmeye gerek kalmadan iş emrinin sipariş bağını temizler.
  const handleRemoveAll = () => {
    clearAllSelected();
    onConfirm([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] max-w-7xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Müsait Sipariş Kalemleri</DialogTitle>
          <DialogDescription>
            Onaylı ve kısmi sevk edilmiş sipariş kalemleri. İş emrine bağlanacakları seç.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="shrink-0 space-y-2 border-b bg-muted/10 px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Sipariş no, müşteri veya kumaş ara..."
                className="h-10 pl-9"
              />
            </div>
            <div className="min-w-[220px]">
              <ReferenceSelect<Customer>
                value={customerId}
                onChange={setCustomerId}
                service={customerService}
                queryKey="customers"
                getLabel={(c) => c.name}
                placeholder="Tüm müşteriler"
                nullable
                noneLabel="— Tüm müşteriler"
              />
            </div>
            <label className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs">
              <Checkbox
                checked={showOnlySelected}
                onCheckedChange={(c) => setShowOnlySelected(Boolean(c))}
              />
              Yalnız seçilileri göster
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">Termin:</span>
            <div className="flex gap-1">
              {DEADLINE_PRESETS.map((p) => (
                <Button
                  key={p.value}
                  type="button"
                  size="sm"
                  variant={deadlinePreset === p.value ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setDeadlinePreset(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <span className="ml-2 text-muted-foreground">Sırala:</span>
            <div className="flex gap-1">
              {SORT_PRESETS.map((p) => (
                <Button
                  key={p.value}
                  type="button"
                  size="sm"
                  variant={sortBy === p.value ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setSortBy(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Body split */}
        <div className="flex min-h-0 flex-1">
          {/* Sol — orders list */}
          <div className="flex min-h-0 flex-1 flex-col">
            {anchor && !showOnlySelected && (
              <AnchorBanner
                anchor={anchor}
                hideIncompatible={hideIncompatible}
                onHideIncompatibleChange={setHideIncompatible}
              />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {showOnlySelected ? (
                groupedSelected.length === 0 ? (
                  <EmptyState text="Henüz hiçbir kalem seçilmedi." />
                ) : (
                  <ul className="divide-y">
                    {groupedSelected.map((o) => (
                      <SelectedOrderRow
                        key={o.id}
                        order={o}
                        onRemoveLine={removeLine}
                      />
                    ))}
                  </ul>
                )
              ) : query.isLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Yükleniyor...</div>
              ) : visibleFetched.length === 0 ? (
                <EmptyState
                  text={
                    anchor && hideIncompatible && sortedFetched.length > 0
                      ? "Eşleşen başka kalem yok. Tümünü görmek için banner'daki filtreyi kapat."
                      : debounced || customerId || deadlinePreset !== "all"
                        ? "Filtreyle eşleşen sipariş yok."
                        : "Müsait sipariş yok."
                  }
                />
              ) : (
                <ul className="divide-y">
                  {visibleFetched.map((order) => (
                    <FetchedOrderRow
                      key={order.id}
                      order={order}
                      selectedMap={selectedMap}
                      anchor={anchor}
                      required={required}
                      onToggleLine={(line, checked) =>
                        checked
                          ? addLine(buildPicked(order, line))
                          : removeLine(line.id)
                      }
                      onToggleOrder={(c) => toggleOrderFromFetched(order, c)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Sağ — selected panel */}
          <aside className="hidden w-[300px] shrink-0 flex-col border-l bg-muted/10 lg:flex">
            <div className="flex shrink-0 items-center justify-between border-b bg-muted/40 px-3 py-2.5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Seçilenler
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {selectedArray.length} kalem
                  </span>{" "}
                  · {totalQty.toLocaleString("tr-TR", { useGrouping: false })} m · {customerCount} müşteri
                </div>
              </div>
              {selectedArray.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={clearAllSelected}
                >
                  Temizle
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {selectedArray.length === 0 ? (
                <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  Henüz kalem seçilmedi.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {selectedArray.map((l) => (
                    <li
                      key={l.lineId}
                      className="group rounded-md border bg-card p-2 text-[11px]"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-mono text-xs font-semibold">
                          {l.orderNumber}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(l.lineId)}
                          className="-mr-1 -mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`${l.orderNumber} kaldır`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-0.5 text-muted-foreground">{l.customerName}</div>
                      {l.branchName && (
                        <div className="text-[10px] text-muted-foreground/80">
                          Şube: {l.branchName}
                          {l.branchCode ? ` (${l.branchCode})` : ""}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="font-medium">{l.itemName}</span>
                        {l.itemColorName && (
                          <Badge variant="muted" className="gap-1 text-[10px]">
                            {l.itemColorHex && (
                              <span
                                className="h-2 w-2 rounded-full border"
                                style={{ backgroundColor: l.itemColorHex }}
                              />
                            )}
                            {l.itemColorName}
                          </Badge>
                        )}
                        <span className="ml-auto tabular-nums text-muted-foreground">
                          {l.quantity.toLocaleString("tr-TR", { useGrouping: false })} m
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>

        {/* Sticky footer */}
        <DialogFooter className="shrink-0 items-center border-t bg-background px-6 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedArray.length > 0 ? (
              <>
                <span className="font-medium text-foreground">
                  {selectedArray.length} kalem
                </span>{" "}
                seçildi · {totalQty.toLocaleString("tr-TR", { useGrouping: false })} m · {customerCount} müşteri
              </>
            ) : (
              "Henüz seçim yok"
            )}
          </span>
          <div className="flex gap-2">
            {initialSelected.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleRemoveAll}
              >
                <Unlink className="h-4 w-4" />
                Tüm Bağlantıları Kaldır
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button
              type="button"
              // Boş seçim de onaylanabilmeli — başlangıçta sipariş bağlıysa
              // kullanıcı hepsini kaldırıp bağlantıyı temizleyebilir (aksi halde
              // tek çare "İptal" olur ve kaldırma geri alınırdı).
              disabled={selectedArray.length === 0 && initialSelected.length === 0}
              variant={
                selectedArray.length === 0 && initialSelected.length > 0
                  ? "destructive"
                  : "default"
              }
              onClick={handleConfirm}
            >
              {selectedArray.length > 0
                ? `${selectedArray.length} Kalemi Ekle`
                : initialSelected.length > 0
                  ? "Bağlantıyı Kaldır"
                  : "Seç"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function DeadlineBadge({ deadline }: { deadline: string | null }) {
  if (!deadline) return null;
  const tone = deadlineTone(deadline);
  const cls =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "";
  return (
    <Badge variant={tone === "muted" ? "muted" : "outline"} className={`text-[10px] ${cls}`}>
      Termin: {new Date(deadline).toLocaleDateString("tr-TR")}
    </Badge>
  );
}

function FetchedOrderRow({
  order,
  selectedMap,
  anchor,
  required,
  onToggleLine,
  onToggleOrder,
}: {
  order: Order;
  selectedMap: Map<string, PickedOrderLine>;
  anchor: Anchor | null;
  required: RequiredConstraint | null;
  onToggleLine: (line: OrderLine, checked: boolean) => void;
  onToggleOrder: (checked: boolean) => void;
}) {
  const lines = order.lines ?? [];
  const lineCompat = (l: OrderLine): string | null => {
    const target = { itemId: l.itemId, colorId: l.colorId, width: l.width ?? null };
    return (
      requiredMismatchReason(required, target) ??
      (anchor ? mismatchReason(anchor, target) : null)
    );
  };
  const compatLines = lines.filter((l) => lineCompat(l) === null);
  const allChecked =
    compatLines.length > 0 && compatLines.every((l) => selectedMap.has(l.id));
  const someChecked = compatLines.some((l) => selectedMap.has(l.id));
  const orderDisabled =
    (anchor !== null || required !== null) && compatLines.length === 0;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2">
        <Checkbox
          disabled={orderDisabled}
          checked={allChecked ? true : someChecked ? "indeterminate" : false}
          onCheckedChange={(c) => onToggleOrder(Boolean(c))}
        />
        <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-sm">{order.customer?.name}</span>
        {order.branch && (
          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
            {order.branch.name}
            {order.branch.code && (
              <span className="font-mono text-muted-foreground">· {order.branch.code}</span>
            )}
          </Badge>
        )}
        <span className="ml-auto">
          <DeadlineBadge deadline={order.deadline} />
        </span>
      </div>
      <ul className="ml-6 mt-1.5 space-y-1">
        {lines.map((line) => {
          const reason = lineCompat(line);
          const incompatible = reason !== null;
          const isSelected = selectedMap.has(line.id);
          return (
            <li key={line.id}>
              <label
                className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                  incompatible
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer hover:bg-muted/50"
                }`}
                title={incompatible ? `${reason} — bu kalem birleştirilemez` : undefined}
              >
                <Checkbox
                  checked={isSelected}
                  disabled={incompatible && !isSelected}
                  onCheckedChange={(c) => onToggleLine(line, Boolean(c))}
                />
                <span className="font-medium">{line.item?.name ?? "—"}</span>
                {line.color && (
                  <Badge variant="muted" className="gap-1 text-[10px]">
                    {line.color.hex && (
                      <span
                        className="h-2 w-2 rounded-full border"
                        style={{ backgroundColor: line.color.hex }}
                      />
                    )}
                    {line.color.name}
                  </Badge>
                )}
                <span className="tabular-nums text-muted-foreground">
                  {line.quantity.toLocaleString("tr-TR", { useGrouping: false })} m
                  {line.width ? ` × ${line.width} cm` : ""}
                </span>
                {incompatible && (
                  <Badge
                    variant="outline"
                    className="border-warning/40 bg-warning/10 text-[10px] text-warning"
                  >
                    {reason}
                  </Badge>
                )}
                {line.requiredProperties && line.requiredProperties.length > 0 && (
                  <span className="ml-auto flex flex-wrap gap-1">
                    {line.requiredProperties.map((rp) => (
                      <Badge
                        key={rp.propertyId}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {rp.property.name}
                      </Badge>
                    ))}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function AnchorBanner({
  anchor,
  hideIncompatible,
  onHideIncompatibleChange,
}: {
  anchor: Anchor;
  hideIncompatible: boolean;
  onHideIncompatibleChange: (v: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-warning/10 px-4 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0 text-warning" />
        <span className="text-foreground">
          Bu seçim sadece eşleşen kalemlerle birleştirilebilir:
        </span>
        <Badge variant="muted" className="text-[10px]">
          {anchor.itemName}
        </Badge>
        {anchor.colorId ? (
          <Badge variant="muted" className="gap-1 text-[10px]">
            {anchor.colorHex && (
              <span
                className="h-2 w-2 rounded-full border"
                style={{ backgroundColor: anchor.colorHex }}
              />
            )}
            {anchor.colorName ?? "renk"}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            renksiz
          </Badge>
        )}
        <Badge variant="muted" className="text-[10px]">
          {anchor.width != null ? `${anchor.width} cm` : "en serbest"}
        </Badge>
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-foreground">
        <Checkbox
          checked={hideIncompatible}
          onCheckedChange={(c) => onHideIncompatibleChange(Boolean(c))}
        />
        Sadece uyumluları göster
      </label>
    </div>
  );
}

function SelectedOrderRow({
  order,
  onRemoveLine,
}: {
  order: {
    id: string;
    orderNumber: string;
    customerName: string;
    branchName: string | null;
    branchCode: string | null;
    deadline: string | null;
    lines: PickedOrderLine[];
  };
  onRemoveLine: (lineId: string) => void;
}) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-sm">{order.customerName}</span>
        {order.branchName && (
          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
            {order.branchName}
            {order.branchCode && (
              <span className="font-mono text-muted-foreground">· {order.branchCode}</span>
            )}
          </Badge>
        )}
        <span className="ml-auto">
          <DeadlineBadge deadline={order.deadline} />
        </span>
      </div>
      <ul className="ml-6 mt-1.5 space-y-1">
        {order.lines.map((l) => (
          <li
            key={l.lineId}
            className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
          >
            <Checkbox
              checked
              onCheckedChange={() => onRemoveLine(l.lineId)}
            />
            <span className="font-medium">{l.itemName}</span>
            {l.itemColorName && (
              <Badge variant="muted" className="gap-1 text-[10px]">
                {l.itemColorHex && (
                  <span
                    className="h-2 w-2 rounded-full border"
                    style={{ backgroundColor: l.itemColorHex }}
                  />
                )}
                {l.itemColorName}
              </Badge>
            )}
            <span className="tabular-nums text-muted-foreground">
              {l.quantity.toLocaleString("tr-TR", { useGrouping: false })} m
              {l.width ? ` × ${l.width} cm` : ""}
            </span>
            {l.requiredProperties.length > 0 && (
              <span className="ml-auto flex flex-wrap gap-1">
                {l.requiredProperties.map((rp) => (
                  <Badge key={rp.id} variant="outline" className="text-[10px]">
                    {rp.name}
                  </Badge>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}
