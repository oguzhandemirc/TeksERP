import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Typeface } from "@/lib/theme/appearance";

export const TYPEFACES: { value: Typeface; label: string; hint?: string }[] = [
  { value: "inter", label: "Inter", hint: "Varsayılan" },
  { value: "dm-sans", label: "DM Sans" },
  { value: "nunito-sans", label: "Nunito Sans" },
  { value: "jakarta", label: "Plus Jakarta Sans" },
  { value: "source-serif", label: "Source Serif", hint: "Okuma yazısı" },
];

/** Örnek satır Türkçe harfleri ve hizalı rakamı birlikte gösterir — seçmeden önce görülsün. */
const SAMPLE = "Çözgü İğne Şükrü · 12.480,50 m";

/** Yazı tipi seçici — her seçenek kendi `data-typeface` kapsamında çizilir (yazı adı literal değil). */
export function TypefacePicker({ value, onChange }: { value: Typeface; onChange: (v: Typeface) => void }) {
  return (
    <div role="radiogroup" aria-label="Yazı tipi" className="grid gap-1 rounded-[var(--radius-control)] bg-muted p-1">
      {TYPEFACES.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-typeface={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-3 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="w-32 shrink-0 text-xs font-semibold">
              {o.label}
              {o.hint ? <span className="block text-[10px] font-normal text-muted-foreground">{o.hint}</span> : null}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm tabular-nums">{SAMPLE}</span>
            {on ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
