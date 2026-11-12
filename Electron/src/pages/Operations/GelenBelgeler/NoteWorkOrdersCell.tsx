// Gelen belge listesi "İş emri" hücresi: belgenin satır toplarının bağlı İE'leri (sunucu `workOrders`, iptal hariç).
// İlk 2 çip + "+N" (taşanlar title'da); çip İE detayını açar. Tıklama satır tıkına (belge detayı) kabarmaz.
import type { MouseEvent } from "react";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import type { NoteWorkOrderRef } from "./types";

export const NOTE_WO_PREVIEW = 2;

export function NoteWorkOrdersCell({ workOrders }: { workOrders: NoteWorkOrderRef[] | undefined }) {
  const openTarget = useOpenTarget();
  const list = workOrders ?? [];
  if (list.length === 0) return <span className="text-muted-foreground" data-testid="note-wo-none">—</span>;
  const shown = list.slice(0, NOTE_WO_PREVIEW);
  const rest = list.slice(NOTE_WO_PREVIEW);
  const open = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    openTarget(`/operations/work-orders/${id}`, e);
  };
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((w) => (
        <button
          key={w.id}
          type="button"
          data-testid="note-wo-chip"
          title="Sol tık: bu sekmede · Shift/Ctrl+tık: yeni sekmede"
          className="whitespace-nowrap rounded border border-primary/30 px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-primary/10"
          onClick={(e) => open(w.id, e)}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            open(w.id, e);
          }}
        >
          {w.workOrderNumber}
        </button>
      ))}
      {rest.length > 0 && (
        <span className="text-xs text-muted-foreground" data-testid="note-wo-more" title={rest.map((w) => w.workOrderNumber).join(", ")}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}
