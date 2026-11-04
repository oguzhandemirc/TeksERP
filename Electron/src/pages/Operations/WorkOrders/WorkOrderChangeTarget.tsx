import { useState } from "react";
import { ChangeTargetDialog } from "./ChangeTargetDialog";
import type { WorkOrder } from "./types";

type ChangeMode = "color" | "width";

/**
 * "Rengi/Eni Değiştir" durumu — tam sayfa başlık ve yan panel AYNI kancayı kullanır.
 * Bağ koparınca önerilen renk tutulur; diyalog bu renk seçili açılır, kapanınca düşer.
 */
export function useChangeTarget() {
  const [mode, setMode] = useState<ChangeMode | null>(null);
  const [suggestedColorId, setSuggestedColorId] = useState<string | null>(null);
  return {
    mode,
    suggestedColorId,
    open: (m: ChangeMode) => setMode(m),
    suggestColor: (colorId: string) => {
      setSuggestedColorId(colorId);
      setMode("color");
    },
    close: () => {
      setMode(null);
      setSuggestedColorId(null);
    },
  };
}

export function WorkOrderChangeTargetDialog({
  wo,
  state,
}: {
  wo: WorkOrder;
  state: ReturnType<typeof useChangeTarget>;
}) {
  return (
    <ChangeTargetDialog
      open={state.mode !== null}
      onOpenChange={(o) => !o && state.close()}
      mode={state.mode ?? "color"}
      workOrderId={wo.id}
      workOrderNumber={wo.workOrderNumber}
      currentColorId={wo.targetColorId}
      currentColorName={wo.targetColor?.name ?? null}
      currentWidth={wo.width}
      orderLinks={wo.orderLinks}
      initialColorId={state.mode === "color" ? state.suggestedColorId : null}
    />
  );
}
