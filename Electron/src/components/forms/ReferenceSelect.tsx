import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
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
import type { CrudService } from "@/services/crudService";
import { PASSIVE_HINT, decorateSelectedLabel, isPassiveRecord } from "./referenceSelectState";

const NULL_SENTINEL = "__none__";
const PAGE_SIZE = 50;
const DEBOUNCE_MS = 200;

interface Props<T extends { id: string }> {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  service: CrudService<T>;
  queryKey: string;
  getLabel: (item: T) => string;
  placeholder?: string;
  nullable?: boolean;
  noneLabel?: string;
  /** Backend filter'larına eklenir. Örn: { isDerived: "true" }. */
  extraFilters?: Record<string, string>;
  disabled?: boolean;
  /**
   * PASİF kayıtlar da listelensin (varsayılan: yalnız aktifler).
   *
   * ⚠️ Bu bir kolaylık değil, KURAL HİZASI: ön muhasebe uçları müşteri/fason
   * KARTININ aktifliğine bakmaz, `CariAccount.isActive`'e bakar
   * (`finance.helper.ensureCariAccountTx`). Yani pasifleştirilmiş bir kartın
   * açık bakiyesine tahsilat girmek MEŞRUDUR ve mahsup ekranı bu kararı
   * yazılı olarak zaten vermiştir (`Allocations/service.cariPickerService`:
   * "cariyi kapatmak geçmişini kilitlemek anlamına gelmez"). Süzgeç açık
   * kalınca aynı firma bir ekranda seçilebiliyor, diğerinde "yok" görünüyordu.
   *
   * Açıldığında pasif kayıt LİSTEDE de görünür → satırda ve tetikleyicide
   * "(pasif)" işareti taşır (rozet `isActive === false` ile çözülür).
   */
  includeInactive?: boolean;
}

