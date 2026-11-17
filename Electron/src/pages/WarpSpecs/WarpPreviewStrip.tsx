import { useFormContext, useWatch } from "react-hook-form";
import { useWarpPlan } from "@/pages/Operations/WarpPlan/service";
import { buildPreviewBody, previewText } from "./preview";
import type { WarpSpecFormValues } from "./schema";

/** 1000 m önizleme şeridi: kayıttan ÖNCE "bu kart 1000 m'de hangi iplikten kaç kg yer" — sunucu hesaplar. */
export function WarpPreviewStrip() {
  const { control } = useFormContext<WarpSpecFormValues>();
  const yarns = useWatch({ control, name: "yarns" });
  const wastePct = useWatch({ control, name: "wastePct" });
  const body = buildPreviewBody(yarns ?? [], wastePct);
  const q = useWarpPlan(body);
  const text = body && q.data?.data ? previewText(q.data.data) : null;
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="warp-preview-strip">
      {!body ? (
        <span className="text-muted-foreground">1000 m önizlemesi için her satırda iplik ve tel adedi girin.</span>
      ) : text ? (
        <>
          <div>
            <span className="font-medium">1000 m için:</span> {text.net}
          </div>
          {text.gross ? (
            <div className="text-muted-foreground">
              <span className="font-medium">Fireli:</span> {text.gross}
            </div>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground">{q.isError ? "Önizleme hesaplanamadı." : "Hesaplanıyor…"}</span>
      )}
      <p className="text-muted-foreground mt-1 text-xs">
        Hesap iplik kartındaki denyeyle yapılır; maliyet tablosundaki paylı denye buraya yazılmaz.
      </p>
    </div>
  );
}
