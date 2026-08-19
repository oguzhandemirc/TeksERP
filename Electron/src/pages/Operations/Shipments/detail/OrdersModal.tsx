import { useMemo, useState } from "react";
import { ClipboardList, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatNumber, safeFormat } from "@/lib/format";
import { normalizeSearch } from "../roll-search";
import type { ShipmentDetail, ShipmentDetailLine } from "../types";
import { FacetSelect } from "./FacetSelect";
import { SortableTh } from "./SortableTh";
import { DateRangeFilter, inDateRange } from "./DateRangeFilter";
import { foldSearchText } from "@/lib/search-fold";
import { trCompare } from "@/lib/collate";

const int = (v: number | null | undefined) => formatNumber(v, 0);
const num = (v: number | null | undefined) => formatNumber(v, 1);
const toggleIn = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

type OrderSortField =
  | "order" | "item" | "color" | "width" | "requested" | "shipped" | "open" | "thisShip";

interface OrderRow {
  key: string;
  orderNumber: string;
  deadline: string | null;
  l: ShipmentDetailLine;
}

/**
 * "Siparişleri Görüntüle" modalı — bu sevkiyata bağlı sipariş satırları DÜZ tabloda
 * (satır başına bir sipariş satırı): arama (sipariş no/kumaş/renk) + facet (Kumaş/Renk)
 * + sütun başlığından sıralama. İadeler modalıyla aynı desen; client-side.
 */
