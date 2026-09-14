// =============================================================================
// FASON DOKUMA — "Levent sevk et": HAZIR leventlerden seç, plaka/şoför/not
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/ui/callout";
import { listWarpBeams } from "@/pages/Operations/WarpBeams/service";
import { formatM, type WarpBeam } from "@/pages/Operations/WarpBeams/types";
import type { WeavingOrder } from "../types";
import type { FasonDispatchBody } from "./service";

interface Props {
  order: WeavingOrder;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (body: FasonDispatchBody) => void;
}

/** HAZIR levent seçici; işin çözgü kartı varsa onunkiler üstte (seçim yine serbest). */
function BeamPicker({ order, selected, onToggle }: { order: WeavingOrder; selected: Set<string>; onToggle: (id: string) => void }) {
  const beams = useQuery({
    queryKey: ["warp-beams", "fason-picker"],
    queryFn: () => listWarpBeams({ limit: 100, filters: { status: "READY" } }),
  });
  const rows = useMemo(() => {
    const all: WarpBeam[] = beams.data?.data ?? [];
    const own = (b: WarpBeam) => Number(b.warpSpecId === order.warpSpecId);
    return order.warpSpecId ? [...all].sort((a, b) => own(b) - own(a)) : all;
  }, [beams.data, order.warpSpecId]);
  if (beams.isError) return <Callout tone="danger">Levent listesi alınamadı — bu bir “hazır levent yok” cevabı DEĞİLDİR (devere modülü kapalı, yetki yok ya da ağ).</Callout>;
  if (rows.length === 0 && !beams.isLoading) return <Callout tone="info">Hazır (READY) levent yok. Önce Leventler sayfasından sarım ya da hazır levent kaydı girin.</Callout>;
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto rounded border p-2 text-sm">
      {rows.map((b) => (
        <label key={b.id} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1 hover:bg-muted">
          <Checkbox checked={selected.has(b.id)} onCheckedChange={() => onToggle(b.id)} />
          <span className="font-mono">{b.beamNo}</span>
          <span className="truncate">{b.warpSpec.name}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{formatM(b.remainingM)}</span>
          {order.warpSpecId && b.warpSpecId === order.warpSpecId && <span className="text-xs text-emerald-700">işin çözgüsü</span>}
        </label>
      ))}
    </div>
  );
}

export function FasonDispatchDialog({ order, isPending, onClose, onConfirm }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [f, setF] = useState({ plate: "", driver: "", notes: "" });
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const field = (k: keyof typeof f, label: string, max: number, wide = false) => (
    <div className={wide ? "col-span-2 space-y-1" : "space-y-1"}>
      <Label htmlFor={`fd-${k}`}>{label}</Label>
      <Input id={`fd-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={max} />
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{order.weavingOrderNumber} — leventi fasona sevk et</DialogTitle>
          <DialogDescription>
            Fasoncu: <b>{order.subcontractor?.name ?? "—"}</b>. Seçilen leventler çıkış defterine yazılır (SHIP_OUT) ve fasondan dönene kadar sarılamaz. Fasoncu kendi ipliğini kullanıyorsa sevk açmanız gerekmez.
          </DialogDescription>
        </DialogHeader>
        <BeamPicker order={order} selected={selected} onToggle={toggle} />
        <div className="grid grid-cols-2 gap-3">
          {field("plate", "Plaka", 32)}
          {field("driver", "Şoför", 120)}
          {field("notes", "Not", 500, true)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button
            disabled={selected.size === 0 || isPending}
            onClick={() => onConfirm({ weavingOrderId: order.id, warpBeamIds: [...selected], plateNumber: f.plate.trim() || null, driverName: f.driver.trim() || null, notes: f.notes.trim() || null })}
          >
            {selected.size} leventi sevk et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
