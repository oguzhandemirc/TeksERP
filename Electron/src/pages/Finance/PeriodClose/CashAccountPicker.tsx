// =============================================================================
// KASA/BANKA HESAP SEÇİCİ (dönem kapanışı)
// =============================================================================
// `CariPicker`'ın hesap ikizi — ama İKİ BİLİNÇLİ FARKLA, kopya değil:
//
//   1. SÜZME İSTEMCİDE. CariPicker sunucuda arar çünkü cari listesi sayfalıdır
//      (50 satırlık kısmi sayfayı istemcide süzmek "cari yok" yalanı üretir).
//      Kasa/banka kataloğu ise KÜÇÜK ve TEK istekle TAMAMI yüklüdür (pageSize
//      200, master-data); tam kümenin üzerinde Command'ın kendi süzgeci doğru
//      ve anlıktır. Sunucu araması burada tersine gereksiz gecikme olurdu.
//   2. İKİ KAYNAK TEK LİSTE: kasalar + banka hesapları iki uçtan gelir, tek
//      seçicide gruplanır. Seçim değeri (tür + hesap) çiftidir — tür olmadan
//      id tek başına hangi tabloya gideceğini söyleyemez (cashService notu).
//
// ⚠️ PASİF HESAP GİZLENMEZ, işaretlenir: backend `loadAccount` bilerek
// `isActive` aramaz — kapatılmış kasanın dönemi tam da mühürlenmesi gereken
// dönemdir. Aktiflere daraltan bir seçici o hesabı HİÇ bulamamak demekti.
// =============================================================================

import { useMemo, useState } from "react";
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
import { listBankAccounts, listCashBoxes, type Currency } from "../service";
import { cashAccountKey, type CashAccountKind } from "./cashService";

export interface CashAccountOption {
  kind: CashAccountKind;
  id: string;
  code: string;
  name: string;
  currency: Currency;
  isActive: boolean;
}

/**
 * Kasa + banka kataloğu — seçici VE liste tablosu (para birimi çözümü) aynı
 * hook'u kullanır; react-query anahtarı ortak olduğu için istek TEK atılır.
 */
export function useCashAccountOptions() {
  const boxes = useQuery({
    queryKey: ["finance", "cash-accounts", "boxes"],
    queryFn: listCashBoxes,
    staleTime: 30_000,
  });
  const banks = useQuery({
    queryKey: ["finance", "cash-accounts", "banks"],
    queryFn: listBankAccounts,
    staleTime: 30_000,
  });

  const options = useMemo<CashAccountOption[]>(() => {
    const box = (boxes.data?.data ?? []).map((a) => ({
      kind: "CASH_BOX" as const,
      id: a.id,
      code: a.code,
      name: a.name,
      currency: a.currency,
      isActive: a.isActive,
    }));
    const bank = (banks.data?.data ?? []).map((a) => ({
      kind: "BANK_ACCOUNT" as const,
      id: a.id,
      code: a.code,
      name: a.name,
      currency: a.currency,
      isActive: a.isActive,
    }));
    return [...box, ...bank];
  }, [boxes.data, banks.data]);

  // Kapanış satırı para birimi taşımaz — birim buradan çözülür (cashService notu).
  const currencyByKey = useMemo(() => {
    const m = new Map<string, Currency>();
    for (const o of options) m.set(cashAccountKey(o.kind, o.id), o.currency);
    return m;
  }, [options]);

  return {
    options,
    currencyByKey,
    isLoading: boxes.isLoading || banks.isLoading,
    isError: boxes.isError || banks.isError,
  };
}

export function cashAccountLabel(o: CashAccountOption): string {
  return `${o.code} — ${o.name}`;
}

interface Props {
  value: CashAccountOption | null;
  onChange: (account: CashAccountOption | null) => void;
  /** "Tüm hesaplar" seçeneği çıksın mı (filtre şeridinde evet, formda hayır). */
  nullable?: boolean;
  noneLabel?: string;
  className?: string;
}

export function CashAccountPicker({
  value,
  onChange,
  nullable,
  noneLabel = "Tüm hesaplar",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const { options, isLoading } = useCashAccountOptions();

  const boxes = options.filter((o) => o.kind === "CASH_BOX");
  const banks = options.filter((o) => o.kind === "BANK_ACCOUNT");

  const triggerText = value ? cashAccountLabel(value) : nullable ? noneLabel : "Hesap seçin…";

  const renderItem = (o: CashAccountOption) => (
    <CommandItem
      key={cashAccountKey(o.kind, o.id)}
      // Command süzgeci `value` metni üzerinde çalışır — kod + ad + tür sözü
      // birlikte aranabilir olsun (id sondadır, benzersizliği garanti eder).
      value={`${o.code} ${o.name} ${o.kind === "CASH_BOX" ? "kasa" : "banka"} ${o.id}`}
      onSelect={() => {
        onChange(o);
        setOpen(false);
      }}
    >
      <Check
        className={cn(
          "mr-2 h-4 w-4",
          value && value.kind === o.kind && value.id === o.id ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="truncate">{cashAccountLabel(o)}</span>
      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
        {o.currency}
        {/* Pasif hesap GİZLENMEZ, işaretlenir — dosya başındaki nota bak. */}
        {!o.isActive && " · pasif"}
      </span>
    </CommandItem>
  );

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
        {/* Süzme İSTEMCİDE — katalog tek istekle TAM yüklü (dosya başı, madde 1). */}
        <Command>
          <CommandInput placeholder="Hesap ara (kod / ad)…" />
          <CommandList>
            {!isLoading && options.length === 0 && <CommandEmpty>Tanımlı kasa/banka hesabı yok.</CommandEmpty>}
            {nullable && (
              <CommandGroup>
                <CommandItem
                  value="__none__ tüm hesaplar"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <Check className={cn("mr-2 h-4 w-4", value == null ? "opacity-100" : "opacity-0")} />
                  {noneLabel}
                </CommandItem>
              </CommandGroup>
            )}
            {boxes.length > 0 && <CommandGroup heading="Kasalar">{boxes.map(renderItem)}</CommandGroup>}
            {banks.length > 0 && <CommandGroup heading="Banka Hesapları">{banks.map(renderItem)}</CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
