import { cn } from "@/lib/utils";
import { DONEM_ETIKETI } from "./pano-bicim";
import { PANO_DONEMLERI, type PanoDonem } from "./types";

export function DonemSecici({ donem, onChange }: { donem: PanoDonem; onChange: (d: PanoDonem) => void }) {
  return (
    <div role="radiogroup" aria-label="Dönem" className="flex rounded-xl border border-card-border bg-card p-1 shadow-card">
      {PANO_DONEMLERI.map((d) => (
        <button key={d} type="button" role="radio" aria-checked={d === donem} onClick={() => onChange(d)}
          className={cn("rounded-lg px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            d === donem ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {DONEM_ETIKETI[d]}
        </button>
      ))}
    </div>
  );
}
