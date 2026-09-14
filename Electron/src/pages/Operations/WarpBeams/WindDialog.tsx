// =============================================================================
// SAR (WOUND) — PLANNED → READY: metre · kg kaynağı · (içeride) devere makinesi + brüt iplik + dip iadesi
// =============================================================================
// Nominal kg formülü sunucunun aynası (ön hesap); sunucu yeniden hesaplar ve olay satırına yazar.
// Fason/hazır alım kökeninde iplik satırı YOK (iplik tüketimi bizim defterde değil, §3.9).
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { useDevereLotRequired } from "@/hooks/usePricingEnabled";
import { listYarnLots } from "@/pages/Operations/Yarn/service";
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
  onConfirm: (body: WindPayload) => void;
}

function toLines(lines: YarnLineDraft[], withReason: boolean) {
  return lines.map((l) => ({ warehouseId: l.warehouseId, qtyKg: Number(l.qtyKg), lotId: l.lotId || null, ...(withReason ? { reasonCode: l.reasonCode } : {}) }));
}

export function WindDialog({ target, isPending, onClose, onConfirm }: Props) {
  const [clientToken] = useState(() => crypto.randomUUID());
  const inHouse = target.originKind === "IN_HOUSE";
  const [lengthM, setLengthM] = useState(String(target.plannedLengthM));
  const [kgSource, setKgSource] = useState<WarpKgSource>(inHouse ? "WEIGHED" : "THEORETICAL");
  const [machineId, setMachineId] = useState("");
  const [breakCount, setBreakCount] = useState("");
  const [issues, setIssues] = useState<YarnLineDraft[]>([]);
  const [returns, setReturns] = useState<YarnLineDraft[]>([]);
  const [count, setCount] = useState("1");
  const [prefix, setPrefix] = useState("");
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const machines = useQuery({ queryKey: ["warp-beams", "devere-machines"], queryFn: () => warpBeamService.devereMachines(), enabled: inHouse });
  const presets = useQuery({ queryKey: ["reason-presets", "WARP_RETURN", "wind"], queryFn: () => reasonPresetService.list(false) });
  const returnReasons = useMemo(() => (presets.data ?? []).filter((p) => p.kind === "WARP_RETURN" && p.isActive), [presets.data]);
  // Devere Faz 2: çözgü ipliğinin aktif lotları (türetilen bakiyeyle) + lot zorunluluğu ayarı.
  const lotsQ = useQuery({ queryKey: ["yarn", "lots", target.warpSpec.yarnItem.id, "wind"], queryFn: () => listYarnLots({ itemId: target.warpSpec.yarnItem.id, isActive: true, limit: 200 }), enabled: inHouse });
  const lotRequired = useDevereLotRequired();
  const lots = lotsQ.data?.data ?? [];
  const lotsOk = (ls: YarnLineDraft[]) => !lotRequired || ls.every((l) => l.lotId !== "");
  const nominal = theoreticalKg(target.warpSpec.endsCount, target.warpSpec.yarnItem.linearDensityDen, Number(lengthM));
  const linesOk = (ls: YarnLineDraft[], needReason: boolean) => ls.every((l) => l.warehouseId && Number(l.qtyKg) > 0 && (!needReason || l.reasonCode));
  const countOk = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 24;
  const ok = countOk && Number(lengthM) > 0 && (!inHouse || (machineId !== "" && issues.length > 0 && linesOk(issues, false) && linesOk(returns, true) && lotsOk(issues)));

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
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button
            disabled={!ok || isPending}
            onClick={() =>
              onConfirm({
                lengthM: Number(lengthM),
                kgSource,
                machineId: inHouse ? machineId : null,
                ...(inHouse ? { yarnIssues: toLines(issues, false), yarnReturns: toLines(returns, true) as WindPayload["yarnReturns"] } : {}),
                breakCount: breakCount === "" ? null : Number(breakCount),
                clientToken,
                // Raşel takımı: adet 1 → alanlar GİDMEZ (bugünkü istek bayt bayt).
                ...(Number(count) > 1 ? { count: Number(count), physicalBeamNoPrefix: prefix.trim() || null } : {}),
              })
            }
          >
            Sar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
