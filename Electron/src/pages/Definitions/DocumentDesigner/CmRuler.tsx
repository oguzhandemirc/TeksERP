import { rulerTicks } from "./editor/pageCanvas";

interface Props {
  /** Kâğıt genişliği (mm) — çentik sayısı. */
  widthMm: number;
  /** Kanvastaki sayfanın ekrandaki konumu (yakınlaştırma dahil, px). */
  left: number;
  width: number;
}

/** Sayfanın üstünde cm cetveli: her cm çentik, çift cm'de etiket. */
export function CmRuler({ widthMm, left, width }: Props) {
  if (width <= 0) return <div className="h-5" />;
  const pxPerCm = (width / widthMm) * 10;
  return (
    <div className="relative h-5 select-none border-b bg-muted/60" aria-label="Santimetre cetveli">
      <div className="absolute inset-y-0" style={{ left, width }}>
        {rulerTicks(widthMm).map(({ cm, labeled }) => (
          <div key={cm} className="absolute bottom-0" style={{ left: cm * pxPerCm }}>
            <div className={labeled ? "h-2.5 w-px bg-foreground/60" : "h-1.5 w-px bg-foreground/40"} />
            {labeled && (
              <span className="absolute -top-0.5 left-0.5 text-[9px] leading-none text-muted-foreground">{cm}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
