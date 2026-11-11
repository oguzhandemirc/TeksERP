import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DONEM_ETIKETI } from "./pano-bicim";
import { PANO_DONEMLERI, type PanoDonem } from "./types";

/** Satır içi ağırlık (>1100 px): 1 · 2 · 3 — Tailwind sınıfları statik kalsın diye tablo. */
const AGIRLIK = { 1: "min-[1101px]:flex-[1_1_0%]", 2: "min-[1101px]:flex-[2_1_0%]", 3: "min-[1101px]:flex-[3_1_0%]" } as const;

/** Satır hücresi: `agirlik` geniş ekranda pay, `genis` iki sütunlu (768–1100 px) düzende tam satır. */
export function Hucre({ agirlik = 1, genis, children }: { agirlik?: 1 | 2 | 3; genis?: boolean; children: ReactNode }) {
  return <div className={cn("flex min-w-0 flex-col [&>*]:flex-1", AGIRLIK[agirlik], genis && "md:col-span-2 min-[1101px]:col-span-1")}>{children}</div>;
}

/**
 * Pano satırı: >1100 px'te ağırlıklı yatay sıra (null kutu düşer, kalanlar genişler — boş kart yok);
 * 768–1100 px iki sütun, altında tek sütun. İçi boşalan hücre (kutu null döndü) DOM'a girmez.
 */
export function PanoRow({ children }: { children: ReactNode }) {
  const hucreler = Children.toArray(children).filter(
    (c): c is ReactElement<{ children: ReactNode }> => isValidElement(c) && doluMu((c.props as { children?: ReactNode }).children),
  );
  if (hucreler.length === 0) return null;
  return <div className="grid gap-4 md:grid-cols-2 min-[1101px]:flex min-[1101px]:items-stretch">{hucreler}</div>;
}

/** Hücre içeriği bir bileşense çizim anında null dönebilir; burada yalnız açıkça boş (null/false) olanlar düşer. */
function doluMu(n: ReactNode): boolean {
  return n !== null && n !== undefined && n !== false;
}

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
