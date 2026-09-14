// =============================================================================
// DÜZELT (ADJUST_IN / ADJUST_OUT, sebep ZORUNLU) ve BİTİR (EXHAUSTED, terminal) diyalogları
// =============================================================================
// Düzeltme silinmez, karşı düzeltmeyle kapanır. Bitişte artık üç yoldan gelir (#13/#14 veri):
// ölçülen metre · tartı (brüt − dara; dara yoksa sunucu 0 sayar ve uyarır) · yok (0). Fark önce
// tüketim/ölçüm farkıyla kapanır, sonra bitiş satırı; dispozisyon (hurda kataloğu) isteğe bağlı.
// =============================================================================
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type AdjustPayload, type ExhaustPayload } from "../service";
import { formatM, type WarpBeam, type WarpLengthSource } from "../types";
import { BeamDialogShell, NumField, ReasonCodeSelect, ReasonField, SourceSelect, num } from "./BeamDialogShell";
import { useBeamReasons } from "./useBeamReasons";

interface AdjustProps {
  target: WarpBeam;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (body: AdjustPayload) => void;
}

export function AdjustDialog({ target, isPending, onClose, onConfirm }: AdjustProps) {
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [lengthM, setLengthM] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [reason, setReason] = useState("");
  const presets = useBeamReasons("WARP_BEAM_ADJUST");
  const m = num(lengthM);
  const ok = m != null && m > 0 && reasonCode !== "" && (direction === "IN" || m <= target.remainingM);
  return (
    <BeamDialogShell
      title={`${target.beamNo} kalan düzeltmesi`}
      description={`Türetilen kalan ${formatM(target.remainingM)}. Yanlış düzeltme silinmez, karşı düzeltmeyle kapatılır; sebep kataloğu zorunlu.`}
      confirmLabel="Düzelt"
      ok={ok}
      isPending={isPending}
      onClose={onClose}
      onConfirm={() => onConfirm({ direction, lengthM: m ?? 0, reasonCode, reason: reason.trim() || null })}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Yön</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v as "IN" | "OUT")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OUT">Kalanı AZALT (−)</SelectItem>
              <SelectItem value="IN">Kalanı ARTIR (+)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <NumField id="wb-adj-len" label="Metre" value={lengthM} onChange={setLengthM} hint={direction === "OUT" && m != null && m > target.remainingM ? "Kalanı aşıyor — eksiye düşemez." : undefined} />
        <div className="col-span-2">
          <ReasonCodeSelect label="Sebep (katalog) *" value={reasonCode} onChange={setReasonCode} presets={presets} />
        </div>
      </div>
      <ReasonField id="wb-adj-reason" value={reason} onChange={setReason} />
    </BeamDialogShell>
  );
}

interface ExhaustProps {
  target: WarpBeam;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (body: ExhaustPayload) => void;
}

type Mode = "measured" | "weighed" | "none";
const NO_REASON = "__none__";

export function ExhaustDialog({ target, isPending, onClose, onConfirm }: ExhaustProps) {
  const [mode, setMode] = useState<Mode>("none");
  const [residual, setResidual] = useState("");
  const [source, setSource] = useState<WarpLengthSource>("DIAMETER");
  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [reasonCode, setReasonCode] = useState(NO_REASON);
  const [reason, setReason] = useState("");
  const presets = useBeamReasons("WARP_BEAM_SCRAP");
  const r = num(residual);
  const g = num(gross);
  const ok = mode === "none" || (mode === "measured" && r != null && r >= 0) || (mode === "weighed" && g != null && g > 0);
  const body = (): ExhaustPayload => ({
    residualM: mode === "measured" ? r : null,
    grossKg: mode === "weighed" ? g : null,
    tareKg: mode === "weighed" ? num(tare) : null,
    lengthSource: mode === "measured" ? source : null,
    reasonCode: reasonCode === NO_REASON ? null : reasonCode,
    reason: reason.trim() || null,
  });
  return (
    <BeamDialogShell
      title={`${target.beamNo} bitti mi?`}
      description={`Türetilen kalan ${formatM(target.remainingM)}. Bitiş SON kayıttır: artık (levent dibi) yazılır, kalan sıfırlanır; tezgahtaysa yuva boşalır. Geri alınabilir (LIFO).`}
      confirmLabel="Bitir"
      destructive
      ok={ok}
      isPending={isPending}
      onClose={onClose}
      onConfirm={() => onConfirm(body())}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1 col-span-2">
          <Label>Artık nasıl bilindi</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Artık yok / bilinmiyor (0 sayılır)</SelectItem>
              <SelectItem value="measured">Ölçülen metre</SelectItem>
              <SelectItem value="weighed">Tartı (brüt − dara → metre)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "measured" && (
          <>
            <NumField id="wb-ex-res" label="Artık (m)" value={residual} onChange={setResidual} />
            <SourceSelect value={source} onChange={setSource} />
          </>
        )}
        {mode === "weighed" && (
          <>
            <NumField id="wb-ex-gross" label="Brüt (kg)" value={gross} onChange={setGross} />
            <NumField id="wb-ex-tare" label="Dara (kg)" value={tare} onChange={setTare} hint="Dara bilinmiyorsa metre türetilemez; sunucu artığı 0 sayar ve uyarır." />
          </>
        )}
        <div className="col-span-2">
          <ReasonCodeSelect label="Artık dispozisyonu (isteğe bağlı)" value={reasonCode} onChange={setReasonCode} presets={[{ code: NO_REASON, label: "Belirtilmedi" }, ...presets]} />
        </div>
      </div>
      <ReasonField id="wb-ex-reason" value={reason} onChange={setReason} />
    </BeamDialogShell>
  );
}
