// =============================================================================
// SAR (WOUND) — PLANNED → READY: metre · kg kaynağı · (içeride) devere makinesi + brüt iplik + dip iadesi
// =============================================================================
// Nominal kg formülü sunucunun aynası (ön hesap); sunucu yeniden hesaplar ve olay satırına yazar.
// Fason/hazır alım kökeninde iplik satırı YOK (iplik tüketimi bizim defterde değil, §3.9).
// =============================================================================
import { useMemo, useState } from "react";
import { WeavingOrderPicker } from "./WeavingOrderField";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { useDevereBeamBodyMode, useDevereBeamWeavingLinkRequired, useDevereLotRequired } from "@/hooks/usePricingEnabled";
import type { BeamBody } from "@/pages/BeamBodies/types";
import { DispatchBeamBodies, type BeamBodyCardCopy } from "../WarpingOrders/DispatchBeamBodies";
import { useAttemptToken } from "@/lib/attemptToken";
import { listAllActiveYarnLots } from "@/pages/Operations/Yarn/service";
import { reasonPresetService } from "@/pages/ReasonPresets/service";
import { warpBeamService, type WindPayload } from "./service";
import { YarnLinesEditor, type YarnLineDraft } from "./YarnLinesEditor";
import { WindFields } from "./WindFields";
import { SetFields } from "./SetFields";
import { theoreticalKg, type WarpBeam, type WarpKgSource } from "./types";

interface Props {
  target: WarpBeam;
  isPending: boolean;
  onClose: () => void;
  /** Sonuç diyaloğa döner: token belirsiz hatada yapışır, kesin 4xx'te yenilenir (kk1.md). */
  onConfirm: (body: WindPayload) => Promise<unknown>;
}

function toLines(lines: YarnLineDraft[], withReason: boolean) {
  return lines.map((l) => ({ warehouseId: l.warehouseId, qtyKg: Number(l.qtyKg), lotId: l.lotId || null, ...(withReason ? { reasonCode: l.reasonCode } : {}) }));
}

interface WindDraft {
  lengthM: string; kgSource: WarpKgSource; inHouse: boolean; machineId: string; issues: YarnLineDraft[]; returns: YarnLineDraft[];
  breakCount: string; clientToken: string; weavingOrderId: string; count: string; prefix: string;
  beamBodyIds?: string[];
}

/** İçeride sarım için gövde kartı metni (adet kadar, sırayla takımın 1..N leventine). */
function windBodyCopy(required: boolean): BeamBodyCardCopy {
  return {
    hint: required ? "· ZORUNLU — her levente bir boş gövde okutun (sırayla 1..N)" : "· isteğe bağlı — okutursanız her levente bir gövde (sırayla 1..N)",
    empty: required ? "Gövde okutulmadı — bu kurulumda içeride sarım gövdesiz yapılamaz." : "Gövde seçilmedi — sarım gövdesiz yapılır.",
    notEmptyStock: "yalnız depoda boş gövde sarılır.",
    overMax: (max) => `${max} levent sarılıyor — en çok ${max} gövde.`,
    pickDescription: (max) => `Sarılacak leventlerin gövdelerini işaretleyin (adet kadar: ${max}).`,
  };
}

/** Gövde kapısı (sunucu aynası): OFF/fason → serbest; içeride REQUIRED → adet kadar; OPTIONAL → hiç ya da adet kadar. */
export function windBodiesOk(mode: "OFF" | "OPTIONAL" | "REQUIRED", inHouse: boolean, picked: number, count: number): boolean {
  if (mode === "OFF" || !inHouse) return true;
  return picked === count || (mode === "OPTIONAL" && picked === 0);
}

/** Diyalog taslağı → uç gövdesi (saf). Adet 1 → raşel alanları GİDMEZ (bugünkü istek bayt bayt); bağ "" → null; gövde yoksa alan yok. */
export function buildWindPayload(d: WindDraft): WindPayload {
  return {
    ...(d.inHouse && d.beamBodyIds?.length ? { beamBodyIds: [...d.beamBodyIds] } : {}),
    lengthM: Number(d.lengthM),
    kgSource: d.kgSource,
    machineId: d.inHouse ? d.machineId : null,
    ...(d.inHouse ? { yarnIssues: toLines(d.issues, false), yarnReturns: toLines(d.returns, true) as WindPayload["yarnReturns"] } : {}),
    breakCount: d.breakCount === "" ? null : Number(d.breakCount),
    clientToken: d.clientToken,
    weavingOrderId: d.weavingOrderId || null,
    ...(Number(d.count) > 1 ? { count: Number(d.count), physicalBeamNoPrefix: d.prefix.trim() || null } : {}),
  };
}

