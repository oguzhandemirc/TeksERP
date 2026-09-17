// =============================================================================
// TEDARİKÇİ SEÇİCİ MODALI (v3, sıfırdan) — Radix Select rol · düz `ui/table` · `useInfiniteScroll` doğrudan
// =============================================================================
// Kullanıcı kararı (2026-09-16 03:55): önceki yazım Electron dev oturumunda rol kutusu değişince
// renderer'ı senkron döngüye sokuyordu (kök neden kovalanmadı); yeniden yazım şüpheli üç parçayı
// YAPISAL olarak dışarıda bırakır — yerleşik <select> yok (Radix `ui/select`, Dialog içinde emsal
// `CustomerFormDialog`), `DataTable`/`useReactTable`/pagination cast'i yok, iki bağımsız sorgu yok
// (`useSupplierPickerData` tek sonsuz sorgu). Kaydırma kabı TEK, sentinel dipte; arama + Yön × Fason SUNUCUDA.
// =============================================================================
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { cn } from "@/lib/utils";
import { supplierLoadNotice, type SupplierParty } from "./supplierParty";
import { PICKER_ROLE_DEFAULTS, STATUS_DEFAULT, type PickerList, type PickerMode, type PickerRoleFilter, type StatusFilter, type SupplierPickerRow } from "./supplierPicker";
import { isRoleFilterDirty } from "@/lib/partnerRoles";
import { useSupplierPickerData } from "./useSupplierPickerData";
import { SupplierPickerToolbar } from "./SupplierPickerToolbar";
import { ConvertBackLink, ConvertCustomerConfirm, ConvertCustomerLink, useCanConvertCustomer } from "./SupplierConvertCustomer";

export const SUPPLIER_PICKER_EMPTY = "Tedarikçi kartı yok — Tanımlar → İş Ortakları → Cariler'den ya da buradaki Yeni cari düğmesiyle açın.";
export const CUSTOMER_PICKER_EMPTY = "Müşteri kartı yok — Tanımlar → İş Ortakları → Cariler'den ya da buradaki Yeni müşteri düğmesiyle açın.";
export const CUSTOMER_ONLY_EMPTY = "Yalnız müşteri tipli kart yok — bütün cari kartlar zaten tedarikçi listesinde.";
export const CARI_PICKER_EMPTY = "Cari kartı yok — Tanımlar → İş Ortakları → Cariler'den açın.";
export const SUPPLIER_PICKER_FILTERED_EMPTY = "Süzgece uyan kayıt yok.";
/** Kolonlar listeye göre: tedarikçi Rol taşır (cari/fason karışık), müşteri listeleri Şehir taşır (yalnız cari). */
const HEADERS: Record<PickerList, readonly string[]> = {
  supplier: ["Kod", "Ünvan", "Rol", "Vergi No", "Telefon"],
  "supplier-cari": ["Kod", "Ünvan", "Rol", "Vergi No", "Telefon"],
  customer: ["Kod", "Ünvan", "Şehir", "Vergi No", "Telefon"],
  "customer-only": ["Kod", "Ünvan", "Şehir", "Vergi No", "Telefon"],
  cari: ["Kod", "Ünvan", "Rol", "Vergi No", "Telefon"],
};
const TITLE: Record<PickerList, { title: string; description: string }> = {
  supplier: { title: "Tedarikçi seç", description: "Tedarikçi ve alıcı + satıcı cari kartlar ile fason firmalar tek listede; kaydırdıkça yüklenir, satıra tıklayınca seçilir." },
  "supplier-cari": { title: "Bağlanacak cari kartı seç", description: "Tedarikçi ve alıcı + satıcı cari kartlar; fason firmalar bu listede yok. Satıra tıklayınca fason profili o karta bağlanır." },
  customer: { title: "Müşteri seç", description: "Müşteri ve alıcı + satıcı kartlar tek listede; kaydırdıkça yüklenir, satıra tıklayınca seçilir." },
  "customer-only": { title: "Müşteri kartını tedarikçi de yap", description: "Yalnız müşteri tipli kartlar; satıra tıklayınca onay sorulur, kart Müşteri + Tedarikçi olur ve seçilir." },
  cari: { title: "Cari seç", description: "Müşteri, tedarikçi ve fason rollü bütün cari kartlar tek listede; kaydırdıkça yüklenir, satıra tıklayınca seçilir." },
};
const EMPTY: Record<PickerList, string> = { supplier: SUPPLIER_PICKER_EMPTY, "supplier-cari": SUPPLIER_PICKER_EMPTY, customer: CUSTOMER_PICKER_EMPTY, "customer-only": CUSTOMER_ONLY_EMPTY, cari: CARI_PICKER_EMPTY };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (party: SupplierParty) => void;
  includeInactive?: boolean;
  /** Varsayılan tedarikçi (alış). Müşteri kipi: satış siparişi (sipariş formu ①). */
  mode?: PickerMode;
  /** Yalnız cari tedarikçiler (SUPPLIER/BOTH; fason bacağı ve dönüştürme kapısı yok) — fason profilinin "Bağlı cari" alanı. */
  cariOnly?: boolean;
}

