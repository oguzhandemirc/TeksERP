// =============================================================================
// ÜRÜN SEÇİCİ MODALI (v3 kalıbı, tedarikçi modalı emsali) — Radix Select ×3 · düz `ui/table` · `useInfiniteScroll` doğrudan
// =============================================================================
// Yapısal yasaklar v3 ile aynı ve kaynak taramasıyla ölçülür: yerleşik <select> yok (Radix `ui/select`), DataTable /
// useReactTable / pagination cast'i yok, liste için iki sorgu yok (`useItemPickerData` tek sonsuz sorgu). Kaydırma kabı
// TEK, sentinel dipte. Boy `h-[85vh]` SABİT (kullanıcı isteği: süzünce modal boyu değişmesin). Arama + Tür · Renk ·
// Özellik SUNUCUDA; renk/özellik süzgecinde "listesi boş ürünler her renkte görünür" ipucu başlıkta.
// =============================================================================
import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { cn } from "@/lib/utils";
import {
  ITEM_PICKER_ANY,
  ITEM_PICKER_EMPTY,
  ITEM_PICKER_FILTERED_EMPTY,
  ITEM_PICKER_INITIAL,
  ITEM_TYPE_FILTER_OPTIONS,
  ITEM_TYPE_LABEL,
  hasItemPickerFilter,
  type ItemPickerFilterState,
  type ItemPickerRow,
  type ItemTypeFilter,
} from "./itemPicker";
import { useItemPickerCatalogs, useItemPickerData, type CatalogOption } from "./useItemPickerData";

const HEADERS = ["Kod", "Ad", "Tür", "Birim", "Renkler", "Özellikler"] as const;
const CATALOG_HINT = "Listesi boş ürünler her seçenekte görünür";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (row: ItemPickerRow) => void;
}

function typeBadgeVariant(t: ItemPickerRow["itemType"]): "default" | "secondary" | "muted" {
  if (t === "FABRIC") return "default";
  if (t === "YARN") return "secondary";
  return "muted";
}

function ColorCells({ r }: { r: ItemPickerRow }) {
  if (r.colors.length === 0) return <span className="text-xs text-muted-foreground">Tümü</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {r.colors.map((c) => (
        <Badge key={c.code} variant="outline" className="gap-1 font-normal">
          {c.hex && <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: c.hex }} />}
          {c.name}
        </Badge>
      ))}
      {r.colorMore > 0 && <span className="text-xs text-muted-foreground">+{r.colorMore}</span>}
    </span>
  );
}

function PickerRow({ r, onPick }: { r: ItemPickerRow; onPick: (row: ItemPickerRow) => void }) {
  return (
    <TableRow className={cn("cursor-pointer", !r.isActive && "opacity-60")} onClick={() => onPick(r)}>
      <TableCell className="py-1.5 font-mono text-xs">{r.code}</TableCell>
      <TableCell className="py-1.5 font-medium">{r.name}</TableCell>
      <TableCell className="py-1.5">
        <Badge variant={typeBadgeVariant(r.itemType)}>{ITEM_TYPE_LABEL[r.itemType]}</Badge>
      </TableCell>
      <TableCell className="py-1.5 text-xs">{r.unit}</TableCell>
      <TableCell className="py-1.5">
        <ColorCells r={r} />
      </TableCell>
      <TableCell className="py-1.5 text-xs">
        {r.properties.length === 0 ? <span className="text-muted-foreground">—</span> : r.properties.join(", ") + (r.propertyMore > 0 ? ` +${r.propertyMore}` : "")}
      </TableCell>
    </TableRow>
  );
}

/** Katalog seçicisi (Renk / Özellik): "Tümü" + katalog; katalog sığmadıysa (`null`) hiç çizilmez, liste çalışır. */
function CatalogSelect({ label, value, options, onChange }: { label: string; value: string | null; options: CatalogOption[] | null; onChange: (v: string | null) => void }) {
  if (options === null) return null;
  return (
    <Select value={value ?? ITEM_PICKER_ANY} onValueChange={(v) => onChange(v === ITEM_PICKER_ANY ? null : v)}>
      <SelectTrigger aria-label={label} title={CATALOG_HINT} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ITEM_PICKER_ANY}>Tümü</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatusLine({ count, hasMore, isFetchingNext, isError }: { count: number; hasMore: boolean; isFetchingNext: boolean; isError: boolean }) {
  return (
    <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
      <span>Yüklü {count} ürün</span>
      {isError ? (
        <span className="text-destructive">Liste alınamadı — tekrar deneyin.</span>
      ) : isFetchingNext ? (
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Yükleniyor…
        </span>
      ) : hasMore ? null : (
        <span>Tüm ürünler yüklendi</span>
      )}
    </div>
  );
}

export function ItemPickerModal({ open, onOpenChange, onPick }: Props) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 250);
  const [filter, setFilter] = useState<ItemPickerFilterState>(ITEM_PICKER_INITIAL);
  const data = useItemPickerData({ open, search, filter });
  const catalogs = useItemPickerCatalogs(open);
  const { rootRef, sentinelRef } = useInfiniteScroll({ hasMore: data.hasMore, isLoading: data.isFetchingNext, onLoadMore: data.fetchNext, enabled: open });
  const pick = (row: ItemPickerRow) => {
    onPick(row);
    onOpenChange(false);
  };
  const emptyText = search || hasItemPickerFilter(filter) ? ITEM_PICKER_FILTERED_EMPTY : ITEM_PICKER_EMPTY;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Ürün seç</DialogTitle>
          <DialogDescription>Bütün ürün kartları tek listede; kaydırdıkça yüklenir, satıra tıklayınca seçilir. Renk/özellik süzgeci "bu rengi alabilecek ürünler"i gösterir.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Ürün ara" placeholder="Kod, ad…" className="pl-8" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} autoFocus />
          </div>
          <Select value={filter.type} onValueChange={(v) => setFilter((f) => ({ ...f, type: v as ItemTypeFilter }))}>
            <SelectTrigger aria-label="Tür" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITEM_TYPE_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CatalogSelect label="Renk" value={filter.colorId} options={catalogs.colors} onChange={(v) => setFilter((f) => ({ ...f, colorId: v }))} />
          <CatalogSelect label="Özellik" value={filter.propertyId} options={catalogs.properties} onChange={(v) => setFilter((f) => ({ ...f, propertyId: v }))} />
        </div>
        <div ref={rootRef} className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {HEADERS.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <PickerRow key={r.id} r={r} onPick={pick} />
              ))}
              {!data.isLoading && data.rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={HEADERS.length} className="py-6 text-center text-sm text-muted-foreground">
                    {data.isError ? "Liste alınamadı." : emptyText}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div ref={sentinelRef} aria-hidden className="h-px w-full" />
        </div>
        <StatusLine count={data.rows.length} hasMore={data.hasMore} isFetchingNext={data.isFetchingNext || data.isLoading} isError={data.isError} />
      </DialogContent>
    </Dialog>
  );
}
