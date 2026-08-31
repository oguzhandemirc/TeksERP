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
import { RotateCcw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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

interface Props {
  value: ChequeFilterState;
  onChange: (next: ChequeFilterState) => void;
}

export function ChequeFilterBar({ value, onChange }: Props) {
  const set = <K extends keyof ChequeFilterState>(key: K, v: ChequeFilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
      <div className="relative w-72">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Belge no / seri no / keşideci / banka ara…"
          value={value.search}
          onChange={(e) => set("search", e.target.value)}
        />
      </div>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value.status}
        onChange={(e) => set("status", e.target.value)}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.label} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value.kind}
        onChange={(e) => set("kind", e.target.value)}
      >
        <option value="">Tüm yönler</option>
        <option value="RECEIVED">Aldığımız</option>
        <option value="ISSUED">Verdiğimiz</option>
      </select>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value.docType}
        onChange={(e) => set("docType", e.target.value)}
      >
        <option value="">Çek + Senet</option>
        <option value="CHEQUE">Yalnız çek</option>
        <option value="PROMISSORY_NOTE">Yalnız senet</option>
      </select>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value.currency}
        onChange={(e) => set("currency", e.target.value)}
      >
        <option value="">Tüm para birimleri</option>
        {["TRY", "USD", "EUR", "GBP", "RUB"].map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">Vade</span>
      <Input
        type="date"
        className="w-36"
        title="Vade başlangıcı"
        value={value.dueFrom}
        onChange={(e) => set("dueFrom", e.target.value)}
      />
      <Input
        type="date"
        className="w-36"
        title="Vade bitişi"
        value={value.dueTo}
        onChange={(e) => set("dueTo", e.target.value)}
      />
      {isFilterDirty(value) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Filtreleri temizle
        </Button>
      )}
    </div>
  );
}
