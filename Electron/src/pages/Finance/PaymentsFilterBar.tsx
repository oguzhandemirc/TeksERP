// =============================================================================
// TAHSİLAT / ÖDEME FİLTRE ŞERİDİ (B4)
// =============================================================================
// ⚠️ Şerit `PageBody`'nin DIŞINDA ve `shrink-0` — içine konursa liste kaydıkça
// filtreler yukarı kaçar ve kullanıcı hangi daraltmaya baktığını göremez
// (`CashTxnFilterBar`/`ChequeFilterBar` emsali).
//
// ⚠️ VARSAYILAN "TÜMÜ"dür, "yalnız aktifler" DEĞİL. Burası bir DEFTERDİR: iptal
// edilmiş tahsilat silinmez, ters kayıtla kapanır ve tam da "bu para nereye
// gitti" sorusunda aranır. Varsayılan olarak gizlemek, kullanıcının aradığı
// kaydı "yok" sanmasına yol açardı; iptal satırları listede soluk + üstü çizili
// tutarla zaten ayrışıyor.
//
// ⚠️ CARİ SEÇİCİ `cariPickerService` kullanır (kopya DEĞİL): uç `cariId` ister
// ve o servis `isActive` süzgecini bilerek DÜŞÜRÜR — pasifleştirilmiş bir
// carinin geçmiş tahsilatı hâlâ aranır (cariyi kapatmak geçmişini kilitlemez).
// =============================================================================
import { RotateCcw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { cariPickerService } from "./Allocations/service";
import type { CariRow } from "./service";
import {
  EMPTY_PAYMENT_FILTERS,
  PAYMENT_METHOD_LABEL,
  isPaymentFilterDirty,
  type PaymentFilterState,
} from "./paymentFilters";

interface Props {
  value: PaymentFilterState;
  onChange: (next: PaymentFilterState) => void;
}

export function PaymentsFilterBar({ value, onChange }: Props) {
  const set = <K extends keyof PaymentFilterState>(key: K, v: PaymentFilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
      <div className="relative w-64">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Belge no / referans ara…"
          value={value.search}
          onChange={(e) => set("search", e.target.value)}
        />
      </div>

      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value.direction}
        onChange={(e) => set("direction", e.target.value)}
      >
        <option value="">Tahsilat + Ödeme</option>
        <option value="IN">Yalnız tahsilat</option>
        <option value="OUT">Yalnız ödeme</option>
      </select>

      <div className="w-64">
        <ReferenceSelect<CariRow>
          value={value.cariId}
          onChange={(v) => set("cariId", v)}
          service={cariPickerService}
          queryKey="finance-cari"
          getLabel={(c) => `${c.code} — ${c.name}`}
          placeholder="Tüm cariler"
          nullable
          noneLabel="Tüm cariler"
        />
      </div>

      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value.method}
        onChange={(e) => set("method", e.target.value)}
      >
        <option value="">Tüm yöntemler</option>
        {Object.entries(PAYMENT_METHOD_LABEL).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>

      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value.status}
        onChange={(e) => set("status", e.target.value)}
      >
        <option value="">Aktif + iptal</option>
        <option value="ACTIVE">Yalnız aktif</option>
        <option value="CANCELLED">Yalnız iptal</option>
      </select>

      <span className="text-xs text-muted-foreground">Tarih</span>
      <Input
        type="date"
        className="w-36"
        title="Ödeme tarihi başlangıcı"
        value={value.from}
        onChange={(e) => set("from", e.target.value)}
      />
      <Input
        type="date"
        className="w-36"
        title="Ödeme tarihi bitişi"
        value={value.to}
        onChange={(e) => set("to", e.target.value)}
      />

      {/* Temizle YALNIZ bir şey seçiliyken çıkar — hep duran bir düğme, hiçbir
          filtre yokken de "bir şey açık" izlenimi verir. */}
      {isPaymentFilterDirty(value) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_PAYMENT_FILTERS)}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Filtreleri temizle
        </Button>
      )}
    </div>
  );
}