export function ReferenceSelect<T extends { id: string }>({
  value,
  onChange,
  service,
  queryKey,
  getLabel,
  placeholder = "Seç...",
  nullable,
  noneLabel = "— (yok)",
  extraFilters,
  disabled,
  includeInactive,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [labelCache, setLabelCache] = useState<Map<string, string>>(new Map());
  // Pasif kayıtların id'leri — hem listede hem tetikleyicide işaretlenir.
  const [passiveIds, setPassiveIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!open) setSearchInput("");
  }, [open]);

  const listQuery = useQuery({
    // ⚠️ `includeInactive` anahtara GİRER: aynı servisin iki farklı kapsamı
    // (yalnız aktifler / hepsi) aynı cache satırını paylaşırsa, formu açan
    // ekrana göre liste "bazen pasifleri içerir" olur.
    queryKey: [queryKey, "ref-select", debouncedSearch, extraFilters, includeInactive ?? false],
    queryFn: () =>
      service.getAll({
        page: 1,
        pageSize: PAGE_SIZE,
        sortBy: "name",
        sortOrder: "asc",
        search: debouncedSearch || undefined,
        // Süzgeç YOK EDİLİR, "false" YAZILMAZ: istenen "hepsi", "yalnız
        // pasifler" değil (backend listesi süzgeçsiz iken ikisini de döner).
        filters: includeInactive ? { ...extraFilters } : { isActive: "true", ...extraFilters },
      }),
    staleTime: 30_000,
  });

  const items = listQuery.data?.data ?? [];
  const needsSelectedFetch = !!value && !labelCache.has(value);

  const selectedQuery = useQuery({
    queryKey: [queryKey, "ref-select-by-id", value],
    queryFn: () => service.getById(value as string),
    enabled: needsSelectedFetch,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const fromList = listQuery.data?.data ?? [];
    const fromSelected = selectedQuery.data?.data;
    if (fromList.length === 0 && !fromSelected) return;
    setLabelCache((prev) => {
      const next = new Map(prev);
      let changed = false;
      const upsert = (item: T) => {
        const label = getLabel(item);
        if (next.get(item.id) !== label) {
          next.set(item.id, label);
          changed = true;
        }
      };
      for (const item of fromList) upsert(item);
      if (fromSelected) upsert(fromSelected);
      return changed ? next : prev;
    });
    // Pasiflik AYRI tutulur: etiket bir metin, pasiflik bir DURUM — etikete
    // gömülseydi (ad + " (pasif)") aynı kayıt listede ve tetikleyicide farklı
    // yazılır, arama da uydurma eke çarpardı.
    setPassiveIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      const mark = (item: T) => {
        const passive = isPassiveRecord(item);
        if (passive && !next.has(item.id)) {
          next.add(item.id);
          changed = true;
        } else if (!passive && next.has(item.id)) {
          next.delete(item.id);
          changed = true;
        }
      };
      for (const item of fromList) mark(item);
      if (fromSelected) mark(fromSelected);
      return changed ? next : prev;
    });
  }, [listQuery.data?.data, selectedQuery.data?.data, getLabel]);

  const selectedPassive = Boolean(value) && passiveIds.has(value as string);
  const selectedLabel = decorateSelectedLabel(value ? labelCache.get(value) : undefined, selectedPassive);
  const triggerText =
    selectedLabel ??
    (needsSelectedFetch && selectedQuery.isLoading ? "Yükleniyor..." : placeholder);

  const showEmpty =
    !listQuery.isLoading && items.length === 0 && !(nullable && debouncedSearch.length === 0);

  return (
    /* ⚠️ TEK KÖK ELEMAN — Fragment DEĞİL. Pasif uyarısı bir KARDEŞ olarak
       eklendiğinde bileşen bazen 1, bazen 2 düğüm döndürüyordu; doğrudan bir
       `grid` çocuğu olduğu yerde (`GoodsReceipts/ReceiptLineRows` — hem kumaş
       hem renk seçicisi grid'in DOĞRUDAN çocuğu) ikinci düğüm fazladan bir
       HÜCRE açar ve satırdaki tüm sonraki kolonlar (metraj/en/kg/kat/sil) bir
       kolon kayar, sonuncusu alt satıra düşer — hata yok, log yok, yalnız
       bozuk satır. Tetiklenmesi teorik değil: "Kalemleri siparişten doldur"
       satırları sipariş kalemleriyle ön-doldurur ve sonradan pasife alınmış bir
       kalem `getById` ile `isActive:false` olarak çözülür.
       ⚠️ `min-w-0`: flex satırında sarmalayıcı, içeriğinden küçülemeyip komşu
       hücreye taşabilir (projede yazılı "flex picker taşması" dersi). */
    <div className="w-full min-w-0">
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selectedLabel && "text-muted-foreground",
            // Pasif seçim SESSİZ KALMAZ: aynı hata bugün ancak "Kaydet"e
            // basınca, üstelik hangi alandan geldiği yazmadan görünüyordu.
            selectedPassive && "border-amber-400 dark:border-amber-700",
          )}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="pointer-events-auto w-[--radix-popover-trigger-width] p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Ara (kod, isim, vergi no)..."
            value={searchInput}
            onValueChange={setSearchInput}
          />
          <CommandList>
            {showEmpty && (
              <CommandEmpty>
                {listQuery.isFetching ? "Aranıyor..." : "Sonuç yok."}
              </CommandEmpty>
            )}
            <CommandGroup>
              {nullable && debouncedSearch.length === 0 && (
                <CommandItem
                  value={NULL_SENTINEL}
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value == null ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {noneLabel}
                </CommandItem>
              )}
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={(currentValue) => {
                    onChange(currentValue);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === item.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{getLabel(item)}</span>
                  {/* Pasif satır listede de işaretlenir — `includeInactive`
                      açıkken pasif kayıt aktiflerin arasında yer alır ve
                      ayırt edilemezse kullanıcı bilmeden onu seçer. */}
                  {isPassiveRecord(item) && (
                    <span className="ml-2 shrink-0 text-[11px] text-amber-700 dark:text-amber-500">
                      pasif
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    {selectedPassive && (
      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-500">{PASSIVE_HINT}</p>
    )}
    </div>
  );
}
