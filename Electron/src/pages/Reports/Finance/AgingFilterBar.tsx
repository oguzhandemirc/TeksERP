// =============================================================================
// YAŞLANDIRMA FİLTRE ŞERİDİ
// =============================================================================
// ⚠️ TARİH ARALIĞI YOK, TEK "KESİT" VAR. Yaşlandırma "şu ana kadar birikmiş
// açık"ı sorar; 1–15 Ağustos arası yaşlandırma diye bir şey yoktur. Ortak
// `ReportDateRange` bileşeni bu yüzden KULLANILMAZ (backend de `dateFrom`/
// `dateTo`'yu `.strict()` ile 400'ler) — aralık seçtiren bir ekran kavramı
// yanlış öğretirdi.
//
// ⚠️ Kesit YEREL GÜN SONUNA çekilir: "31 Temmuz itibarıyla" o günün SONU
// demektir. Gün başına çekilseydi o gün kesilen faturalar rapora hiç girmezdi.
//
// ⚠️ Cari SEÇİCİ yok, cari ARAMA var. Seçici `/api/finance/cari` ucunu
// gerektirirdi ve o uç `finance:read` ister — yalnız `report:finance` taşıyan
// yönetim kullanıcısı 403 alır, filtre sessizce ölürdü. Arama, gelen satırlar
// üzerinde çalışır (rapor sayfalı değildir, yani liste tamdır).
// =============================================================================

import { CalendarClock, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CariKind, Currency } from "./service";

const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

export interface AgingFilterState {
  asOfYmd: string;
  kind: CariKind | "";
  currency: Currency | "";
  onlyOverdue: boolean;
  search: string;
}

interface Props {
  value: AgingFilterState;
  onChange: (patch: Partial<AgingFilterState>) => void;
  todayYmd: string;
}

export function AgingFilterBar({ value, onChange, todayYmd }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">
      <span className="mr-1 flex items-center gap-1 text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" />
        Kesit
      </span>
      <Input
        type="date"
        value={value.asOfYmd}
        max={todayYmd}
        onChange={(e) => onChange({ asOfYmd: e.target.value || todayYmd })}
        className="h-7 w-[130px] px-2 text-xs"
        title="Bu tarihin SONU itibarıyla açık bakiye"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => onChange({ asOfYmd: todayYmd })}
      >
        Bugün
      </Button>

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
