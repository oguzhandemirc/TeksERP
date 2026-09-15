// =============================================================================
// TEDARİKÇİ SEÇİCİ (C4) — İKİ KAYNAK, TEK KUTU
// =============================================================================
// Alış artık her cariden yapılabiliyor ve cari kartları iki tabloda yaşıyor
// (`Customer` + `Subcontractor`). Kullanıcıya "önce hangi tür tedarikçi" diye
// sormak, cevabı sistemde ZATEN olan bir soruyu sormaktır: kullanıcı firmanın
// adını bilir, hangi tabloda durduğunu bilmez (ve bilmek zorunda değil).
//
// ⚠️ `ReferenceSelect` KOPYALANMADI ama GENİŞLETİLMEDİ de: o bileşen TEK
// `service` alır ve sonucu tek grup çizer. İki kaynağı ona sığdırmanın tek yolu
// sahte bir birleşik `CrudService` uydurmaktı — o da "Cari kartlar / Fason
// firmalar" başlıklarını imkânsız kılardı ve başlıksız karışık liste, aynı ada
// sahip iki kaydı ayırt edilemez yapar. Burada yalnız arama/etiket önbelleği
// deseni ödünç alındı.
//
// ⚠️ SÜZME SUNUCUDA: iki uç da `search` alıyor ve listeler sayfalı. İstemcide
// süzmek yalnız ilk 50 satırı süzer ve kullanıcı "firma kayıtlı değil" sanır.
//
// ⚠️ İKİ SORGU AYRI: biri düşerse diğeri çizilmeye devam eder ve durum
// `supplierLoadNotice` ile AÇIKÇA söylenir. Tek sorguda birleştirilseydi bir
// tarafın hatası diğerini de yutardı; ayrı ayrı sorup sessizce yarım liste
// göstermek ise daha kötüsü olurdu (bkz. saf katman başlığı).
//
// ⚠️ SEÇİLİ KAYIT LİSTEDE OLMAYABİLİR (düzenleme / siparişten devralma): etiket
// o zaman id ile ayrıca çözülür — kutunun boş görünüp state'in dolu olması,
// projede adı konmuş bir yalan sınıfıdır (`PurchaseOrderPicker` başlığı).
// =============================================================================
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, ListFilter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Customer } from "@/pages/Customers/types";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import {
  SUPPLIER_GROUP_LABEL,
  SUPPLIER_KIND_TAG,
  parseSupplierPartyKey,
  sameSupplierParty,
  supplierListFilters,
  supplierLoadNotice,
  supplierOptionLabel,
  supplierPartyKey,
  toSupplierOptions,
  type SupplierOption,
  type SupplierParty,
} from "./supplierParty";
import { SupplierPickerModal } from "./SupplierPickerModal";

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 200;
const NONE_KEY = "__none__";

interface Props {
  value: SupplierParty | null;
  onChange: (value: SupplierParty | null) => void;
  /** Çağıran kaydı elinde tutuyorsa etiket — id ile ikinci istek atılmaz. */
  selectedLabel?: string | null;
  placeholder?: string;
  /** "Tedarikçisiz" seçeneği çizilsin mi (mal kabulde meşru, siparişte değil). */
  nullable?: boolean;
  noneLabel?: string;
  /**
   * PASİF kayıtlar da listelensin mi — **FİLTRE bağlamında `true`**.
   *
   * ⚠️ Varsayılan `false` (yalnız aktif) çünkü bileşenin çoğunluk kullanımı
   * YAZMA'dır ve backend pasif tedarikçiyi reddeder. Ama bir LİSTE FİLTRESİNDE
   * aynı süzgeç, sezon sonunda pasifleştirilmiş bir tedarikçinin geçmiş
   * siparişlerini ARANAMAZ yapar — kartı kapatmak geçmişini kilitlemek değildir
   * (`supplierListFilters` başlığındaki emsal karar). Pasif satırlar "(pasif)"
   * etiketiyle çizilir.
   */
  includeInactive?: boolean;
  disabled?: boolean;
  className?: string;
  /**
   * KUTUYA TIKLAYINCA DOĞRUDAN MODAL (istek #5 rev.): küçük açılır liste FORM'da hiç açılmaz; kutu salt
   * seçim göstergesi + tıkla → tam liste modalı (rol · arama · Kod · Ünvan · Rol · Vergi No · Telefon,
   * sunucudan sayfa sayfa). `nullable` ise yanında temizle (×). Filtre şeridi (satır içi) kullanımı
   * bu prop'u vermez — küçük kutu orada bayt bayt.
   */
  modalPicker?: boolean;
}

