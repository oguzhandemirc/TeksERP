import { cn } from "@/lib/utils";
import { SIZE_CHOICES, type SizeChoice } from "./pano-layout";

const LABEL: Record<SizeChoice, string> = { kucuk: "Küçük", orta: "Orta", genis: "Geniş" };

/** Düzenleme kipinde kutu boyutu (Küçük / Orta / Geniş) — sürükleme tutamağını tetiklemez. */
export function SizePicker({ title, value, onChange }: { title: string; value: SizeChoice; onChange: (s: SizeChoice) => void }) {
  return (
    <div role="radiogroup" aria-label={`${title} boyutu`} className="mt-3 inline-flex self-start rounded-lg bg-muted p-0.5 text-xs"
      onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {SIZE_CHOICES.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} onClick={() => onChange(s)}
          className={cn("rounded-md px-2.5 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === s ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}>
          {LABEL[s]}
        </button>
      ))}
    </div>
  );
}
