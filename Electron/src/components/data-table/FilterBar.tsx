import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertOctagon, Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { CrudService } from "@/services/crudService";
import { foldSearchText } from "@/lib/search-fold";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { useTruncationWarning } from "@/hooks/useTruncationWarning";

/**
 * Lookup açılır listesinde gösterilecek en fazla satır. Arama SUNUCUDA
 * yapıldığı için bu bir "tüm kayıtlar" tavanı DEĞİL, "bu terime en iyi N
 * eşleşme" sınırıdır — kullanıcı daraltmak için yazar.
 */
const LOOKUP_PAGE_SIZE = 200;

// Local-time day boundaries — kullanıcı "07.05.2026" derken İstanbul tz'inde
// o günün 00:00:00 ile 23:59:59'u kastediyor; UTC midnight değil.
function startOfDayIso(ymd: string): string {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
function endOfDayIso(ymd: string): string {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}
function toLocalYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * URL-driven filter bar. Her filtre değişimi `useSearchParams`'a yazar →
 * `useDataTable` URL'i izleyip cursor'ı sıfırlar + refetch eder.
 *
 * Filtre türleri:
 *  - `select`: sabit seçenek listesi (status, type vb.)
 *  - `multi-select`: çoklu sabit seçenek (popover + checkbox) — virgülle ayrılmış
 *  - `lookup`: master data dropdown (customer, item — `CrudService.getAll`)
 *  - `multi-lookup`: çoklu master data (popover + checkbox) — virgülle ayrılmış
 *  - `dependent-lookup`: üst filtreye bağlı çoklu lookup (örn. müşteri → şube);
 *    üst değer seçilince `fetchOptions(parentId)` ile seçenekler gelir, üst
 *    değişince çocuk seçim temizlenir
 *  - `numberRange`: iki sayısal input (min-max). URL'e `<key>Min`, `<key>Max`
 *  - `dateRange`: preset (Son 7g/30g/90g/Tümü) — `dateField` zorunlu
 *
 * ⚠️ ÇOKLU SEÇİM = `filter[key]=a,b` (CSV). Bir filtreyi `multi-*`'a çevirmeden
 * önce o alanı okuyan BACKEND yolunun CSV'yi `in`'e çevirdiğinden emin ol.
 * Jenerik yol (`buildWhereClause`) çevirir; filtreyi ELLE okuyan servisler
 * (inventory `buildRollWhere`, order `extraWhere`, kartela, production-balance)
 * `utils/query-parser.readIdCondition`'dan geçmek ZORUNDA — geçmiyorsa uuid
 * kolonlarında HTTP 500, ön-süzgeçli alanlarda ise filtre SESSİZCE düşer ve
 * liste filtresizmiş gibi döner. Bekçi: `Teks-Erp/scripts/test_filter_multi_select.ts`.
 *
 * `dependent-lookup` üst filtresi ÇOKLU olabilir: ham CSV `fetchOptions`'a
 * aynen geçer ve `/api/customer-branches` gibi BaseService uçları onu `in`'e
 * çevirir. Üst küme değişince çocuk seçim temizlenir (bayat şube kalmasın).
 *
 * `defaultDateRangeDays` set edilirse URL'de tarih yokken otomatik uygular —
 * operasyon sayfaları için "son N gün" performans varsayılanı.
 */

interface LookupItemBase {
  id: string;
  name?: string;
  code?: string;
}
type LookupGetLabel = (it: LookupItemBase) => string;

export type FilterDef =
  | {
      kind: "select";
      key: string;
      label: string;
      options: { value: string; label: string }[];
    }
  | {
      kind: "multi-select";
      key: string;
      label: string;
      options: { value: string; label: string }[];
    }
  | {
      kind: "lookup";
      key: string;
      label: string;
      // Yalnız getAll çağrılır — hafif lookup servisleri (örn. /rolls/entry-users)
      // tam CrudService kurmak zorunda kalmasın diye tip bilinçli DAR.
      service: Pick<CrudService<LookupItemBase>, "getAll">;
      queryKey: string;
      getLabel?: LookupGetLabel;
      /** Lookup listesini daraltmak için ek backend filter (örn. isDerived=false). */
      extraFilters?: Record<string, string>;
    }
  | {
      kind: "multi-lookup";
      key: string;
      label: string;
      service: Pick<CrudService<LookupItemBase>, "getAll">;
      queryKey: string;
      getLabel?: LookupGetLabel;
      extraFilters?: Record<string, string>;
      /**
       * Katalogda KARŞILIĞI OLMAYAN sabit seçenek (örn. "Müşterisiz (genel
       * stok)" = `customerId IS NULL`). Listenin BAŞINA sabitlenir ve seçilince
       * CSV'ye o değer yazılır; backend değeri UUID listesinden ayrıştırmak
       * ZORUNDADIR (aksi P2007).
       *
       * ⚠️ Etiket çözümü de buradan gelir: sentinel `items` içinde bulunmadığı
       * için tetik yazısı ham değeri ("none") basardı.
       */
      sentinelOption?: { value: string; label: string };
    }
  | {
      kind: "dependent-lookup";
      key: string;
      label: string;
      /** Bağlı olduğu üst filtre anahtarı (örn. "customerId"). */
      dependsOn: string;
      queryKey: string;
      /** Üst filtre değeri verilince seçenekleri getirir (parentId boşken çağrılmaz). */
      fetchOptions: (parentId: string) => Promise<LookupItemBase[]>;
      getLabel?: LookupGetLabel;
      /** Üst filtre seçilmeden gösterilen pasif metin (örn. "Şube (önce müşteri)"). */
      placeholderNoParent?: string;
    }
  | {
      kind: "numberRange";
      key: string;
      label: string;
      unit?: string;
      step?: number;
    }
  | {
      kind: "dateRange";
      label: string;
      defaultField: string;
      fieldOptions?: { value: string; label: string }[];
    };

interface Props {
  filters: FilterDef[];
  /** İlk açılışta URL'de tarih yoksa bu kadar günü default uygular. 0 = devre dışı. */
  defaultDateRangeDays?: number;
  /** Filtre satırının EN BAŞINA (filtrelerden önce) eklenen öğe — örn. görünüm
   *  seçici dropdown. Aynı satırda, aynı hizada render edilir. */
  leading?: ReactNode;
  /** Satır-içi mod: kendi border/padding sarmalayıcısını çizmez — başka bir araç
   *  çubuğunun (ör. DataTableToolbar `leading`) içine gömülmek için. */
  inline?: boolean;
  /** Kontrol yüksekliği: "sm" (varsayılan, h-7 kompakt) | "md" (h-9, arama input'uyla eşit). */
  size?: "sm" | "md";
}

const DATE_PRESETS = [
  { days: 7, label: "Son 7g" },
  { days: 30, label: "Son 30g" },
  { days: 90, label: "Son 90g" },
] as const;

const NONE = "__all__";

/** Sayısal aralık gibi YAZILAN filtrelerde URL'e (→ backend fetch) yazmadan önce
 *  beklenen süre. "1"→"15"→"150" her tuşta 3 istek yerine, yazma durunca TEK
 *  istek gitsin diye. Tıkla-seç filtreleri (select/lookup) etkilenmez. */
const FILTER_DEBOUNCE_MS = 500;

export function FilterBar({ filters, defaultDateRangeDays = 0, leading, inline = false, size = "sm" }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const dateDef = filters.find((f) => f.kind === "dateRange");
  // Kontrol yüksekliği — "md" arama input'uyla (h-9) hizalar; varsayılan kompakt (h-7).
  const ctrlH = size === "md" ? "h-9" : "h-7";

  // Default tarih aralığını (ilk render) uygula — URL'de yoksa.
  // URL'de explicit `filter[...]` varsa (örn. dashboard'tan gelen "Açık İş Emri"
  // status filtresi) default tarihi uygulama — sayım sayfasında tutarsız olmasın.
  useEffect(() => {
    if (!dateDef || !defaultDateRangeDays) return;
    if (searchParams.get("dateFrom") || searchParams.get("dateTo")) return;
    for (const key of searchParams.keys()) {
      if (key.startsWith("filter[")) return;
    }
    const next = new URLSearchParams(searchParams);
    const today = new Date();
    const from = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - defaultDateRangeDays,
      0, 0, 0, 0,
    );
    const to = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      23, 59, 59, 999,
    );
    next.set("dateField", searchParams.get("dateField") ?? dateDef.defaultField);
    next.set("dateFrom", from.toISOString());
    next.set("dateTo", to.toISOString());
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (mutator: (sp: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    mutator(next);
    setSearchParams(next, { replace: true });
  };

  return (
    <div
      className={
        inline
          ? "flex flex-wrap items-center gap-2 text-xs"
          : "flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs"
      }
    >
      {leading}
      {filters.map((f) => {
        if (f.kind === "select") return <SelectFilter key={f.key} def={f} sp={searchParams} update={update} h={ctrlH} />;
        if (f.kind === "multi-select") return <MultiSelectFilter key={f.key} def={f} sp={searchParams} update={update} h={ctrlH} />;
        if (f.kind === "lookup") return <LookupFilter key={f.key} def={f} sp={searchParams} update={update} h={ctrlH} />;
        if (f.kind === "multi-lookup") return <MultiLookupFilter key={f.key} def={f} sp={searchParams} update={update} h={ctrlH} />;
        if (f.kind === "dependent-lookup") return <DependentLookupFilter key={f.key} def={f} sp={searchParams} update={update} h={ctrlH} />;
        if (f.kind === "numberRange") return <NumberRangeFilter key={f.key} def={f} sp={searchParams} update={update} h={ctrlH} />;
        return <DateRangeFilter key="date" def={f} sp={searchParams} update={update} h={ctrlH} />;
      })}
    </div>
  );
}

/** Tarih aralığı filtresini FilterBar DIŞINDA (örn. tablo araç çubuğunda) tek başına
 *  render eder — kendi useSearchParams'ını yönetir (FilterBar ile aynı URL state). */
export function StandaloneDateRangeFilter({
  def,
}: {
  def: Extract<FilterDef, { kind: "dateRange" }>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const update = (mutator: (sp: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    mutator(next);
    setSearchParams(next, { replace: true });
  };
  return <DateRangeFilter def={def} sp={searchParams} update={update} h="h-7" />;
}

interface SubProps<D> {
  def: D;
  sp: URLSearchParams;
  update: (m: (sp: URLSearchParams) => void) => void;
  /** Kontrol yükseklik sınıfı (FilterBar `size`'dan) — h-7 (kompakt) | h-9 (arama ile eşit). */
  h: string;
}

function SelectFilter({ def, sp, update, h }: SubProps<Extract<FilterDef, { kind: "select" }>>) {
  const value = sp.get(`filter[${def.key}]`) ?? NONE;
  return (
    <Select
      value={value}
      onValueChange={(v) =>
        update((next) => {
          if (v === NONE) next.delete(`filter[${def.key}]`);
          else next.set(`filter[${def.key}]`, v);
        })
      }
    >
      <SelectTrigger className={cn(h, "w-auto min-w-[140px] gap-1 text-xs")}>
        <SelectValue placeholder={def.label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE} className="text-muted-foreground">
          Tümü ({def.label})
        </SelectItem>
        {def.options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiSelectFilter({
  def,
  sp,
  update,
  h,
}: SubProps<Extract<FilterDef, { kind: "multi-select" }>>) {
  const [open, setOpen] = useState(false);
  const csv = sp.get(`filter[${def.key}]`) ?? "";
  const selected = useMemo(
    () => (csv ? csv.split(",").filter(Boolean) : []),
    [csv],
  );

  const toggle = (value: string) =>
    update((next) => {
      const set = new Set(selected);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      if (set.size === 0) next.delete(`filter[${def.key}]`);
      else next.set(`filter[${def.key}]`, Array.from(set).join(","));
    });

  const clearAll = () => update((next) => next.delete(`filter[${def.key}]`));

  const triggerLabel =
    selected.length === 0
      ? def.label
      : selected.length === 1
        ? def.options.find((o) => o.value === selected[0])?.label ?? def.label
        : `${def.label} (${selected.length})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            h,
            "min-w-[140px] justify-between gap-1 px-2 text-xs font-normal",
            selected.length > 0 && "border-primary/50",
          )}
        >
          <span className={cn(selected.length === 0 && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>Seçenek yok.</CommandEmpty>
            <CommandGroup>
              {def.options.map((o) => {
                const isSel = selected.includes(o.value);
                return (
                  <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        isSel ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {o.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {selected.length > 0 ? (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-center text-xs"
                onClick={clearAll}
              >
                Temizle
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// =============================================================================
// LOOKUP FİLTRELERİ — ARAMA SUNUCUDA (2026-08-19)
// =============================================================================
// ⚠️ İKİ HATA BİRDEN VARDI ve ikisi de SESSİZDİ:
//
// 1) TAVAN: `pageSize: 200` ile tek atış + istemci süzmesi. Bu bileşen JENERİKTİR
//    — her veri tablosunun lookup filtresi (müşteri, kumaş, renk, fason firma…)
//    buradan geçer. Ölçüldü (2026-08-19): kumaş **194/200**, yani altı kayıt
//    sonra filtre sessizce eksik liste göstermeye başlayacaktı.
//
// 2) TÜRKÇE: `CommandInput` cmdk'nın VARSAYILAN süzgecini kullanıyordu ve o yalnız
//    ASCII katlar — "kursun" yazan "Kurşun"u BULAMIYORDU. Komut paletinde
//    düzeltilen hatanın (2026-08-19) ikizi, burada da vardı.
//
// ÇÖZÜM ikisini birden kapatıyor: arama SUNUCUYA gider (`search` parametresi →
// katlanmış gölge kolon + trigram index) ve `shouldFilter={false}` ile cmdk'nın
// ikinci kez süzmesi KAPATILIR. Çift süzme burada da bir tuzaktı: sunucu doğru
// satırı döndürse bile cmdk onu ASCII karşılaştırmasıyla elerdi.
//
// ⚠️ `shouldFilter={false}` ZORUNLU. Kaldırılırsa arama "çalışıyor" görünür ama
// Türkçe terimlerde sonuç sessizce kaybolur.
//
// ── SEÇENEK LİSTESİ DÜŞTÜĞÜNDE "Sonuç yok." YAZILMAZ ────────────────────────
// ⚠️ 2026-08-12 SAHA VAKASININ SINIFI. O gün lookup servisinin YOLU yanlıştı,
// istek 404 aldı ve `FilterBar` bunu "Sonuç yok." diye bastı — kullanıcı filtreyi
// boş sanıp süzmeden çalıştı. O gün semptom (URL) düzeltildi, SEBEP (hata = boş)
// düzeltilmedi. `LookupErrorRow` sebebi kapatır: hata varken CommandEmpty
// ÇİZİLMEZ, yerine sebebi söyleyen ve yeniden denemeyi teklif eden blok gelir.
// =============================================================================
function LookupErrorRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-start gap-2 px-3 py-3 text-xs">
      <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-destructive">Seçenekler yüklenemedi</p>
        <p className="mt-0.5 text-muted-foreground">
          Bu <strong>“seçenek yok”</strong> anlamına GELMEZ — liste sunucudan alınamadı, filtre
          eksik süzer.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-6 px-2 text-xs"
          onClick={onRetry}
        >
          Tekrar dene
        </Button>
      </div>
    </div>
  );
}

function LookupFilter({ def, sp, update, h }: SubProps<Extract<FilterDef, { kind: "lookup" }>>) {
  const [open, setOpen] = useState(false);
  const value = sp.get(`filter[${def.key}]`) ?? "";
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { data, isError, refetch } = useQuery({
    queryKey: [def.queryKey, "filter-lookup", def.extraFilters, debouncedSearch],
    queryFn: () =>
      def.service.getAll({
        page: 1,
        pageSize: LOOKUP_PAGE_SIZE,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true", ...def.extraFilters },
        ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      }),
    // Katalog YALNIZ liste açıkken ya da seçili değerin ETİKETİ gerektiğinde çekilir:
    // kapısız hâlde Envanter açılışı 7 lookup isteği atıyordu (ölçüm 2026-09-05), hiçbiri
    // dropdown açılmadan gerekmiyor. `value` koşulu tetik yazısını korur (id görünmez).
    enabled: open || value !== "",
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const items = data?.data ?? [];
  // Arama daraltmadığı hâlde tavan doluysa operatör eksik liste görüyor demektir.
  useTruncationWarning(data?.pagination, def.label);
  const labelOf = (it: LookupItemBase) =>
    def.getLabel ? def.getLabel(it) : it.name ?? it.code ?? it.id;

  const select = (id: string) =>
    update((next) => {
      if (!id) next.delete(`filter[${def.key}]`);
      else next.set(`filter[${def.key}]`, id);
    });

  const selectedItem = items.find((it) => it.id === value);
  const triggerLabel = selectedItem ? labelOf(selectedItem) : def.label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            h,
            "min-w-[160px] justify-between gap-1 px-2 text-xs font-normal",
            value && "border-primary/50",
          )}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {/* shouldFilter={false}: arama SUNUCUDA yapılıyor — cmdk ikinci kez
            süzerse (ASCII karşılaştırmasıyla) Türkçe sonuçlar sessizce kaybolur. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`${def.label} ara...`}
            className="h-8"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {/* "Sonuç yok." YALNIZ başarılı+boş yanıtta. */}
            {isError ? <LookupErrorRow onRetry={() => void refetch()} /> : <CommandEmpty>Sonuç yok.</CommandEmpty>}
            <CommandGroup>
              {/* "Tümü" hata durumunda da durur: filtreyi TEMİZLEMEK, seçenek
                  listesi okunamasa bile yapılabilmeli. */}
              <CommandItem
                value="__all__"
                onSelect={() => {
                  select("");
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-3.5 w-3.5", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">Tümü ({def.label})</span>
              </CommandItem>
              {items.map((it) => (
                <CommandItem
                  key={it.id}
                  value={labelOf(it)}
                  onSelect={() => {
                    select(it.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      value === it.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {labelOf(it)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DateRangeFilter({ def, sp, update, h }: SubProps<Extract<FilterDef, { kind: "dateRange" }>>) {
  const dateField = sp.get("dateField") ?? def.defaultField;
  const dateFromIso = sp.get("dateFrom") ?? "";
  const dateToIso = sp.get("dateTo") ?? "";
  const hasRange = Boolean(dateFromIso || dateToIso);

  const fromInput = dateFromIso ? toLocalYmd(dateFromIso) : "";
  const toInput = dateToIso ? toLocalYmd(dateToIso) : "";

  const setFrom = (ymd: string) =>
    update((next) => {
      if (!ymd) {
        next.delete("dateFrom");
        return;
      }
      next.set("dateField", dateField);
      next.set("dateFrom", startOfDayIso(ymd));
    });

  const setTo = (ymd: string) =>
    update((next) => {
      if (!ymd) {
        next.delete("dateTo");
        return;
      }
      next.set("dateField", dateField);
      next.set("dateTo", endOfDayIso(ymd));
    });

  const applyPreset = (days: number) =>
    update((next) => {
      const today = new Date();
      const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days, 0, 0, 0, 0);
      const to = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      next.set("dateField", dateField);
      next.set("dateFrom", from.toISOString());
      next.set("dateTo", to.toISOString());
    });

  const clear = () =>
    update((next) => {
      next.delete("dateFrom");
      next.delete("dateTo");
    });

  const fieldOptions = useMemo(
    () => def.fieldOptions ?? [{ value: def.defaultField, label: def.label }],
    [def.fieldOptions, def.defaultField, def.label],
  );

  return (
    <div className="flex flex-wrap items-center gap-1">
      {fieldOptions.length > 1 ? (
        <Select
          value={dateField}
          onValueChange={(v) => update((next) => next.set("dateField", v))}
        >
          <SelectTrigger className={cn(h, "w-auto gap-1 text-xs")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fieldOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {/* Takvim girdisi tek tip (kullanıcı 2026-09-17): yerleşik type="date" yerine DateRangeInput. */}
      <DateRangeInput from={fromInput} to={toInput} onFrom={setFrom} onTo={setTo} inputClassName={cn(h, "w-[140px] text-xs")} idPrefix={`${def.defaultField}-tarih`} />

      {DATE_PRESETS.map((p) => (
        <Button
          key={p.days}
          type="button"
          size="sm"
          variant="outline"
          className={cn(h, "px-2 text-xs")}
          onClick={() => applyPreset(p.days)}
        >
          {p.label}
        </Button>
      ))}

      {hasRange ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(h, "w-7")}
          onClick={clear}
          title="Tarih filtresini kaldır"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function MultiLookupFilter({
  def,
  sp,
  update,
  h,
}: SubProps<Extract<FilterDef, { kind: "multi-lookup" }>>) {
  const [open, setOpen] = useState(false);
  const csv = sp.get(`filter[${def.key}]`) ?? "";
  const selectedIds = useMemo(
    () => (csv ? csv.split(",").filter(Boolean) : []),
    [csv],
  );

  // Çoklu seçim de aynı sözleşme — bkz. `LookupFilter` başlığındaki gerekçe.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { data, isError, refetch } = useQuery({
    queryKey: [def.queryKey, "filter-lookup-multi", def.extraFilters, debouncedSearch],
    queryFn: () =>
      def.service.getAll({
        page: 1,
        pageSize: LOOKUP_PAGE_SIZE,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true", ...def.extraFilters },
        ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      }),
    // Aynı kapı — bkz. `LookupFilter`. Seçim VARSA açılmadan da çekilir, yoksa tetik
    // yazısı ham id'ye düşerdi (sentinel dahil etiket çözümü `items` listesine bağlı).
    enabled: open || selectedIds.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const items = data?.data ?? [];
  useTruncationWarning(data?.pagination, def.label);
  const labelOf = (it: LookupItemBase) =>
    def.getLabel ? def.getLabel(it) : it.name ?? it.code ?? it.id;

  const toggle = (id: string) =>
    update((next) => {
      const set = new Set(selectedIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      if (set.size === 0) next.delete(`filter[${def.key}]`);
      else next.set(`filter[${def.key}]`, Array.from(set).join(","));
    });

  const clearAll = () =>
    update((next) => next.delete(`filter[${def.key}]`));

  // ⚠️ Arama YAZILINCA sentinel GİZLENİR — iki gerekçe: (a) sentinelin katalogda
  // adı yok, "müşterisiz" satırını "ali" aramasında göstermek gürültüdür (backend
  // `listSackCustomers` de aynısını yapar); (b) cmdk `shouldFilter={false}` ile
  // çalıştığı için sabit satır listede kaldığı sürece "Sonuç yok." hiç çizilmez
  // ve boş arama sessizce dolu görünür.
  const sentinel = search.trim() ? undefined : def.sentinelOption;
  const sentinelSelected = !!sentinel && selectedIds.includes(sentinel.value);
  const labelOfSelected = (id: string) =>
    sentinel && id === sentinel.value ? sentinel.label : labelOf(items.find((it) => it.id === id) ?? { id });
  const triggerLabel =
    selectedIds.length === 0
      ? def.label
      : selectedIds.length === 1
        ? labelOfSelected(selectedIds[0]!)
        : `${def.label} (${selectedIds.length})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            h,
            "min-w-[140px] justify-between gap-1 px-2 text-xs font-normal",
            selectedIds.length > 0 && "border-primary/50",
          )}
        >
          <span className={cn(selectedIds.length === 0 && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {/* shouldFilter={false}: arama SUNUCUDA yapılıyor — cmdk ikinci kez
            süzerse (ASCII karşılaştırmasıyla) Türkçe sonuçlar sessizce kaybolur. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`${def.label} ara...`}
            className="h-8"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isError ? <LookupErrorRow onRetry={() => void refetch()} /> : <CommandEmpty>Sonuç yok.</CommandEmpty>}
            <CommandGroup>
              {sentinel ? (
                <CommandItem key={sentinel.value} value={sentinel.label} onSelect={() => toggle(sentinel.value)}>
                  <Check className={cn("mr-2 h-3.5 w-3.5", sentinelSelected ? "opacity-100" : "opacity-0")} />
                  {sentinel.label}
                </CommandItem>
              ) : null}
              {items.map((it) => {
                const selected = selectedIds.includes(it.id);
                return (
                  <CommandItem
                    key={it.id}
                    value={labelOf(it)}
                    onSelect={() => toggle(it.id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {labelOf(it)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {selectedIds.length > 0 ? (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-center text-xs"
                onClick={clearAll}
              >
                Temizle
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DependentLookupFilter({
  def,
  sp,
  update,
  h,
}: SubProps<Extract<FilterDef, { kind: "dependent-lookup" }>>) {
  const [open, setOpen] = useState(false);
  const parentId = sp.get(`filter[${def.dependsOn}]`) ?? "";
  const csv = sp.get(`filter[${def.key}]`) ?? "";
  const selectedIds = useMemo(
    () => (csv ? csv.split(",").filter(Boolean) : []),
    [csv],
  );

  // Üst filtre (örn. müşteri) değişince child seçimini temizle — eski müşterinin
  // şubesi yeni müşteride yok; bayat filtre boş sonuç döndürürdü.
  const prevParent = useRef(parentId);
  useEffect(() => {
    if (prevParent.current === parentId) return;
    prevParent.current = parentId;
    if (sp.get(`filter[${def.key}]`)) {
      update((next) => next.delete(`filter[${def.key}]`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId]);

  const { data, isError, refetch } = useQuery({
    queryKey: [def.queryKey, "filter-dependent", parentId],
    queryFn: () => def.fetchOptions(parentId),
    enabled: Boolean(parentId),
    staleTime: 60_000,
  });
  const items = data ?? [];
  const labelOf = (it: LookupItemBase) =>
    def.getLabel ? def.getLabel(it) : it.name ?? it.code ?? it.id;

  const toggle = (id: string) =>
    update((next) => {
      const set = new Set(selectedIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      if (set.size === 0) next.delete(`filter[${def.key}]`);
      else next.set(`filter[${def.key}]`, Array.from(set).join(","));
    });

  const clearAll = () => update((next) => next.delete(`filter[${def.key}]`));

  // Üst filtre seçilmeden child pasif.
  if (!parentId) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        className={cn(h, "min-w-[140px] justify-between gap-1 px-2 text-xs font-normal text-muted-foreground")}
      >
        {def.placeholderNoParent ?? def.label}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </Button>
    );
  }

  const triggerLabel =
    selectedIds.length === 0
      ? def.label
      : selectedIds.length === 1
        ? labelOf(items.find((it) => it.id === selectedIds[0]) ?? { id: selectedIds[0]! })
        : `${def.label} (${selectedIds.length})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            h,
            "min-w-[140px] justify-between gap-1 px-2 text-xs font-normal",
            selectedIds.length > 0 && "border-primary/50",
          )}
        >
          <span className={cn(selectedIds.length === 0 && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {/* Küme çağıranın verdiği dar listedir (ör. seçili müşterinin şubeleri) —
            sunucu araması gereksiz. Ama cmdk'nın VARSAYILAN süzgeci yalnız ASCII
            katlar; "kursun" ile "Kurşun" eşleşmez. Katlama sunucudakiyle aynı. */}
        <Command
          filter={(value, search) => {
            const q = foldSearchText(search);
            if (!q) return 1;
            return q.split(" ").every((t) => foldSearchText(value).includes(t)) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={`${def.label} ara...`} className="h-8" />
          <CommandList>
            {isError ? <LookupErrorRow onRetry={() => void refetch()} /> : <CommandEmpty>Sonuç yok.</CommandEmpty>}
            <CommandGroup>
              {items.map((it) => {
                const selected = selectedIds.includes(it.id);
                return (
                  <CommandItem
                    key={it.id}
                    value={labelOf(it)}
                    onSelect={() => toggle(it.id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {labelOf(it)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {selectedIds.length > 0 ? (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-center text-xs"
                onClick={clearAll}
              >
                Temizle
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function NumberRangeFilter({
  def,
  sp,
  update,
  h,
}: SubProps<Extract<FilterDef, { kind: "numberRange" }>>) {
  const minKey = `filter[${def.key}Min]`;
  const maxKey = `filter[${def.key}Max]`;
  const urlMin = sp.get(minKey) ?? "";
  const urlMax = sp.get(maxKey) ?? "";

  // Yerel input state — her tuşta ANINDA güncellenir (input akıcı kalır); URL'e
  // (→ backend fetch) yazma DEBOUNCE edilir ki "1"→"15"→"150" yazarken 3 istek
  // yerine yazma durunca TEK istek gitsin. URL dışarıdan değişirse (Temizle/geri)
  // yerel state ona senkronlanır.
  const [local, setLocal] = useState({ min: urlMin, max: urlMax });
  const hasValue = Boolean(local.min || local.max);

  // Dışarıdan gelen URL değişimini yerelle senkronla (Temizle butonu, navigasyon,
  // başka yerden filtre sıfırlama). Yalnız URL değeri değişince çalışır.
  useEffect(() => {
    setLocal({ min: urlMin, max: urlMax });
  }, [urlMin, urlMax]);

  // Yerel değişimi DEBOUNCE ederek URL'e işle — yalnız URL'den farklıysa (mount'ta
  // ve senkron sonrası eşitken erken çıkar → tek istek, gereksiz fetch yok).
  useEffect(() => {
    if (local.min === urlMin && local.max === urlMax) return;
    const t = setTimeout(() => {
      update((next) => {
        if (!local.min) next.delete(minKey);
        else next.set(minKey, local.min);
        if (!local.max) next.delete(maxKey);
        else next.set(maxKey, local.max);
      });
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  const clear = () => {
    setLocal({ min: "", max: "" });
    update((next) => {
      next.delete(minKey);
      next.delete(maxKey);
    });
  };

  const placeholder = def.unit ? `${def.label} (${def.unit})` : def.label;

  return (
    <div
      className={cn(
        h,
        "flex items-center gap-1 rounded-md border bg-background px-1.5",
        hasValue ? "border-primary/50" : "border-input",
      )}
      title={placeholder}
    >
      <span className="text-[10px] text-muted-foreground">{def.label}</span>
      <Input
        type="number"
        inputMode="decimal"
        step={def.step ?? "any"}
        value={local.min}
        onChange={(e) => setLocal((s) => ({ ...s, min: e.target.value }))}
        className="h-6 w-[68px] border-0 px-1 text-xs shadow-none focus-visible:ring-0"
        placeholder="min"
      />
      <span className="text-muted-foreground">–</span>
      <Input
        type="number"
        inputMode="decimal"
        step={def.step ?? "any"}
        value={local.max}
        onChange={(e) => setLocal((s) => ({ ...s, max: e.target.value }))}
        className="h-6 w-[68px] border-0 px-1 text-xs shadow-none focus-visible:ring-0"
        placeholder="max"
      />
      {hasValue ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          onClick={clear}
          title="Temizle"
        >
          <X className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  );
}
