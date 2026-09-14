// =============================================================================
// FASON DOKUMA — levent DÖNÜŞÜ (F1 ucu): sevkteki bir levent kaç metreyle döndü
// =============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FasonDispatch } from "./types";

interface Props {
  target: FasonDispatch;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (body: { dispatchId: string; warpBeamId: string; lengthM: number; clientToken: string }) => void;
}

/** Sevkteki, henüz dönmemiş leventler (RETURNED_IN olayı olmayan kalemler). */
function openBeams(d: FasonDispatch) {
  return d.items.filter((it) => it.warpBeam && !it.events.some((e) => e.kind === "RETURNED_IN")).map((it) => it.warpBeam!);
}

export function FasonBeamReturnDialog({ target, isPending, onClose, onConfirm }: Props) {
  const beams = openBeams(target);
  const [beamId, setBeamId] = useState(beams[0]?.id ?? "");
  const [lengthM, setLengthM] = useState("");
  const [clientToken] = useState(() => crypto.randomUUID());
  const n = Number(lengthM);
  const ok = Boolean(beamId) && lengthM.trim() !== "" && Number.isFinite(n) && n >= 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sevk {target.dispatchNo} — levent döndü</DialogTitle>
          <DialogDescription>Dönen metre gideni aşamaz; fark fasoncuda kalan/çekilen çözgüdür. Levent HAZIR'a döner ve yeniden sarılabilir/sevk edilebilir.</DialogDescription>
        </DialogHeader>
        {beams.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu sevkte dönmemiş levent yok.</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Levent</Label>
              <Select value={beamId} onValueChange={setBeamId}>
                <SelectTrigger><SelectValue placeholder="Levent seç" /></SelectTrigger>
                <SelectContent>
                  {beams.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.beamNo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fbr-len">Dönen metre</Label>
              <Input id="fbr-len" type="number" min={0} step="0.01" value={lengthM} onChange={(e) => setLengthM(e.target.value)} autoFocus />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button disabled={!ok || isPending} onClick={() => onConfirm({ dispatchId: target.id, warpBeamId: beamId, lengthM: n, clientToken })}>Dönüşü kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