/** Rozet tonu: fason firması ikincil; cari satırı tedarikçi rolüyle birincil, yalnız-müşteri (dönüştürme görünümü) soluk. */
function roleBadgeVariant(r: SupplierPickerRow): "secondary" | "muted" | "default" {
  if (r.kind === "SUBCONTRACTOR") return "secondary";
  return r.roleLabel.includes("Tedarikçi") ? "default" : "muted";
}

function PickerRow({ r, list, onPick }: { r: SupplierPickerRow; list: PickerList; onPick: (r: SupplierPickerRow) => void }) {
  return (
    <TableRow className={cn("cursor-pointer", !r.isActive && "opacity-60")} onClick={() => onPick(r)}>
      <TableCell className="py-1.5 font-mono text-xs">{r.code ?? "—"}</TableCell>
      <TableCell className="py-1.5 font-medium">
        {r.name}
        {!r.isActive && <span className="ml-1 text-xs text-muted-foreground">(pasif)</span>}
      </TableCell>
      {list === "supplier" || list === "supplier-cari" || list === "cari" ? (
        <TableCell className="py-1.5">
          <Badge variant={roleBadgeVariant(r)}>{r.roleLabel}</Badge>
        </TableCell>
      ) : (
        <TableCell className="py-1.5 text-xs">{r.city ?? <span className="text-muted-foreground">—</span>}</TableCell>
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

export function SupplierPickerModal({ open, onOpenChange, onPick, includeInactive = false, mode = "supplier", cariOnly = false }: Props) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 250);
  const [filters, setFilters] = useState<PickerRoleFilter>(PICKER_ROLE_DEFAULTS);
  // Cari kipi: Durum süzgeci (varsayılan Aktif); öbür kipler `includeInactive` prop'uyla gelir.
  const [status, setStatus] = useState<StatusFilter>(STATUS_DEFAULT);
  // Dönüştürme görünümü (yalnız tedarikçi kipi + customer:write): liste müşteri-only, satır → onay → BOTH.
  const canConvert = useCanConvertCustomer() && mode === "supplier" && !cariOnly;
  const [converting, setConverting] = useState(false);
  const [convertRow, setConvertRow] = useState<SupplierPickerRow | null>(null);
  const list: PickerList = converting ? "customer-only" : cariOnly && mode === "supplier" ? "supplier-cari" : mode;
  const data = useSupplierPickerData({ open, search, filters, includeInactive, list, status: mode === "cari" ? status : undefined });
  const headers = HEADERS[list];
  const { rootRef, sentinelRef } = useInfiniteScroll({ hasMore: data.hasMore, isLoading: data.isFetchingNext, onLoadMore: data.fetchNext, enabled: open });
  const notice = supplierLoadNotice({ customersError: data.customersError, subcontractorsError: data.subcontractorsError, loading: data.isLoading });
  // Kapanış dönüştürme görünümünü SIFIRLAR (arama/rol kalır): yeniden açılış hep tedarikçi listesidir.
  const setOpen = (o: boolean) => {
    if (!o) setConverting(false);
    onOpenChange(o);
  };
  const pick = (p: SupplierParty) => {
    onPick(p);
    setOpen(false);
  };
  const onRow = (r: SupplierPickerRow) => (converting ? setConvertRow(r) : pick({ kind: r.kind, id: r.id }));
  const emptyText = search || ((isRoleFilterDirty(filters) || (mode === "cari" && status !== STATUS_DEFAULT)) && !converting) ? SUPPLIER_PICKER_FILTERED_EMPTY : EMPTY[list];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Yükseklik SABİT (h-[85vh]): süzgeç/arama sonucu azalınca modal kısalmasın (kullanıcı isteği);
          liste kabı `min-h-0 flex-1` boşlukta da yerini korur. */}
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{TITLE[list].title}</DialogTitle>
          <DialogDescription>{TITLE[list].description}</DialogDescription>
        </DialogHeader>
        <SupplierPickerToolbar mode={mode} converting={converting} searchInput={searchInput} onSearchInput={setSearchInput} filters={filters} onFilters={setFilters} onCreated={pick} status={mode === "cari" ? status : undefined} onStatus={setStatus} />
        {canConvert && (converting ? <ConvertBackLink onClick={() => setConverting(false)} /> : <ConvertCustomerLink onClick={() => setConverting(true)} />)}
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
                <PickerRow key={r.key} r={r} list={list} onPick={onRow} />
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
        {canConvert && <ConvertCustomerConfirm row={convertRow} onCancel={() => setConvertRow(null)} onConverted={pick} />}
      </DialogContent>
    </Dialog>
  );
}
