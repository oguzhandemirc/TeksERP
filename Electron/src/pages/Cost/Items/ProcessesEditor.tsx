// Yapı sekmesi "Ek işlemler" (SY-G1): kurşun/devere gibi işlemlerin tarife kodları, sırayla. Tutar ve döküm
// SUNUCUDA (`PROCESS` satırları terbiyeden sonra, genel giderden önce); burada yalnız kod listesi düzenlenir.
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FinishingRate } from "../FinishingRates/service";
import { fmtDecFull } from "../shared/format";

interface Props {
  codes: string[];
  onChange: (codes: string[]) => void;
  rates: FinishingRate[];
  finishingCode: string;
  disabled: boolean;
}

export function moveCode(codes: string[], i: number, delta: -1 | 1): string[] {
  const j = i + delta;
  if (j < 0 || j >= codes.length) return codes;
  const out = [...codes];
  out.splice(j, 0, ...out.splice(i, 1));
  return out;
}

export function ProcessesEditor({ codes, onChange, rates, finishingCode, disabled }: Props) {
  const byCode = new Map(rates.map((r) => [r.code, r]));
  const addable = rates.filter((r) => !codes.includes(r.code) && r.code !== finishingCode);
  return (
    <section className="space-y-2" data-field="processes">
      <h3 className="text-sm font-medium">Ek işlemler</h3>
      <p className="text-xs text-muted-foreground">Kurşun, devere gibi işlemler; terbiyeden sonra, genel giderden önce maliyete eklenir.</p>
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
        <select aria-label="Ek işlem ekle" value="" onChange={(e) => e.target.value && onChange([...codes, e.target.value])} className="h-9 w-full rounded-md border bg-background px-2 text-sm sm:w-auto">
          <option value="">+ Ek işlem ekle…</option>
          {addable.map((r) => <option key={r.id} value={r.code}>{r.code} — {r.name} ({fmtDecFull(r.pricePerM)} {r.currency}/m)</option>)}
        </select>
      )}
    </section>
  );
}
