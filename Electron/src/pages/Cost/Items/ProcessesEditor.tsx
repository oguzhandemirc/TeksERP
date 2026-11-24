// Yapı sekmesi "Ek işlemler" (SY-G1): kurşun/devere gibi işlemlerin tarife kodları, sırayla. Tutar ve döküm
// SUNUCUDA (`PROCESS` satırları terbiyeden sonra, genel giderden önce); burada yalnız kod listesi düzenlenir.
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { SectionCard } from "@/components/ui/section-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FinishingRate } from "../FinishingRates/service";
import { fmtDecFull } from "../shared/format";

interface Props {
  codes: string[];
  onChange: (codes: string[]) => void;
  rates: FinishingRate[];
  finishingCode: string;
  disabled: boolean;
  className?: string;
}

export function moveCode(codes: string[], i: number, delta: -1 | 1): string[] {
  const j = i + delta;
  if (j < 0 || j >= codes.length) return codes;
  const out = [...codes];
  out.splice(j, 0, ...out.splice(i, 1));
  return out;
}

export function ProcessesEditor({ codes, onChange, rates, finishingCode, disabled, className }: Props) {
  const byCode = new Map(rates.map((r) => [r.code, r]));
  const addable = rates.filter((r) => !codes.includes(r.code) && r.code !== finishingCode);
  return (
    <div data-field="processes" className={className}>
    <SectionCard title="Ek işlemler" className="h-full" contentClassName="space-y-2"
      titleExtra={<InfoPopover label="Ek işlemler açıklaması" desc="Kurşun, devere gibi işlemler; terbiyeden sonra, genel giderden önce maliyete eklenir. Sıra döküm sırasıdır." />}>
      {codes.length === 0 && <p className="text-sm text-muted-foreground">Ek işlem yok.</p>}
      <ol className="space-y-1">
        {codes.map((c, i) => {
          const r = byCode.get(c);
          return (
            <li key={c} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <span className="w-6 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className="flex-1">{r ? `${r.code} — ${r.name} (${fmtDecFull(r.pricePerM)} ${r.currency}/m)` : `${c} (aktif değil)`}</span>
              {!disabled && (
                <>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`${c} yukarı`} disabled={i === 0} onClick={() => onChange(moveCode(codes, i, -1))}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`${c} aşağı`} disabled={i === codes.length - 1} onClick={() => onChange(moveCode(codes, i, 1))}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`${c} kaldır`} onClick={() => onChange(codes.filter((x) => x !== c))}><X className="h-4 w-4" /></Button>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {!disabled && addable.length > 0 && (
        // Ortak seçici (B18/13); değer hep boş — seçim listeye eklenir, kutu yer tutucuya döner.
        <Select value="" onValueChange={(v) => v && onChange([...codes, v])}>
          <SelectTrigger aria-label="Ek işlem ekle" className="w-full sm:w-auto sm:min-w-64"><SelectValue placeholder="+ Ek işlem ekle…" /></SelectTrigger>
          <SelectContent>
            {addable.map((r) => <SelectItem key={r.id} value={r.code}>{r.code} — {r.name} ({fmtDecFull(r.pricePerM)} {r.currency}/m)</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </SectionCard>
    </div>
  );
}
