// =============================================================================
// TEDARİKÇİ SEÇİCİ MODALI (v3, sıfırdan) — Radix Select rol · düz `ui/table` · `useInfiniteScroll` doğrudan
// =============================================================================
// Kullanıcı kararı (2026-09-16 03:55): önceki yazım Electron dev oturumunda rol kutusu değişince
// renderer'ı senkron döngüye sokuyordu (kök neden kovalanmadı); yeniden yazım şüpheli üç parçayı
// YAPISAL olarak dışarıda bırakır — yerleşik <select> yok (Radix `ui/select`, Dialog içinde emsal
// `CustomerFormDialog`), `DataTable`/`useReactTable`/pagination cast'i yok, iki bağımsız sorgu yok
// (`useSupplierPickerData` tek sonsuz sorgu). Kaydırma kabı TEK, sentinel dipte; arama + rol SUNUCUDA.
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
import { supplierLoadNotice, type SupplierParty } from "./supplierParty";
import { SUPPLIER_ROLE_LABEL, roleFilterOptions, type PickerMode, type SupplierPickerRow, type SupplierRoleFilter } from "./supplierPicker";
import { useSupplierPickerData } from "./useSupplierPickerData";
import { SupplierQuickCreate } from "./SupplierQuickCreate";

export const SUPPLIER_PICKER_EMPTY = "Tedarikçi kartı yok — Tanımlar → İş Ortakları → Cariler'den ya da buradaki Yeni cari düğmesiyle açın.";
export const CUSTOMER_PICKER_EMPTY = "Müşteri kartı yok — Tanımlar → İş Ortakları → Cariler'den ya da buradaki Yeni müşteri düğmesiyle açın.";
export const SUPPLIER_PICKER_FILTERED_EMPTY = "Süzgece uyan kayıt yok.";
/** Kolonlar kipe göre: tedarikçi Rol taşır (cari/fason karışık), müşteri Şehir taşır (yalnız cari). */
const HEADERS: Record<PickerMode, readonly string[]> = {
  supplier: ["Kod", "Ünvan", "Rol", "Vergi No", "Telefon"],
  customer: ["Kod", "Ünvan", "Şehir", "Vergi No", "Telefon"],
};
const TITLE: Record<PickerMode, { title: string; description: string }> = {
  supplier: { title: "Tedarikçi seç", description: "Bütün cari kartlar ve fason firmalar tek listede; kaydırdıkça yüklenir, satıra tıklayınca seçilir." },
  customer: { title: "Müşteri seç", description: "Müşteri ve alıcı + satıcı kartlar tek listede; kaydırdıkça yüklenir, satıra tıklayınca seçilir." },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (party: SupplierParty) => void;
  includeInactive?: boolean;
  /** Varsayılan tedarikçi (alış). Müşteri kipi: satış siparişi (sipariş formu ①). */
  mode?: PickerMode;
}

function roleBadgeVariant(role: SupplierPickerRow["role"]): "secondary" | "muted" | "default" {
  if (role === "SUBCONTRACTOR") return "secondary";
  if (role === "CUSTOMER") return "muted";
  return "default";
}

function PickerRow({ r, mode, onPick }: { r: SupplierPickerRow; mode: PickerMode; onPick: (p: SupplierParty) => void }) {
  return (
    <TableRow className={cn("cursor-pointer", !r.isActive && "opacity-60")} onClick={() => onPick({ kind: r.kind, id: r.id })}>
      <TableCell className="py-1.5 font-mono text-xs">{r.code ?? "—"}</TableCell>
      <TableCell className="py-1.5 font-medium">
        {r.name}
        {!r.isActive && <span className="ml-1 text-xs text-muted-foreground">(pasif)</span>}
      </TableCell>
      {mode === "customer" ? (
        <TableCell className="py-1.5 text-xs">{r.city ?? <span className="text-muted-foreground">—</span>}</TableCell>
      ) : (
        <TableCell className="py-1.5">
          <Badge variant={roleBadgeVariant(r.role)}>{SUPPLIER_ROLE_LABEL[r.role]}</Badge>
        </TableCell>
      )}
      <TableCell className="py-1.5 text-xs">{r.taxNumber ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="py-1.5 text-xs">{r.phone ?? <span className="text-muted-foreground">—</span>}</TableCell>
    </TableRow>
  );
}

function StatusLine({ count, hasMore, isFetchingNext }: { count: number; hasMore: boolean; isFetchingNext: boolean }) {
  return (
    <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
      <span>Yüklü {count} kayıt</span>
      {isFetchingNext ? (
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Yükleniyor…
        </span>
      ) : hasMore ? null : (
        <span>Tüm kayıtlar yüklendi</span>
      )}
    </div>
  );
}

export function SupplierPickerModal({ open, onOpenChange, onPick, includeInactive = false, mode = "supplier" }: Props) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 250);
  const [role, setRole] = useState<SupplierRoleFilter>("ALL");
  const data = useSupplierPickerData({ open, search, role, includeInactive, mode });
  const headers = HEADERS[mode];
  const { rootRef, sentinelRef } = useInfiniteScroll({ hasMore: data.hasMore, isLoading: data.isFetchingNext, onLoadMore: data.fetchNext, enabled: open });
  const notice = supplierLoadNotice({ customersError: data.customersError, subcontractorsError: data.subcontractorsError, loading: data.isLoading });
  const pick = (p: SupplierParty) => {
    onPick(p);
    onOpenChange(false);
  };
  const emptyText = search || role !== "ALL" ? SUPPLIER_PICKER_FILTERED_EMPTY : mode === "customer" ? CUSTOMER_PICKER_EMPTY : SUPPLIER_PICKER_EMPTY;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Yükseklik SABİT (h-[85vh]): süzgeç/arama sonucu azalınca modal kısalmasın (kullanıcı isteği);
          liste kabı `min-h-0 flex-1` boşlukta da yerini korur. */}
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{TITLE[mode].title}</DialogTitle>
          <DialogDescription>{TITLE[mode].description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label={mode === "customer" ? "Müşteri ara" : "Tedarikçi ara"} placeholder="Kod, ünvan, vergi no…" className="pl-8" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} autoFocus />
          </div>
          <Select value={role} onValueChange={(v) => setRole(v as SupplierRoleFilter)}>
            <SelectTrigger aria-label="Rol" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleFilterOptions(mode).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SupplierQuickCreate onCreated={pick} mode={mode} />
        </div>
        {notice && <p className={cn("text-xs", notice.tone === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-500")}>{notice.message}</p>}
        <div ref={rootRef} className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {headers.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <PickerRow key={r.key} r={r} mode={mode} onPick={pick} />
              ))}
              {!data.isLoading && data.rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={headers.length} className="py-6 text-center text-sm text-muted-foreground">
                    {emptyText}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div ref={sentinelRef} aria-hidden className="h-px w-full" />
        </div>
        <StatusLine count={data.rows.length} hasMore={data.hasMore} isFetchingNext={data.isFetchingNext || data.isLoading} />
      </DialogContent>
    </Dialog>
  );
}
