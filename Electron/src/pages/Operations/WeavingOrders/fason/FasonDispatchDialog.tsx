// =============================================================================
// FASON DOKUMA — "Sevk et": HAZIR leventlerden seç (+ G1 iplik satırları), plaka/şoför/not
// =============================================================================
// İplik satırları yalnız iplik modülü ETKİN iken çizilir ve gövdeye girer; levent-yalnız,
// iplik-yalnız ya da ikisi birden meşru (backend `WEAVING_DISPATCH_EMPTY` ikisi de boşken).
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
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import type { WeavingOrder } from "../types";
import type { FasonDispatchBody } from "./service";
import { yarnLineToPayload, type YarnLineDraft } from "./fason-summary";
import { FasonYarnLines } from "./FasonYarnLines";

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
  const { iplikEnabled } = useOperationsVisibilityContext();
  const [yarnLines, setYarnLines] = useState<YarnLineDraft[]>([]);
  // Geçersiz satır (kalem/depo/kg eksik) gövdeye GİRMEZ ve butonu kilitler — sessiz düşme yok.
  const yarnPayload = yarnLines.map(yarnLineToPayload);
  const yarnOk = yarnLines.length === 0 || yarnPayload.every((l) => l !== null);
  const yarnCount = yarnPayload.filter((l) => l !== null).length;
  const canConfirm = (selected.size > 0 || yarnCount > 0) && yarnOk && !isPending;
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
          <DialogTitle>{order.weavingOrderNumber} — fasona sevk et</DialogTitle>
          <DialogDescription>
            Fasoncu: <b>{order.subcontractor?.name ?? "—"}</b>. Seçilen leventler çıkış defterine yazılır (SHIP_OUT) ve fasondan dönene kadar sarılamaz.
            {iplikEnabled ? " İplik satırları iplik defterine brüt çıkış yazar; fasoncudaki bakiye türetilir, dönüş ayrı satırla kapanır." : " Fasoncu kendi ipliğini kullanıyorsa sevk açmanız gerekmez."}
          </DialogDescription>
        </DialogHeader>
        <BeamPicker order={order} selected={selected} onToggle={toggle} />
        {iplikEnabled && <FasonYarnLines lines={yarnLines} onChange={setYarnLines} />}
        <div className="grid grid-cols-2 gap-3">
          {field("plate", "Plaka", 32)}
          {field("driver", "Şoför", 120)}
          {field("notes", "Not", 500, true)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button
            disabled={!canConfirm}
            onClick={() =>
              onConfirm({
                weavingOrderId: order.id,
                warpBeamIds: [...selected],
                ...(iplikEnabled && yarnCount > 0 ? { yarnLines: yarnPayload.filter((l) => l !== null) } : {}),
                plateNumber: f.plate.trim() || null,
                driverName: f.driver.trim() || null,
                notes: f.notes.trim() || null,
              })
            }
          >
            Sevk et ({selected.size} levent{yarnCount > 0 ? ` · ${yarnCount} iplik satırı` : ""})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
