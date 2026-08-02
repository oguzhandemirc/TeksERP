import { useMemo, useState } from "react";
import { FileText, Search, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { formatNumber, safeFormat } from "@/lib/format";
import { normalizeSearch } from "../roll-search";
import type { ShipmentDetail } from "../types";
import { FacetSelect } from "./FacetSelect";
import { SortableTh } from "./SortableTh";
import { DateRangeFilter, inDateRange } from "./DateRangeFilter";

const num = (v: number | null | undefined) => formatNumber(v, 1);
const toggleIn = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

type ReturnSortField = "barcode" | "item" | "sack" | "reason" | "width" | "qty" | "date";

/**
 * "İadeleri Görüntüle" modalı — bu sevkiyattan iade edilen toplar, HANGİ ÇUVALDAN
 * geldiği (RollReturn.prevSackId → sevkiyatın yüklü sacks[]'ından sackNo/seq) ve
 * sebep/metraj/tarih ile. Üstte barkod/kumaş/renk/çuval no/neden araması (client-side).
 */
export function ReturnsModal({
  d,
  open,
  onOpenChange,
}: {
  d: ShipmentDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [reasonSel, setReasonSel] = useState<string[]>([]);
  const [itemSel, setItemSel] = useState<string[]>([]);
  const [colorSel, setColorSel] = useState<string[]>([]);
  const [widthSel, setWidthSel] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState<ReturnSortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // returnedRolls[].id = RollReturn.id = RETURN_DISPATCH belgesinin sourceId'si.
  // Sevk irsaliyesi iadeyle DEĞİŞMEZ (sevk anını gösterir); iadenin resmi karşılığı
  // bu ayrı belgedir — zincirin görünür olduğu yer burası.
  const [docReturnId, setDocReturnId] = useState<string | null>(null);
  const q = normalizeSearch(search);
  const sackById = useMemo(() => new Map(d.sacks.map((s) => [s.id, s])), [d.sacks]);
  const toggleSort = (f: ReturnSortField) => {
    if (sortField === f) setSortDir((p) => (p === "asc" ? "desc" : "asc"));
    else {
      setSortField(f);
      setSortDir("asc");
    }
  };

  // Facet seçenekleri: yalnız bu sevkiyatın iadelerinde VAR OLAN neden/kumaş/renk/en.
  const { reasonOpts, itemOpts, colorOpts, widthOpts } = useMemo(() => {
    const reasons = new Set<string>();
    const items = new Map<string, string>();
    const colors = new Map<string, string>();
    const widths = new Set<number>();
    for (const r of d.returnedRolls) {
      if (r.reasonName) reasons.add(r.reasonName);
      if (r.item) items.set(r.item.code, r.item.name);
      if (r.color) colors.set(r.color.code, r.color.name);
      if (r.width != null) widths.add(r.width);
    }
    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "tr");
    return {
      reasonOpts: [...reasons].sort((a, b) => a.localeCompare(b, "tr")).map((v) => ({ value: v, label: v })),
      itemOpts: [...items].map(([value, label]) => ({ value, label })).sort(byLabel),
      colorOpts: [...colors].map(([value, label]) => ({ value, label })).sort(byLabel),
      // En: sayısal artan; value=String(en) (satır filtresiyle birebir).
      widthOpts: [...widths].sort((a, b) => a - b).map((w) => ({ value: String(w), label: `${w} cm` })),
    };
  }, [d.returnedRolls]);

  const isFiltering =
    q.length > 0 ||
    reasonSel.length > 0 ||
    itemSel.length > 0 ||
    colorSel.length > 0 ||
    widthSel.length > 0 ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  // Facet'ler ARASI VE, facet İÇİ VEYA; tarih aralığı (iade tarihi) + serbest metin (hepsi VE).
  const rows = useMemo(() => {
    return d.returnedRolls.filter((r) => {
      if (reasonSel.length && !(r.reasonName && reasonSel.includes(r.reasonName))) return false;
      if (itemSel.length && !(r.item && itemSel.includes(r.item.code))) return false;
      if (colorSel.length && !(r.color && colorSel.includes(r.color.code))) return false;
      if (widthSel.length && !(r.width != null && widthSel.includes(String(r.width)))) return false;
      if (!inDateRange(r.returnedAt, dateFrom, dateTo)) return false;
      if (!q) return true;
      const sack = r.prevSackId ? sackById.get(r.prevSackId) : null;
      const hay = [
        r.barcode ?? "",
        r.item?.name ?? "",
        r.item?.code ?? "",
        r.color?.name ?? "",
        r.reasonName ?? "",
        sack ? `${sack.seq} ${sack.sackNo}` : "",
      ]
        .join(" ")
        .toLocaleLowerCase("tr");
      return hay.includes(q);
    });
  }, [d.returnedRolls, q, sackById, reasonSel, itemSel, colorSel, widthSel, dateFrom, dateTo]);

  // Kolon başlığından sıralama (null'lar sona; sayısal alan sayısal, metin Türkçe-duyarlı,
  // tarih ISO string olduğundan alfabetik = kronolojik). Varsayılan = geldiği sıra.
  const sortedRows = useMemo(() => {
    if (!sortField) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: (typeof rows)[number]): string | number | null => {
      switch (sortField) {
        case "barcode": return r.barcode;
        case "item": return r.item?.name ?? null;
        case "sack": return r.prevSackId ? (sackById.get(r.prevSackId)?.seq ?? null) : null;
        case "reason": return r.reasonName;
        case "width": return r.width;
        case "qty": return r.qty;
        case "date": return r.returnedAt;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "tr") * dir;
    });
  }, [rows, sortField, sortDir, sackById]);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-4 w-4" /> İadeler
            <span className="text-sm font-normal text-muted-foreground">
              {d.summary.returnedCount} top · {num(d.summary.returnedMeters)} m
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Barkod, kumaş, renk, çuval no, neden ara..."
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FacetSelect
              label="Neden"
              options={reasonOpts}
              selected={reasonSel}
              onToggle={(v) => setReasonSel((p) => toggleIn(p, v))}
              onClear={() => setReasonSel([])}
            />
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
            <DateRangeFilter label="Tarih" from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {isFiltering ? `${rows.length}/${d.returnedRolls.length}` : `${d.returnedRolls.length}`} iade
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                {isFiltering ? "Filtreye uyan iade yok." : "İade yok."}
              </div>
            </div>
          ) : (
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b text-muted-foreground [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                  <SortableTh field="barcode" label="Barkod" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                  <SortableTh field="item" label="Kumaş" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                  <SortableTh field="sack" label="Çuval" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                  <SortableTh field="reason" label="Neden" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                  <SortableTh field="width" label="En" align="right" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                  <SortableTh field="qty" label="Metraj" align="right" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                  <SortableTh field="date" label="Tarih" align="right" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                  <th className="px-2 py-1.5 text-right font-medium">Belge</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => {
                  const sack = r.prevSackId ? sackById.get(r.prevSackId) : null;
                  return (
                    <tr key={r.id} className="border-b last:border-0 [&>td]:px-2 [&>td]:py-1.5">
                      <td className="text-left font-mono">{r.barcode ?? "—"}</td>
                      <td className="text-left">
                        {r.item?.name ?? "—"}
                        {r.color && <span className="text-muted-foreground"> · {r.color.name}</span>}
                      </td>
                      <td className="text-left">
                        {sack ? (
                          <span>
                            Çuval #{sack.seq}{" "}
                            <span className="font-mono text-[11px] text-muted-foreground">{sack.sackNo}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-left">
                        {r.reasonName ? (
                          <span
                            className="rounded px-1 py-0.5 text-[10px]"
                            style={
                              r.reasonColor
                                ? { backgroundColor: `${r.reasonColor}22`, color: r.reasonColor }
                                : undefined
                            }
                          >
                            {r.reasonName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-right text-muted-foreground">
                        {r.width != null ? `${num(r.width)} cm` : "—"}
                      </td>
                      <td className="text-right font-medium">{num(r.qty)} m</td>
                      <td className="text-right text-muted-foreground">
                        {safeFormat(r.returnedAt, "dd.MM.yyyy")}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => setDocReturnId(r.id)}
                          title="İade irsaliyesini aç"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <FileText className="h-3 w-3" /> İrsaliye
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
    <PrintedDocDialog
      docType="RETURN_DISPATCH"
      sourceId={docReturnId}
      open={Boolean(docReturnId)}
      onOpenChange={(o) => !o && setDocReturnId(null)}
      title="İade İrsaliyesi"
      description="Müşteriden dönen topun kabul belgesi."
      writePermission="return:write"
    />
    </>
  );
}
