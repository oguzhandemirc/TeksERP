// Görüntüleyici köşe araç çubuğu: − / yüzde / + / Sığdır / Döndür / Satıra odaklan / Büyük görünüm.
// Adımlar klavye kısayollarıyla TEK kaynaktan (keyStep) gelir.
import type { ReactNode } from "react";
import { Crosshair, Maximize2, Minimize2, Minus, Plus, RotateCw, Shrink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { keyStep, type Step } from "./useScanGestures";
import { focusBox, zoomPercent, type Box, type Geo, type View } from "./scanView";

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-8 w-8"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

interface Props {
  view: View;
  geo: Geo;
  highlight: Box | null;
  full: boolean;
  onStep: (s: Step) => void;
  onToggleFull: () => void;
}

export function ScanZoomToolbar({ view, geo, highlight, full, onStep, onToggleFull }: Props) {
  const key = (k: string) => () => {
    const s = keyStep(k, geo);
    if (s) onStep(s);
  };
  return (
    // Araç çubuğundaki tık/çift tık görüntüyü sürüklemez ya da yakınlaştırmaz.
    <div
      className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border bg-background/90 p-0.5 shadow-sm"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <ToolButton label="Uzaklaştır" onClick={key("-")}>
        <Minus />
      </ToolButton>
      <span
        className="min-w-[3rem] text-center text-xs tabular-nums"
        aria-live="polite"
        data-testid="scan-zoom-percent"
      >
        %{zoomPercent(view, geo.nat, geo.vp)}
      </span>
      <ToolButton label="Yakınlaştır" onClick={key("+")}>
        <Plus />
      </ToolButton>
      <ToolButton label="Sığdır" onClick={key("0")}>
        <Shrink />
      </ToolButton>
      <ToolButton label="Döndür (90°)" onClick={key("r")}>
        <RotateCw />
      </ToolButton>
      <ToolButton
        label="Seçili satıra odaklan"
        disabled={!highlight}
        onClick={() => highlight && onStep((v) => focusBox(v, geo, highlight, true))}
      >
        <Crosshair />
      </ToolButton>
      <ToolButton label={full ? "Büyük görünümü kapat" : "Büyük görünüm"} onClick={onToggleFull}>
        {full ? <Minimize2 /> : <Maximize2 />}
      </ToolButton>
    </div>
  );
}
