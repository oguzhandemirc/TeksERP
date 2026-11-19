import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { InfoPopover } from "@/components/ui/info-popover";
import { highlightParts } from "./settings-groups";
import { cn } from "@/lib/utils";

/**
 * Ayar açıklamasının gösterim biçimi. Amaç: ayar ekranındaki uzun açıklama
 * metnini satırdan kaldırıp "iste-gör" bir tetiğin arkasına almak.
 *  - inline:     açıklama başlığın altında HER ZAMAN görünür (klasik / mevcut).
 *  - popover:    başlık yanında (i) ikonu; tıklayınca açıklama balonda açılır.
 *  - disclosure: başlık altında "Açıklama ▾"; tıklayınca satır altında inline açılır.
 */
// Ortak bileşene taşındı; ayar ekranı importları bozulmasın diye buradan da verilir.
export { InfoPopover };

export type HintVariant = "inline" | "popover" | "disclosure";

/** "Açıklama ▾" bağlantısı → açıklamayı satır altında inline aç/kapat. */
export function InfoDisclosure({ desc }: { desc: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        Açıklama
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && <p className="mt-1 leading-relaxed text-muted-foreground">{desc}</p>}
    </div>
  );
}

/**
 * Başlık satırının yanında yalnız `popover` modunda (i) ikonu gösterir.
 * inline/disclosure modlarında hiçbir şey basmaz (açıklama başlık ALTINDA gelir).
 */
export function HintIcon({ variant, desc }: { variant: HintVariant; desc: ReactNode }) {
  if (variant !== "popover" || !desc) return null;
  return <InfoPopover desc={desc} />;
}

/**
 * Başlığın ALTINA gelen açıklama gövdesi: inline → düz metin, disclosure → aç/kapat,
 * popover → hiçbir şey (açıklama başlık yanındaki ikonda). Boş desc'te hiçbir şey.
 */
export function HintBody({ variant, desc }: { variant: HintVariant; desc: ReactNode }) {
  if (!desc) return null;
  if (variant === "inline") return <p className="text-xs text-muted-foreground">{desc}</p>;
  if (variant === "disclosure") return <InfoDisclosure desc={desc} />;
  return null;
}

/** Arama vurgusu — eşleşen kelime parçaları primary renkle işaretlenir; sorgu yoksa düz metin. */
export function Vurgu({ text, query }: { text: string; query?: string }) {
  if (!query?.trim()) return <>{text}</>;
  return (
    <>
      {highlightParts(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-primary">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