export function OrdersModal({
  d,
  open,
  onOpenChange,
}: {
  d: ShipmentDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [itemSel, setItemSel] = useState<string[]>([]);
  const [colorSel, setColorSel] = useState<string[]>([]);
  const [widthSel, setWidthSel] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState<OrderSortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const q = normalizeSearch(search);
  const toggleSort = (f: OrderSortField) => {
    if (sortField === f) setSortDir((p) => (p === "asc" ? "desc" : "asc"));
    else {
      setSortField(f);
      setSortDir("asc");
    }
  };

  // Sipariş → satır düzleştirme (satır başına bir sipariş satırı).
  const flat = useMemo<OrderRow[]>(
    () =>
      d.orders.flatMap((o) =>
        o.lines.map((l) => ({ key: l.lineId, orderNumber: o.orderNumber, deadline: o.deadline, l })),
      ),
    [d.orders],
  );

  // Facet seçenekleri: yalnız bu sevkiyatın satırlarında VAR OLAN kumaş/renk/en.
  const { itemOpts, colorOpts, widthOpts } = useMemo(() => {
    const items = new Map<string, string>();
    const colors = new Map<string, string>();
    const widths = new Set<number>();
    for (const { l } of flat) {
      items.set(l.item.code, l.item.name);
      if (l.color) colors.set(l.color.code, l.color.name);
      if (l.width != null) widths.add(l.width);
    }
    const byLabel = (a: { label: string }, b: { label: string }) => trCompare(a.label, b.label);
    return {
      itemOpts: [...items].map(([value, label]) => ({ value, label })).sort(byLabel),
      colorOpts: [...colors].map(([value, label]) => ({ value, label })).sort(byLabel),
      // En: sayısal artan; value=String(en) (satır filtresiyle birebir).
      widthOpts: [...widths].sort((a, b) => a - b).map((w) => ({ value: String(w), label: `${w} cm` })),
    };
  }, [flat]);

  const isFiltering =
    q.length > 0 ||
    itemSel.length > 0 ||
    colorSel.length > 0 ||
    widthSel.length > 0 ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  // Tarih aralığı = sipariş TERMİNİ (deadline); terminsiz satır, tarih filtresi aktifken dışlanır.
  const rows = useMemo(() => {
    return flat.filter(({ orderNumber, deadline, l }) => {
      if (itemSel.length && !itemSel.includes(l.item.code)) return false;
      if (colorSel.length && !(l.color && colorSel.includes(l.color.code))) return false;
      if (widthSel.length && !(l.width != null && widthSel.includes(String(l.width)))) return false;
      if (!inDateRange(deadline, dateFrom, dateTo)) return false;
      if (!q) return true;
      const hay = foldSearchText(
        [orderNumber, l.item.name, l.item.code, l.color?.name ?? ""].join(" "),
      );
      return hay.includes(q);
    });
  }, [flat, q, itemSel, colorSel, widthSel, dateFrom, dateTo]);

  const sortedRows = useMemo(() => {
    if (!sortField) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: OrderRow): string | number | null => {
      switch (sortField) {
        case "order": return r.orderNumber;
        case "item": return r.l.item.name;
        case "color": return r.l.color?.name ?? null;
        case "width": return r.l.width;
        case "requested": return r.l.requested;
        case "shipped": return r.l.shipped;
        case "open": return r.l.openQty;
        case "thisShip": return r.l.thisShipment;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return trCompare(String(av), String(bv)) * dir;
    });
  }, [rows, sortField, sortDir]);

  const th = (field: OrderSortField, label: string, align?: "left" | "right") => (
    <SortableTh field={field} label={label} align={align} activeField={sortField} dir={sortDir} onSort={toggleSort} />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Siparişler
            <span className="text-sm font-normal text-muted-foreground">
              {d.orders.length} sipariş · {flat.length} satır
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sipariş no, kumaş, renk ara..."
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FacetSelect
              label="Kumaş"
              options={itemOpts}
              selected={itemSel}
              onToggle={(v) => setItemSel((p) => toggleIn(p, v))}
              onClear={() => setItemSel([])}
            />
            <FacetSelect
              label="Renk"
              options={colorOpts}
              selected={colorSel}
              onToggle={(v) => setColorSel((p) => toggleIn(p, v))}
              onClear={() => setColorSel([])}
            />
            <FacetSelect
              label="En"
              options={widthOpts}
              selected={widthSel}
              onToggle={(v) => setWidthSel((p) => toggleIn(p, v))}
              onClear={() => setWidthSel([])}
            />
            <DateRangeFilter label="Termin" from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {isFiltering ? `${rows.length}/${flat.length}` : `${flat.length}`} satır
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {sortedRows.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                {isFiltering ? "Filtreye uyan sipariş satırı yok." : "Bu sevkiyata bağlı sipariş yok."}
              </div>
            </div>
          ) : (
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b text-muted-foreground [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                  {th("order", "Sipariş")}
                  {th("item", "Kumaş")}
                  {th("color", "Renk")}
                  {th("width", "En", "right")}
                  {th("requested", "İstenen", "right")}
                  {th("shipped", "Sevk", "right")}
                  {th("open", "Açık", "right")}
                  {th("thisShip", "Bu sevk", "right")}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.key} className="border-b last:border-0 [&>td]:px-2 [&>td]:py-1.5">
                    <td className="text-left">
                      <span className="font-mono">{r.orderNumber}</span>
                      {r.deadline && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          {safeFormat(r.deadline, "dd.MM.yy")}
                        </span>
                      )}
                    </td>
                    <td className="text-left">
                      {r.l.item.name}
                      {r.l.customerItemName && (
                        <span className="text-muted-foreground"> ({r.l.customerItemName})</span>
                      )}
                    </td>
                    <td className="text-left text-muted-foreground">{r.l.color?.name ?? "—"}</td>
                    <td className="text-right text-muted-foreground">
                      {r.l.width != null ? `${num(r.l.width)} cm` : "—"}
                    </td>
                    <td className="text-right text-muted-foreground">{int(r.l.requested)}</td>
                    <td className="text-right text-muted-foreground">{int(r.l.shipped)}</td>
                    <td className="text-right text-muted-foreground">{int(r.l.openQty)}</td>
                    <td className="text-right font-semibold">{int(r.l.thisShipment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
