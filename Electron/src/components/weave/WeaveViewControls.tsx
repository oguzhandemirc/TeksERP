// Kart görseli görünüm denetimleri: küçük bölümlü seçim (yön, rapor tekrarı). Seçim yalnız görünümü değiştirir.
import { ArrowDownFromLine, ArrowUpFromLine } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { WeaveDirection } from "./weave-direction";

export interface SegmentOption<T extends string | number> { value: T; label: ReactNode; title?: string }

export function WeaveSegmented<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly SegmentOption<T>[]; onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-md border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title}
          onClick={() => onChange(o.value)}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors",
            o.value === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const DIRECTION_OPTIONS: readonly SegmentOption<WeaveDirection>[] = [
  { value: "bottom-up", label: <><ArrowUpFromLine className="h-3.5 w-3.5" />Atkı 1 altta</>, title: "Tezgâhın armür ekranı gibi: 1. atkı en altta, yukarı doğru artar" },
  { value: "top-down", label: <><ArrowDownFromLine className="h-3.5 w-3.5" />Atkı 1 üstte</>, title: "Basılı desen kartı gibi: 1. atkı en üstte" },
];

export function WeaveDirectionToggle({ value, onChange }: { value: WeaveDirection; onChange: (d: WeaveDirection) => void }) {
  return <WeaveSegmented label="Izgara yönü" value={value} options={DIRECTION_OPTIONS} onChange={onChange} />;
}
