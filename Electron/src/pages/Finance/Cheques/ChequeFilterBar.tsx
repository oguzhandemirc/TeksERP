// =============================================================================
// PORTFÖY FİLTRE ŞERİDİ
// =============================================================================
// ⚠️ Şerit `PageBody`'nin DIŞINDA ve `shrink-0` — içine konursa liste kaydıkça
// filtreler yukarı kaçar ve kullanıcı hangi daraltmaya baktığını göremez.
//
// ⚠️ "Filtreleri temizle" YALNIZ bir şey değiştiğinde çıkar. Her zaman duran
// bir temizle düğmesi, hiçbir filtre yokken de "bir şey açık" izlenimi verir.
//
// ⚠️ Durum filtresi CSV taşır (backend `status` parametresini virgülle böler);
// "Canlı olanlar" tek bir seçenek gibi görünür ama arkasında dört durum vardır.
// =============================================================================
import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/layout/ListPage";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { DayRangeChip, SelectChip } from "@/components/data-table/filter-row/SelectChip";

/** Canlı kovalar — alınan tarafın üçü + verdiğimiz çekin ödenmemiş hâli. */
export const LIVE_STATUS = "PORTFOLIO,AT_BANK,ENDORSED,ISSUED";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: LIVE_STATUS, label: "Canlı olanlar" },
  // Vade kartının listeye yazdığı küme (H4): backend'in CHEQUE_DUE_LIVE_STATUSES
  // birleşimi — ciro edilen çekte alacak ciroya geçtiği için takvim dışıdır.
  { value: "PORTFOLIO,AT_BANK,ISSUED", label: "Vade takibi (ciro hariç)" },
  { value: "", label: "Tümü (geçmiş dahil)" },
  { value: "PORTFOLIO", label: "Elimizde" },
  { value: "AT_BANK", label: "Bankada (tahsilde)" },
  { value: "ENDORSED", label: "Ciro edildi" },
  { value: "ISSUED", label: "Verildi (ödenmemiş)" },
  { value: "COLLECTED", label: "Tahsil edildi" },
  { value: "PAID", label: "Ödendi" },
  { value: "BOUNCED", label: "Karşılıksız" },
  { value: "RETURNED", label: "İade edildi" },
  { value: "CANCELLED", label: "İptal" },
];

export interface ChequeFilterState {
  search: string;
  status: string;
  kind: string;
  docType: string;
  currency: string;
  dueFrom: string;
  dueTo: string;
}

export const EMPTY_FILTERS: ChequeFilterState = {
  search: "",
  status: LIVE_STATUS,
  kind: "",
  docType: "",
  currency: "",
  dueFrom: "",
  dueTo: "",
};

export function isFilterDirty(f: ChequeFilterState): boolean {
  return (
    f.status !== LIVE_STATUS ||
    Boolean(f.search || f.kind || f.docType || f.currency || f.dueFrom || f.dueTo)
  );
}

const STATUS_ALL = "ALL";
const STATUS_CHIP_OPTIONS = STATUS_OPTIONS.map((o) => ({ value: o.value === "" ? STATUS_ALL : o.value, label: o.label }));
const KIND_OPTIONS = [
  { value: "RECEIVED", label: "Aldığımız" },
  { value: "ISSUED", label: "Verdiğimiz" },
] as const;
const DOC_TYPE_OPTIONS = [
  { value: "CHEQUE", label: "Çek" },
  { value: "PROMISSORY_NOTE", label: "Senet" },
] as const;
const CURRENCY_OPTIONS = ["TRY", "USD", "EUR", "GBP", "RUB"].map((c) => ({ value: c, label: c }));

interface Props {
  value: ChequeFilterState;
  onChange: (next: ChequeFilterState) => void;
  /** Sağ uçtaki standart tablo araçları (Sütunlar). */
  tools?: ReactNode;
}

export function ChequeFilterBar({ value, onChange, tools }: Props) {
  const set = <K extends keyof ChequeFilterState>(key: K, v: ChequeFilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <ListToolbar className="flex-row flex-wrap items-center">
      <ListSearchBox value={value.search} onSearchChange={(v) => set("search", v)} searchHint="Belge no / seri no / keşideci / banka ara" />
      {/* Durumun "boş" değeri Canlı olanlar (resetValue); "Tümü (geçmiş dahil)" = "" → kutuda ALL nöbetçisi. */}
      <SelectChip<string>
        id="cheque-status"
        label="Durum"
        value={value.status === "" ? STATUS_ALL : value.status}
        options={STATUS_CHIP_OPTIONS}
        resetValue={LIVE_STATUS}
        onChange={(v) => set("status", v === STATUS_ALL ? "" : (v ?? LIVE_STATUS))}
      />
      <SelectChip<string> id="cheque-kind" label="Yön" value={value.kind || null} options={KIND_OPTIONS} onChange={(v) => set("kind", v ?? "")} />
      <SelectChip<string> id="cheque-doctype" label="Belge" value={value.docType || null} options={DOC_TYPE_OPTIONS} onChange={(v) => set("docType", v ?? "")} />
      <SelectChip<string> id="cheque-currency" label="Para birimi" value={value.currency || null} options={CURRENCY_OPTIONS} onChange={(v) => set("currency", v ?? "")} />
      <DayRangeChip id="cheque-due" label="Vade" from={value.dueFrom} to={value.dueTo} onChange={({ from, to }) => onChange({ ...value, dueFrom: from, dueTo: to })} />
      {isFilterDirty(value) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Filtreleri temizle
        </Button>
      )}
      {tools ? <div className="ml-auto flex items-center gap-1.5">{tools}</div> : null}
    </ListToolbar>
  );
}