export function WindDialog({ target, isPending, onClose, onConfirm }: Props) {
  const attempt = useAttemptToken();
  const inHouse = target.originKind === "IN_HOUSE";
  const [lengthM, setLengthM] = useState(String(target.plannedLengthM));
  const [kgSource, setKgSource] = useState<WarpKgSource>(inHouse ? "WEIGHED" : "THEORETICAL");
  const [machineId, setMachineId] = useState("");
  const [breakCount, setBreakCount] = useState("");
  const [issues, setIssues] = useState<YarnLineDraft[]>([]);
  const [returns, setReturns] = useState<YarnLineDraft[]>([]);
  const [count, setCount] = useState("1");
  const [weavingOrderId, setWeavingOrderId] = useState(target.weavingOrder?.id ?? "");
  const [prefix, setPrefix] = useState("");
  const [bodies, setBodies] = useState<BeamBody[]>([]);
  const bodyMode = useDevereBeamBodyMode();
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const machines = useQuery({ queryKey: ["warp-beams", "devere-machines"], queryFn: () => warpBeamService.devereMachines(), enabled: inHouse });
  const presets = useQuery({ queryKey: ["reason-presets", "WARP_RETURN", "wind"], queryFn: () => reasonPresetService.list(false) });
  const returnReasons = useMemo(() => (presets.data ?? []).filter((p) => p.kind === "WARP_RETURN" && p.isActive), [presets.data]);
  // Devere Faz 2: çözgü ipliğinin aktif lotları (türetilen bakiyeyle) + lot zorunluluğu ayarı.
  const lotsQ = useQuery({ queryKey: ["yarn", "lots", target.warpSpec.yarnItem.id, "wind"], queryFn: () => listAllActiveYarnLots(target.warpSpec.yarnItem.id), enabled: inHouse });
  const lotRequired = useDevereLotRequired();
  const weavingLinkRequired = useDevereBeamWeavingLinkRequired();
  const lots = lotsQ.data ?? [];
  const lotsOk = (ls: YarnLineDraft[]) => !lotRequired || ls.every((l) => l.lotId !== "");
  const nominal = theoreticalKg(target.warpSpec.endsCount, target.warpSpec.yarnItem.linearDensityDen, Number(lengthM));
  const linesOk = (ls: YarnLineDraft[], needReason: boolean) => ls.every((l) => l.warehouseId && Number(l.qtyKg) > 0 && (!needReason || l.reasonCode));
  const countOk = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 24;
  const bodiesOk = windBodiesOk(bodyMode, inHouse, bodies.length, Number(count));
  const ok = bodiesOk && countOk && Number(lengthM) > 0 && (!inHouse || (machineId !== "" && issues.length > 0 && linesOk(issues, false) && linesOk(returns, true) && lotsOk(issues)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target.beamNo} — Sar</DialogTitle>
          <DialogDescription>
            {target.warpSpec.name} · {target.warpSpec.endsCount} tel · {target.warpSpec.yarnItem.name}. Doğuş gerçekleri bir kez yazılır; sonradan yalnız sarım iptaliyle geri alınır.
          </DialogDescription>
        </DialogHeader>
        <WindFields
          inHouse={inHouse}
          lengthM={lengthM}
          setLengthM={setLengthM}
          nominal={nominal}
          kgSource={kgSource}
          setKgSource={setKgSource}
          machineId={machineId}
          setMachineId={setMachineId}
          machines={machines.data?.data ?? []}
          machinesLoading={machines.isLoading}
          breakCount={breakCount}
          setBreakCount={setBreakCount}
        />
        <SetFields count={count} setCount={setCount} prefix={prefix} setPrefix={setPrefix} issueTotalKg={issues.reduce((a, l) => a + Number(l.qtyKg || 0), 0)} nominalKg={nominal} />
        {inHouse && (
          <>
            <YarnLinesEditor title={lotRequired ? "İplik çıkışı — cağlığa yüklenen BRÜT kg (en az 1 satır, lot ZORUNLU)" : "İplik çıkışı — cağlığa yüklenen BRÜT kg (en az 1 satır)"} lines={issues} onChange={setIssues} warehouses={warehouses} multiWarehouse={multiWarehouse} lots={lots} lotRequired={lotRequired} />
            <YarnLinesEditor title="Dönen bobin dipleri (ayrı satır, sebep zorunlu)" lines={returns} onChange={setReturns} warehouses={warehouses} multiWarehouse={multiWarehouse} reasons={returnReasons} lots={lots} />
          </>
        )}
        {inHouse && <DispatchBeamBodies value={bodies} onChange={setBodies} max={countOk ? Number(count) : 1} copy={windBodyCopy(bodyMode === "REQUIRED")} />}
        <WeavingOrderPicker value={weavingOrderId} onChange={setWeavingOrderId} required={weavingLinkRequired} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button
            disabled={!ok || isPending}
            onClick={() =>
              void onConfirm(buildWindPayload({ lengthM, kgSource, inHouse, machineId, issues, returns, breakCount, clientToken: attempt.token(), weavingOrderId, count, prefix, beamBodyIds: bodies.map((b) => b.id) }))
                .then(() => attempt.onSuccess(), (e: unknown) => attempt.onFailure(e))
            }
          >
            Sar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
