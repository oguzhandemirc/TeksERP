import { ClipboardList, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SackSearchRow } from "./types";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

interface Props {
  selected: SackSearchRow[];
  onShip: () => void;
  onPickList: () => void;
  onClear: () => void;
}

/**
 * Seçim varken beliren YAPIŞKAN aksiyon çubuğu — kaçırılması imkansız. Solda
 * "N çuval · X m · Y kg seçildi", sağda büyük birincil "Sevk Et". Yalnız depodaki
 * çuvallar seçilebildiğinden buradaki her çuval sevke uygundur.
 */
export function SelectionActionBar({ selected, onShip, onPickList, onClear }: Props) {
  if (selected.length === 0) return null;
  const totalM = selected.reduce((a, s) => a + s.totalQty, 0);
  const totalKg = selected.reduce((a, s) => a + (s.weightKg ?? 0), 0);

  return (
    <div className="sticky bottom-0 z-20 border-t-2 border-primary/40 bg-gradient-to-r from-primary/15 via-card to-card px-6 py-3 shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.15)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold tabular-nums text-primary">{selected.length}</span>
          <span className="text-sm font-medium">çuval seçildi</span>
          <span className="text-sm text-muted-foreground">
            · <span className="font-semibold text-foreground tabular-nums">{fmtM(totalM)} m</span>
            {totalKg > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-foreground tabular-nums">{fmtM(totalKg)} kg</span>
              </>
            ) : null}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear} className="gap-1.5 text-muted-foreground">
            <X className="h-4 w-4" /> Seçimi temizle
          </Button>
          <Button variant="outline" size="sm" onClick={onPickList} className="gap-1.5">
            <ClipboardList className="h-4 w-4" /> Çeki Listesi
          </Button>
          <Button
            size="lg"
            onClick={onShip}
            className="h-11 gap-2 bg-primary px-6 text-base font-semibold shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/40"
          >
            <Truck className="h-5 w-5" /> Sevk Et
          </Button>
        </div>
      </div>
    </div>
  );
}
