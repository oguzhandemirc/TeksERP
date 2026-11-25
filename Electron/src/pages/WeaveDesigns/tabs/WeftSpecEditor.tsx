// Atkı kartı içeriği — harf = iplik satırının sırası (A, B, C…). Sıra kodu (`A4 B1 A4 C1`) doluysa rapordaki adetleri
// sunucu türetir. Alanlar `WeftContentFields`te (ürün penceresi ve Atkı Kartları ekranı aynısını kullanır).
// D3/K7: desen kartında atkı SALT OKUNURDUR (`WeftSpecView`); kumaşın atkısı ürün penceresinde, ortak kart Atkı Kartları
// ekranında düzenlenir.
import type { WeftSpecDetail } from "../types";
import { decimalToFormText } from "@/lib/decimal-form-text";
import { weftShareCell, weftShareNote, weftShareVisible } from "./weft-share";
import { weftLetter, WeftContentFields, WeftRowsHeader, type WeftContent } from "./WeftContentFields";

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

/** Kayıtlı atkı kartının salt okunur görünümü (alanlar kilitli; pay % sunucudan). */
export function WeftSpecView({ spec }: { spec: WeftSpecDetail }) {
  const shares = weftShareVisible(spec);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Atkı kartı: <span className="font-mono text-xs">{spec.code}</span> · {spec.name}</p>
      <WeftContentFields
        value={weftContentFromSpec(spec)}
        onChange={() => undefined}
        canWrite={false}
        savedSeq={spec.sequenceCode ?? ""}
        header={shares ? <WeftRowsHeader extra="Pay %" /> : undefined}
        rowExtra={shares ? (i) => <WeftShareCell spec={spec} index={i} /> : undefined}
      />
      {shares && <p className="text-xs text-muted-foreground" data-testid="weft-share-note">{weftShareNote(spec)}</p>}
    </div>
  );
}

// Pay % hücresi — yalnız sunucu payı gönderdiyse çizilir (weftShareVisible).
function WeftShareCell({ spec, index }: { spec: WeftSpecDetail; index: number }) {
  return (
    <span className="text-right text-sm tabular-nums text-muted-foreground" aria-label={`Atkı ${weftLetter(index)} pay`} title="Atkıdaki payı">
      {weftShareCell(spec, index, true)}
    </span>
  );
}
