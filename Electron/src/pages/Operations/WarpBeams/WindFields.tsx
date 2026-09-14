import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DevereMachine } from "./service";
import { WARP_KG_SOURCE_LABEL, formatKg, type WarpKgSource } from "./types";

interface Props {
  inHouse: boolean;
  lengthM: string;
  setLengthM: (v: string) => void;
  nominal: number | null;
  kgSource: WarpKgSource;
  setKgSource: (v: WarpKgSource) => void;
  machineId: string;
  setMachineId: (v: string) => void;
  machines: DevereMachine[];
  machinesLoading: boolean;
  breakCount: string;
  setBreakCount: (v: string) => void;
}

/** Sarım üst alanları: metre · kg kaynağı · (içeride) devere makinesi + kopuş. */
export function WindFields(p: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor="wb-length">Sarılan metre</Label>
        <Input id="wb-length" type="number" min={1} step="0.001" value={p.lengthM} onChange={(e) => p.setLengthM(e.target.value)} />
        <p className="text-muted-foreground text-xs">Nominal: {p.nominal == null ? "denye boş — hesaplanamaz" : formatKg(p.nominal)}</p>
      </div>
      <div className="space-y-1">
        <Label>Kg nasıl bilindi</Label>
        <Select value={p.kgSource} onValueChange={(v) => p.setKgSource(v as WarpKgSource)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(WARP_KG_SOURCE_LABEL) as WarpKgSource[]).map((k) => (
              <SelectItem key={k} value={k}>
                {WARP_KG_SOURCE_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {p.inHouse && (
        <>
          <div className="space-y-1">
            <Label>Devere makinesi</Label>
            <Select value={p.machineId} onValueChange={p.setMachineId}>
              <SelectTrigger>
                <SelectValue placeholder={p.machinesLoading ? "Yükleniyor..." : "Makine seç"} />
              </SelectTrigger>
              <SelectContent>
                {p.machines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wb-breaks">Devere kopuşu (adet)</Label>
            <Input id="wb-breaks" type="number" min={0} value={p.breakCount} onChange={(e) => p.setBreakCount(e.target.value)} />
          </div>
        </>
      )}
    </div>
  );
}
