// =============================================================================
// KAPAMA KAPSAMI — cari · para birimi · yön
// =============================================================================
// ⚠️ ÜÇÜ DE ZORUNLU ve bu bir arayüz tercihi değil, UCUN SÖZLEŞMESİDİR: açık
// fatura ve serbest tahsilat uçları `cariId` + `currency` ister, yön ise fatura
// türünü belirler (Tahsilat ↔ SATIŞ, Ödeme ↔ ALIŞ). "Hepsi" diye bir seçenek
// bilinçli olarak YOK: iki para birimini tek listede kapatmak KUR FARKI doğurur
// ve o fark bir yere yazılmak zorundadır (bu sürümde desteklenmiyor).
//
// ⚠️ Üçünden biri değişince SEÇİM ve YAZILAN TUTARLAR sıfırlanır (`onScopeChange`).
// Sıfırlanmasaydı, başka bir cari için yazılmış tutarlar ekranda kalır ve
// gönderildiğinde uç "başka bir cariye ait" derdi — kullanıcı ise ekranda
// doğru cariyi görüyor olurdu.
import { Label } from "@/components/ui/label";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import type { CariRow, Currency } from "../service";
import { cariPickerService, type Direction } from "./service";

const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

interface Props {
  cariId: string | null;
  currency: Currency;
  direction: Direction;
  /** Seçili carinin okunur özeti — seçim doğru mu, tek bakışta görünsün. */
  cariLabel: string | null;
  onCariChange: (cariId: string | null) => void;
  onCurrencyChange: (currency: Currency) => void;
  onDirectionChange: (direction: Direction) => void;
}

export function AllocationFilters({
  cariId,
  currency,
  direction,
  cariLabel,
  onCariChange,
  onCurrencyChange,
  onDirectionChange,
}: Props) {
  return (
    <div className="flex shrink-0 flex-wrap items-end gap-3 border-b px-6 py-3">
      <div className="w-80">
        <Label className="text-xs">Cari hesap</Label>
        <div className="mt-1">
          <ReferenceSelect<CariRow>
            value={cariId}
            onChange={onCariChange}
            service={cariPickerService}
            queryKey="finance-cari"
            getLabel={(c) => `${c.code} — ${c.name}`}
            placeholder="Müşteri / fason ara..."
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Para birimi</Label>
        <select
          className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value as Currency)}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label className="text-xs">Yön</Label>
        <select
          className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={direction}
          onChange={(e) => onDirectionChange(e.target.value as Direction)}
        >
          <option value="IN">Tahsilat → Satış faturası</option>
          <option value="OUT">Ödeme → Alış faturası</option>
        </select>
      </div>

      {cariLabel && <p className="ml-auto text-xs text-muted-foreground">{cariLabel}</p>}
    </div>
  );
}
