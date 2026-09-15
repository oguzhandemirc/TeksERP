// =============================================================================
// YAŞLANDIRMA FİLTRE ŞERİDİ
// =============================================================================
// ⚠️ TARİH ARALIĞI YOK, TEK "KESİT" VAR. Yaşlandırma "şu ana kadar birikmiş
// açık"ı sorar; 1–15 Ağustos arası yaşlandırma diye bir şey yoktur. Kesit girdisini
// katalogdaki `kesit` sözleşmesiyle ortak `ReportDateFilter` çizer (`asOf` = günün
// SONU); bu şerit yalnız EK eksenleri (tür · para birimi · vadesi geçen · arama) taşır.
//
// ⚠️ CARİ SEÇİCİ ve CARİ ARAMA İKİSİ DE VAR ve FARKLI ŞEYLER yaparlar:
// seçici RAPORU süzer (istek sunucuya gider, toplamlar ve mutabakat yeniden
// hesaplanır), arama yalnız EKRANDAKİ satırları daraltır (toplamlar değişmez,
// çıktı bunu şerhiyle söyler). Eski gerekçe ("cari ucu `finance:read` ister,
// seçici 403 alır") ARTIK GEÇERSİZ: liste raporun kendi yanıtından gelir
// (`meta.secenekler.cariId`, R5b-d) — ayrı uç, ayrı izin yok.
// =============================================================================

import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ReportMultiSelect } from "../_components";
import { AXIS_EMPTY_HINTS, AXIS_LABELS } from "../_hooks/reportAxisFilters";
import type { ReportAxisOption } from "../_services/types";
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
  /** Sunucu tarafı cari süzgeci (R5b-d) — aramanın yanında, onunla karışmasın diye ayrı etiketli. */
  cariSelect?: ReactNode;
}

export function AgingFilterBar({ value, onChange, dateFilter, cariSelect }: Props) {
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

      {cariSelect ? <div className="ml-2">{cariSelect}</div> : null}

      <div className="relative ml-2">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Ekranda ara (toplamı değiştirmez)…"
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

/** Cari çoklu seçicisi — şeridin içinde yaşar ki sayfa gövdesi şişmesin. */
export function AgingCariSelect({ options, value, onChange }: { options: ReportAxisOption[] | undefined; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <ReportMultiSelect
      id="aging-cari"
      label={AXIS_LABELS.cariId}
      options={options}
      value={value}
      onChange={onChange}
      emptyHint={AXIS_EMPTY_HINTS.cariId}
    />
  );
}
