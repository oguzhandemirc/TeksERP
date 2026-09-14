// =============================================================================
// SÖK (MOUNTED → READY) ve TÜKET (CONSUMED) diyalogları
// =============================================================================
// Söküm: ölçülen kalan verilirse fark sunucuda ÖNCE kapanır (fazla tüketim → CONSUMED, eksik →
// ADJUST_IN "ölçüm farkı"); boş bırakılırsa türetilen kalan olduğu gibi kalır. Tüketim kalanı
// aşamaz (409 adıyla); token mantıksal deneme başına.
// =============================================================================
import { useState } from "react";
import { type ConsumePayload, type DismountPayload } from "../service";
import { formatM, type WarpBeam, type WarpLengthSource } from "../types";
import { BeamDialogShell, NumField, ReasonField, SourceSelect, num } from "./BeamDialogShell";

interface DismountProps {
  target: WarpBeam;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (body: DismountPayload) => void;
}

export function DismountDialog({ target, isPending, onClose, onConfirm }: DismountProps) {
  const [remaining, setRemaining] = useState("");
  const [source, setSource] = useState<WarpLengthSource>("LOOM_COUNTER");
  const [counter, setCounter] = useState("");
  const [reason, setReason] = useState("");
  const measured = num(remaining);
  const ok = measured == null || measured >= 0;
  return (
    <BeamDialogShell
      title={`${target.beamNo} tezgahtan sökülsün mü?`}
      description={`${target.currentMachine?.name ?? "—"} · yuva ${target.currentPosition ?? "—"} · türetilen kalan ${formatM(target.remainingM)}. Levent hazır stoğa döner; açık koşum varken son levent sökülemez.`}
      confirmLabel="Sök"
      ok={ok}
      isPending={isPending}
      onClose={onClose}
      onConfirm={() => onConfirm({ remainingM: measured, lengthSource: measured == null ? null : source, machineCounter: num(counter), reason: reason.trim() || null })}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField id="wb-dm-rem" label="Ölçülen kalan (m, isteğe bağlı)" value={remaining} onChange={setRemaining} hint={measured == null ? "Boş: kalan defterdeki gibi kalır." : measured < target.remainingM ? `Fark ${formatM(target.remainingM - measured)} tüketim yazılır.` : measured > target.remainingM ? `Fark ${formatM(measured - target.remainingM)} ölçüm farkı düzeltmesi yazılır.` : "Fark yok."} />
        <SourceSelect value={source} onChange={setSource} />
        <NumField id="wb-dm-counter" label="Tezgah sayacı (m)" value={counter} onChange={setCounter} />
      </div>
      <ReasonField id="wb-dm-reason" value={reason} onChange={setReason} />
    </BeamDialogShell>
  );
}

interface ConsumeProps {
  target: WarpBeam;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (body: ConsumePayload) => void;
}

export function ConsumeDialog({ target, isPending, onClose, onConfirm }: ConsumeProps) {
  const [clientToken] = useState(() => crypto.randomUUID());
  const [lengthM, setLengthM] = useState("");
  const [source, setSource] = useState<WarpLengthSource>("LOOM_COUNTER");
  const [counter, setCounter] = useState("");
  const [fabric, setFabric] = useState("");
  const [reason, setReason] = useState("");
  const m = num(lengthM);
  const ok = m != null && m > 0 && m <= target.remainingM;
  return (
    <BeamDialogShell
      title={`${target.beamNo} tüketim yaz`}
      description={`Kalan ${formatM(target.remainingM)}. Elle tüketim (Faz 4'te top çıkışından kendiliğinden yazılacak); kalan eksiye düşemez.`}
      confirmLabel="Tüketimi yaz"
      ok={ok}
      isPending={isPending}
      onClose={onClose}
      onConfirm={() => onConfirm({ lengthM: m ?? 0, lengthSource: source, machineCounter: num(counter), fabricLengthM: num(fabric), reason: reason.trim() || null, clientToken })}
    >
      <div className="grid grid-cols-2 gap-3">
        <NumField id="wb-cs-len" label="Tüketilen metre" value={lengthM} onChange={setLengthM} hint={m != null && m > target.remainingM ? `Kalanı (${formatM(target.remainingM)}) aşıyor — önce kalanı düzeltin.` : undefined} />
        <SourceSelect value={source} onChange={setSource} />
        <NumField id="wb-cs-counter" label="Tezgah sayacı (m)" value={counter} onChange={setCounter} />
        <NumField id="wb-cs-fabric" label="Dokunan kumaş (m, bilgi)" value={fabric} onChange={setFabric} />
      </div>
      <ReasonField id="wb-cs-reason" value={reason} onChange={setReason} />
    </BeamDialogShell>
  );
}
