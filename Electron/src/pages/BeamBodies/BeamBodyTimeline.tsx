// Gövde hareket geçmişi — zaman çizelgesi (en yeni üstte). Satırlar SALT-OKUNUR: geri alınan ileri satır silinmez,
// üstü çizili + "geri alındı" işaretiyle kalır; ters satır soluk. "Geri al" yalnız sunucunun `undoable` dediği satırda.
import { Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { eventTimeText, placeText } from "./model";
import { beamBodyStatusMeta, type BeamBodyEvent } from "./types";

const DOC_LABEL = { DISPATCH: "İplik sevki", OWNER_RETURN: "İade belgesi" } as const;

export function BeamBodyTimeline({ events, onUndo }: { events: BeamBodyEvent[]; onUndo: (e: BeamBodyEvent) => void }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">Hareket yok.</p>;
  const rows = [...events].reverse();
  return (
    <ol className="relative space-y-0 border-l border-border pl-6" aria-label="Hareket geçmişi">
      {rows.map((e) => {
        const meta = beamBodyStatusMeta(e.toStatus, e.toStatusLabel);
        const place = placeText(e.place);
        return (
          <li key={e.id} className={cn("relative pb-5 last:pb-0", e.isReversal && "opacity-70")}>
            <span className={cn("absolute -left-[1.95rem] top-1 h-3 w-3 rounded-full border-2 border-background", e.isReversal ? "bg-muted-foreground" : e.reversed ? "bg-slate-300" : "bg-primary")} aria-hidden />
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("font-medium", e.reversed && "line-through decoration-muted-foreground")}>{e.label}</span>
              {!e.isReversal && <Badge className={cn("font-normal", meta.badgeClass)}>{meta.label}</Badge>}
              {e.reversed && <Badge variant="outline" className="font-normal">geri alındı</Badge>}
              <span className="text-xs tabular-nums text-muted-foreground">{eventTimeText(e.createdAt)}</span>
              {e.undoable && (
                <PermissionGate permission="beam-body:write">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onUndo(e)}>
                    <Undo2 className="mr-1 h-3.5 w-3.5" /> Geri al
                  </Button>
                </PermissionGate>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
              {place !== "—" && <span>Yer: {place}</span>}
              {e.warpBeam && <span>Sarım: <span className="font-mono">{e.warpBeam.beamNo}</span></span>}
              {e.document && <span>{DOC_LABEL[e.document.kind]}: <span className="font-mono">{e.document.no}</span></span>}
              {e.reason && <span className="whitespace-pre-line">“{e.reason}”</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
