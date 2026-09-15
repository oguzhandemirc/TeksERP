// =============================================================================
// ÇOKLU EKSEN SEÇİCİSİ — "Tümü" = boş seçim
// =============================================================================
// Liste eksenleri (müşteri · kumaş · renk · fasoncu · sebep) çoklu seçilir ve
// URL'de CSV olarak yaşar. Seçenekler raporun KENDİ yanıtından gelir
// (`meta.secenekler`) — ayrı izin isteyen bir liste ucundan değil; kaynak
// süzgeçten bağımsızdır, yani seçim yaptıkça liste DARALMAZ.
//
// ⚠️ "Tümü" bir seçenek DEĞİL, seçimin YOKLUĞUDUR: temizleme düğmesi seçimi
// boşaltır ve istekten anahtar tamamen düşer (bugünkü davranış).
// =============================================================================
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ReportAxisOption } from "../_services/types";

interface Props {
  id: string;
  label: string;
  options: ReportAxisOption[] | undefined;
  /** Seçili id/kod listesi; boş = Tümü. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Seçenek yokken (pencerede hiç değer geçmemiş) şerit yine çizilir, pasif. */
  emptyHint?: string;
}

const keyOf = (o: ReportAxisOption): string => o.id ?? o.code ?? "";

export function ReportMultiSelect({ id, label, options, value, onChange, emptyHint }: Props) {
  const list = options ?? [];
  const selected = new Set(value);
  const summaryText =
    value.length === 0
      ? "Tümü"
      : value.length === 1
        ? (list.find((o) => keyOf(o) === value[0])?.ad ?? value[0]!)
        : `${value.length} seçili`;
  const toggle = (k: string) => {
    const next = selected.has(k) ? value.filter((v) => v !== k) : [...value, k];
    onChange(next);
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button id={id} type="button" variant="outline" size="sm" className="w-56 justify-between" disabled={list.length === 0}>
              <span className="truncate">{list.length === 0 ? (emptyHint ?? "Seçenek yok") : summaryText}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-80 w-72 overflow-auto p-1">
            {list.map((o) => {
              const k = keyOf(o);
              const on = selected.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggle(k)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Check className={on ? "h-4 w-4" : "h-4 w-4 opacity-0"} />
                  <span className="truncate">{o.kod ? `${o.kod} · ${o.ad}` : o.ad}</span>
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
        {value.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])} title="Süzgeci temizle">
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
