// Atkı kartı düzenleyici — harf = iplik satırının sırası (A, B, C…). Sıra kodu (`A4 B1 A4 C1`) doluysa
// rapordaki adetler gövdeye konmaz, sunucu aynı tx'te türetir; boşsa elle adet (bugünkü davranış).
// Alanlar `WeftContentFields`te (ürün penceresi de aynısını kullanır).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SpecOpenOrdersNotice } from "@/components/production/SpecOpenOrdersNotice";
import { weftSpecApi } from "../service";
import type { WeftSpecDetail } from "../types";
import { decimalToFormText } from "@/lib/decimal-form-text";
import { weftRowsMatchSaved, weftShareCell, weftShareNote, weftShareVisible } from "./weft-share";
import { buildWeftBody, weftContentReady, weftLetter, WeftContentFields, WeftRowsHeader, type WeftContent } from "./WeftContentFields";

export { buildWeftBody, weftLetter } from "./WeftContentFields";

/** Kayıtlı kartın içeriği — forma. */
export function weftContentFromSpec(spec: Pick<WeftSpecDetail, "sequenceCode" | "picksPerCm" | "weftProgramNo" | "yarns">): WeftContent {
  return {
    seq: spec.sequenceCode ?? "",
    picksPerCm: decimalToFormText(spec.picksPerCm),
    program: spec.weftProgramNo ?? "",
    rows: spec.yarns.map((y) => ({ yarnItemId: y.yarnItemId, picks: String(y.picksInRepeat), channel: y.colorChannel != null ? String(y.colorChannel) : "" })),
  };
}

interface EditorProps {
  spec: WeftSpecDetail; fabricId: string; canWrite: boolean;
  /** Yazılan (kaydedilmemiş) sıra kodu — yan görselin "kaydedince güncellenir" notu için. */
  onSequenceChange?: (seq: string) => void;
}

export function WeftSpecEditor({ spec, fabricId, canWrite, onSequenceChange }: EditorProps) {
  const qc = useQueryClient();
  const [content, setContent] = useState<WeftContent>(() => weftContentFromSpec(spec));
  const save = useMutation({
    mutationFn: () => weftSpecApi.update(spec.id, buildWeftBody(content.seq, content.picksPerCm, content.program, content.rows)),
    onSuccess: () => {
      toast.success("Atkı kartı güncellendi.");
      void qc.invalidateQueries({ queryKey: ["weft-specs"] });
      void qc.invalidateQueries({ queryKey: ["item-construction", fabricId] });
      void qc.invalidateQueries({ queryKey: ["spec-open-orders"] });
    },
  });
  const shares = weftShareVisible(spec);
  const sharesMatch = shares && weftRowsMatchSaved(spec, content.rows, content.seq);
  const change = (next: WeftContent) => {
    if (next.seq !== content.seq) onSequenceChange?.(next.seq);
    setContent(next);
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Atkı kartı: <span className="font-mono text-xs">{spec.code}</span> · {spec.name}</p>
      {canWrite && <SpecOpenOrdersNotice kind="weft" id={spec.id} />}
      <WeftContentFields
        value={content}
        onChange={change}
        canWrite={canWrite}
        savedSeq={spec.sequenceCode ?? ""}
        header={shares ? <WeftRowsHeader extra="Pay %" /> : undefined}
        rowExtra={shares ? (i) => <WeftShareCell spec={spec} index={i} matches={sharesMatch} /> : undefined}
      />
      {shares && <p className="text-xs text-muted-foreground" data-testid="weft-share-note">{weftShareNote(spec)}</p>}
      {canWrite && (
        <Button size="sm" disabled={!weftContentReady(content) || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
      )}
    </div>
  );
}

// Pay % hücresi — yalnız sunucu payı gönderdiyse çizilir (weftShareVisible).
function WeftShareCell({ spec, index, matches }: { spec: WeftSpecDetail; index: number; matches: boolean }) {
  return (
    <span className="text-right text-sm tabular-nums text-muted-foreground" aria-label={`Atkı ${weftLetter(index)} pay`} title={matches ? "Atkıdaki payı" : "Kaydedince yeniden hesaplanır"}>
      {weftShareCell(spec, index, matches)}
    </span>
  );
}
