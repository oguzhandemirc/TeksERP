// =============================================================================
// TAK — hazır leventi tezgah yuvasına bağla (READY → MOUNTED)
// =============================================================================
// Makine listesi `GET /warp-beams/loom-machines` (istasyonu levent tüketen aktif makineler, yuva
// sayısıyla); yuva 1..warpBeamSlots. Yöntem + başlangıç saati `devere.mountTrackingRequired`
// açıkken ZORUNLU (sunucu 400 verir; panel aynı kapıyı önceden çizer). Token mantıksal deneme başına.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDevereMountTrackingRequired } from "@/hooks/usePricingEnabled";
import { warpBeamService, type LoomMachine, type MountPayload } from "../service";
import { WARP_MOUNT_METHOD_LABEL, formatM, type WarpBeam, type WarpBeamMountMethod } from "../types";
import { BeamDialogShell, NumField, num } from "./BeamDialogShell";

interface Props {
  target: WarpBeam;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (body: MountPayload) => void;
}

const NO_METHOD = "__none__";

function LoomSelect({ value, onChange, list, loading, slots }: { value: string; onChange: (v: string) => void; list: LoomMachine[]; loading: boolean; slots: number | null }) {
  return (
    <div className="space-y-1">
      <Label>Tezgah / makine</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={loading ? "Yükleniyor..." : list.length ? "Makine seç" : "Levent tüketen istasyonda makine yok"} />
        </SelectTrigger>
        <SelectContent>
          {list.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.code} · {m.name} ({m.warpBeamSlots} yuva)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {slots === 0 ? <p className="text-destructive text-xs">Bu makinenin levent yuvası yok (cağlıklı) — makine kartından yuva sayısı verin.</p> : null}
    </div>
  );
}

export function MountDialog({ target, isPending, onClose, onConfirm }: Props) {
  const [clientToken] = useState(() => crypto.randomUUID());
  const [machineId, setMachineId] = useState("");
  const [position, setPosition] = useState("1");
  const [method, setMethod] = useState<string>(NO_METHOD);
  const [setupStartedAt, setSetupStartedAt] = useState("");
  const [setupMinutes, setSetupMinutes] = useState("");
  const [counter, setCounter] = useState("");
  const required = useDevereMountTrackingRequired();
  const machines = useQuery({ queryKey: ["warp-beams", "loom-machines"], queryFn: () => warpBeamService.loomMachines() });
  const list = useMemo(() => machines.data?.data ?? [], [machines.data]);
  const machine = list.find((m) => m.id === machineId) ?? null;
  const slots = machine?.warpBeamSlots ?? 0;
  const pos = Number(position);
  const posOk = machine != null && Number.isInteger(pos) && pos >= 1 && pos <= slots;
  const reqOk = !required || (method !== NO_METHOD && setupStartedAt !== "");
  const ok = posOk && reqOk;
  const submit = () =>
    onConfirm({
      machineId,
      position: pos,
      mountMethod: method === NO_METHOD ? null : (method as WarpBeamMountMethod),
      setupStartedAt: setupStartedAt ? new Date(setupStartedAt).toISOString() : null,
      setupMinutes: setupMinutes.trim() ? Math.round(Number(setupMinutes)) : null,
      machineCounter: num(counter),
      clientToken,
    });
  return (
    <BeamDialogShell
      title={`${target.beamNo} tezgaha takılsın mı?`}
      description={`Kalan ${formatM(target.remainingM)} · ${target.warpSpec.code}. Levent seçilen makinenin yuvasına bağlanır; dolu yuva reddedilir.`}
      confirmLabel="Tak"
      ok={ok}
      isPending={isPending}
      onClose={onClose}
      onConfirm={submit}
    >
      <div className="grid grid-cols-2 gap-3">
        <LoomSelect value={machineId} onChange={(v) => { setMachineId(v); setPosition("1"); }} list={list} loading={machines.isLoading} slots={machine ? slots : null} />
        <NumField id="wb-mount-pos" label={`Yuva (1..${slots || "?"})`} value={position} onChange={setPosition} min={1} step="1" />
        <div className="space-y-1">
          <Label>Bağlama yöntemi{required ? " *" : ""}</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_METHOD}>Belirtilmedi</SelectItem>
              {(Object.keys(WARP_MOUNT_METHOD_LABEL) as WarpBeamMountMethod[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {WARP_MOUNT_METHOD_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="wb-mount-start">Kurulum başlangıcı{required ? " *" : ""}</Label>
          <Input id="wb-mount-start" type="datetime-local" value={setupStartedAt} onChange={(e) => setSetupStartedAt(e.target.value)} />
        </div>
        <NumField id="wb-mount-min" label="Kurulum süresi (dk, beyan)" value={setupMinutes} onChange={setSetupMinutes} step="1" />
        <NumField id="wb-mount-counter" label="Tezgah sayacı (m)" value={counter} onChange={setCounter} hint="Bağlama anındaki çözgü sayacı — sökümde farkı okumak için." />
      </div>
      {required ? <p className="text-muted-foreground text-xs">Ayar: bağlamada yöntem ve başlangıç saati zorunlu.</p> : null}
    </BeamDialogShell>
  );
}