export function SupplierSelect({
  value,
  onChange,
  selectedLabel,
  placeholder = "Tedarikçi ara (cari / fason)…",
  nullable,
  noneLabel = "— (tedarikçisiz)",
  includeInactive = false,
  disabled,
  className,
  modalPicker = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!open) setSearchInput("");
  }, [open]);

  const listParams = {
    page: 1,
    pageSize: PAGE_SIZE,
    sortBy: "name",
    sortOrder: "asc" as const,
    search: search || undefined,
    filters: supplierListFilters(includeInactive),
  };

  // ⚠️ `includeInactive` SORGU ANAHTARINDA — yoksa aynı arama metniyle açılan
  // form (aktifler) ile filtre şeridi (pasifler dahil) AYNI önbellek satırını
  // paylaşır ve hangisinin önce açıldığına göre biri yanlış kapsamı gösterir.
  const customersQ = useQuery({
    queryKey: ["supplier-select", "customers", search, includeInactive],
    queryFn: () => customerService.getAll(listParams),
    staleTime: 30_000,
    enabled: open,
  });
  const subsQ = useQuery({
    queryKey: ["supplier-select", "subcontractors", search, includeInactive],
    queryFn: () => subcontractorService.getAll(listParams),
    staleTime: 30_000,
    enabled: open,
  });

  const customerOptions = useMemo(
    () => toSupplierOptions("CUSTOMER", customersQ.data?.data as Customer[] | undefined),
    [customersQ.data?.data],
  );
  const subOptions = useMemo(
    () => toSupplierOptions("SUBCONTRACTOR", subsQ.data?.data as Subcontractor[] | undefined),
    [subsQ.data?.data],
  );

  // Seçili kaydın etiketi — çağıran vermediyse id ile çözülür. Etiketsiz bir
  // kutu ("Tedarikçi ara…" yazarken state dolu) kullanıcıya seçimi kaybolmuş
  // gibi görünür ve ikinci kez seçmeye iter.
  const needsFetch = Boolean(value) && !selectedLabel;
  const selectedQ = useQuery({
    queryKey: ["supplier-select", "by-id", value?.kind, value?.id],
    queryFn: async () => {
      const v = value as SupplierParty;
      const res =
        v.kind === "CUSTOMER"
          ? await customerService.getById(v.id)
          : await subcontractorService.getById(v.id);
      return res.data as { id: string; code?: string | null; name: string };
    },
    enabled: needsFetch,
    staleTime: 5 * 60_000,
  });

  const resolvedLabel =
    selectedLabel ??
    (selectedQ.data ? supplierOptionLabel(selectedQ.data) : undefined) ??
    // Liste açıkken seçili satır zaten elimizde olabilir (etiket için tek
    // isteği bile beklemeyelim).
    [...customerOptions, ...subOptions].find((o) => sameSupplierParty(o, value))?.label;

  const triggerText =
    resolvedLabel ?? (needsFetch && selectedQ.isLoading ? "Yükleniyor…" : placeholder);

  const notice = supplierLoadNotice({
    customersError: customersQ.isError,
    subcontractorsError: subsQ.isError,
    loading: customersQ.isLoading || subsQ.isLoading,
  });

  const total = customerOptions.length + subOptions.length;
  const showEmpty = !customersQ.isLoading && !subsQ.isLoading && total === 0 && !notice;

  const pick = (key: string) => {
    if (key === NONE_KEY) {
      onChange(null);
      setOpen(false);
      return;
    }
    const parsed = parseSupplierPartyKey(key);
    if (parsed) onChange(parsed);
    setOpen(false);
  };

  const renderGroup = (kind: SupplierOption["kind"], options: SupplierOption[]) =>
    options.length === 0 ? null : (
      <CommandGroup heading={SUPPLIER_GROUP_LABEL[kind]}>
        {options.map((o) => (
          <CommandItem key={supplierPartyKey(o)} value={supplierPartyKey(o)} onSelect={pick}>
            <Check
              className={cn("mr-2 h-4 w-4", sameSupplierParty(o, value) ? "opacity-100" : "opacity-0")}
            />
            <span className="truncate">{o.label}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    );

  if (modalPicker) {
    return (
      <div className={className}>
        <div className="flex items-start gap-1">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label="Tedarikçi seç (liste)"
            aria-haspopup="dialog"
            title="Tıkla: bütün cariler ve fason firmalar listede — rol süzgeci, arama"
            className={cn("w-full min-w-0 justify-between font-normal", !resolvedLabel && "text-muted-foreground")}
            onClick={() => setModalOpen(true)}
          >
            <span className="truncate">
              {triggerText}
              {value?.kind === "SUBCONTRACTOR" && resolvedLabel && (
                <span className="ml-2 rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {SUPPLIER_KIND_TAG.SUBCONTRACTOR}
                </span>
              )}
            </span>
            <ListFilter className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
          {nullable && value && (
            <Button type="button" variant="outline" size="icon" className="shrink-0" disabled={disabled} aria-label="Tedarikçiyi temizle" title={noneLabel} onClick={() => onChange(null)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <SupplierPickerModal open={modalOpen} onOpenChange={setModalOpen} onPick={onChange} includeInactive={includeInactive} />
      </div>
    );
  }

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn("w-full justify-between font-normal", !resolvedLabel && "text-muted-foreground")}
          >
            <span className="truncate">
              {triggerText}
              {/* Rozet YALNIZ fason bacağında — bugünkü kayıtların görünümü
                  bayt bayt korunur (saf katman başlığı). */}
              {value?.kind === "SUBCONTRACTOR" && resolvedLabel && (
                <span className="ml-2 rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {SUPPLIER_KIND_TAG.SUBCONTRACTOR}
                </span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="pointer-events-auto w-[--radix-popover-trigger-width] p-0"
          align="start"
          onWheel={(e) => e.stopPropagation()}
        >
          {/* Süzme SUNUCUDA — `shouldFilter` açık kalsaydı Command, sunucudan
              gelen satırları bir de kendi (aksansız) kuralıyla eler. */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Kod, isim, vergi no…"
              value={searchInput}
              onValueChange={setSearchInput}
            />
            <CommandList>
              {showEmpty && (
                <CommandEmpty>
                  {customersQ.isFetching || subsQ.isFetching ? "Aranıyor…" : "Sonuç yok."}
                </CommandEmpty>
              )}
              {nullable && search.length === 0 && (
                <CommandGroup>
                  <CommandItem value={NONE_KEY} onSelect={pick} className="text-muted-foreground">
                    <Check className={cn("mr-2 h-4 w-4", value == null ? "opacity-100" : "opacity-0")} />
                    {noneLabel}
                  </CommandItem>
                </CommandGroup>
              )}
              {renderGroup("CUSTOMER", customerOptions)}
              {renderGroup("SUBCONTRACTOR", subOptions)}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {notice && (
        <p
          className={cn(
            "mt-1 text-[11px]",
            notice.tone === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-500",
          )}
        >
          {notice.message}
        </p>
      )}
    </div>
  );
}
