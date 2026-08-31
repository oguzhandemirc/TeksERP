// =============================================================================
// CARİ SEÇİCİ (dönem kapanışı)
// =============================================================================
// ⚠️ NEDEN ORTAK `ReferenceSelect` KULLANILMIYOR: o bileşen `CrudService<T>`
// bekler ve listeyi DAİMA `filter[isActive]=true` ile çeker. Cari listesi ucu o
// biçimi hiç okumaz (düz `isActive` query'si bekler) — yani süzgeç sessizce
// yok sayılır ve "çalışıyor gibi görünen" bir kod bırakırdı. Üstelik burada
// istenen tam tersidir:
//
//   PASİF CARİ DE SEÇİLEBİLMELİDİR. Backend `assertCariExists` bilerek
//   `isActive` ARAMAZ — hesabı kapatılmış carinin dönemi tam da mühürlenmesi
//   gereken caridir (bakiyesi sıfırlanmış, dosyası kapanmıştır). Aktif olanlara
//   daraltan bir seçici, kullanıcının o cariyi HİÇ bulamamasına yol açardı.
//
// ⚠️ Cari, müşteri/fason kaydının KENDİSİ DEĞİLDİR: `cariId` ayrı bir hesap
// kimliğidir. `customerService`/`subcontractorService` ile seçim yapmak yanlış
// id gönderir ve backend "Cari hesap bulunamadı" der.
// =============================================================================

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { listCari, type CariRow } from "../service";

interface Props {
  value: string | null;
  onChange: (cari: CariRow | null) => void;
  /** Seçili carinin görünen adı — sayfa bunu kendi state'inde tutar. */
  selectedLabel?: string | null;
  /** "Tümü" seçeneği çıksın mı (filtre şeridinde evet, formda hayır). */
  nullable?: boolean;
  noneLabel?: string;
  placeholder?: string;
  className?: string;
}

export function CariPicker({
  value,
  onChange,
  selectedLabel,
  nullable,
  noneLabel = "Tüm cariler",
  placeholder = "Cari ara (kod / ünvan)…",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const q = useQuery({
    queryKey: ["finance", "cari", "picker", debounced],
    queryFn: () => listCari({ page: 1, pageSize: 50, search: debounced || undefined }),
    staleTime: 30_000,
  });

  const items = q.data?.data ?? [];
  const triggerText = value ? (selectedLabel ?? "Seçili cari") : nullable ? noneLabel : "Cari seçin…";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="pointer-events-auto w-[--radix-popover-trigger-width] min-w-72 p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        {/* shouldFilter={false}: süzme SUNUCUDA yapılır. İstemcide süzmek yalnız
            o an gelen 50 satırı süzer ve kullanıcı "cari yok" sanır. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
          <CommandList>
            {!q.isLoading && items.length === 0 && (
              <CommandEmpty>{q.isFetching ? "Aranıyor…" : "Cari bulunamadı."}</CommandEmpty>
            )}
            <CommandGroup>
              {nullable && (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <Check className={cn("mr-2 h-4 w-4", value == null ? "opacity-100" : "opacity-0")} />
                  {noneLabel}
                </CommandItem>
              )}
              {items.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">
                    {c.code} — {c.name}
                  </span>
                  {/* Pasif cari GİZLENMEZ, işaretlenir: seçilebilir olması
                      gerekiyor ama kullanıcı ne seçtiğini bilmeli. */}
                  {!c.isActive && <span className="ml-2 shrink-0 text-xs text-muted-foreground">(pasif)</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
