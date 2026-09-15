// =============================================================================
// YAŞLANDIRMA FİLTRE ŞERİDİ
// =============================================================================
// ⚠️ TARİH ARALIĞI YOK, TEK "KESİT" VAR. Yaşlandırma "şu ana kadar birikmiş
// açık"ı sorar; 1–15 Ağustos arası yaşlandırma diye bir şey yoktur. Kesit girdisini
// katalogdaki `kesit` sözleşmesiyle ortak `ReportDateFilter` çizer (`asOf` = günün
// SONU); bu şerit yalnız EK eksenleri (tür · para birimi · vadesi geçen · arama) taşır.
//
// ⚠️ Cari SEÇİCİ yok, cari ARAMA var. Seçici `/api/finance/cari` ucunu
// gerektirirdi ve o uç `finance:read` ister — yalnız `report:finance` taşıyan
// yönetim kullanıcısı 403 alır, filtre sessizce ölürdü. Arama, gelen satırlar
// üzerinde çalışır (rapor sayfalı değildir, yani liste tamdır).
// =============================================================================

import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CariKind, Currency } from "./service";

const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

export interface AgingFilterState {
  kind: CariKind | "";
  currency: Currency | "";
  onlyOverdue: boolean;
  search: string;
}

interface Props {
  value: AgingFilterState;
  onChange: (patch: Partial<AgingFilterState>) => void;
  /** Kesit girdisi — düzen değil şerit çizer ki tarih ile ek eksenler AYNI satırda dursun. */
  dateFilter: ReactNode;
}

export function AgingFilterBar({ value, onChange, dateFilter }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">
      {dateFilter}

      <select
        value={value.kind}
        onChange={(e) => onChange({ kind: e.target.value as CariKind | "" })}
        className="ml-2 h-7 rounded-md border bg-background px-2 text-xs"
      >
        <option value="">Tüm cariler</option>
        <option value="CUSTOMER">Müşteri</option>
        <option value="SUBCONTRACTOR">Fason</option>
      </select>

      <select
        value={value.currency}
        onChange={(e) => onChange({ currency: e.target.value as Currency | "" })}
        className="h-7 rounded-md border bg-background px-2 text-xs"
      >
        <option value="">Tüm para birimleri</option>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <Button
        type="button"
        size="sm"
        variant={value.onlyOverdue ? "default" : "outline"}
        className="h-7 px-2 text-xs"
        onClick={() => onChange({ onlyOverdue: !value.onlyOverdue })}
      >
        Yalnız vadesi geçenler
      </Button>

      <div className="relative ml-2">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Cari adı / kodu ara…"
          className="h-7 w-56 pl-7 text-xs"
        />
      </div>
      {value.search ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => onChange({ search: "" })}
          title="Aramayı temizle"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
