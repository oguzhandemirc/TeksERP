// =============================================================================
// SEBEP ATA / YENİDEN SINIFLANDIR — kayıp sınıfı sebepten gelir; reclass DEFTERE yazılır
// =============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ReasonPreset } from "@/pages/ReasonPresets/service";
import type { MachineStop } from "./types";

interface Props {
  target: MachineStop;
  mode: "classify" | "reclassify";
  presets: ReasonPreset[];
  labelOf: (code: string | null) => string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reasonCode: string, note: string | null) => void;
}

export function StopReasonDialog({ target, mode, presets, labelOf, isPending, onClose, onConfirm }: Props) {
  const [code, setCode] = useState<string>("");
  const [note, setNote] = useState("");
  const reclass = mode === "reclassify";
  const ok = code !== "" && (!reclass || code !== target.reasonCode);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{reclass ? "Yeniden sınıflandır" : "Sebep ata"} — {target.machine.name}</DialogTitle>
          <DialogDescription>
            {reclass
              ? `Mevcut karar: ${labelOf(target.reasonCode)}. Değişim deftere yazılır (kim · ne zaman · neden); geri alma karşı kayıttır.`
              : "Kayıp sınıfı seçilen sebepten kopyalanır ve donar. Sonradan yalnız yeniden sınıflandırma ile değişir."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Sebep</Label>
            <Select value={code} onValueChange={setCode}>
              <SelectTrigger>
                <SelectValue placeholder="Sebep seç..." />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.code} value={p.code} disabled={reclass && p.code === target.reasonCode}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="stop-reason-note">{reclass ? "Değişiklik gerekçesi" : "Not"} (isteğe bağlı)</Label>
            <Textarea id="stop-reason-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button disabled={!ok || isPending} onClick={() => onConfirm(code, note.trim() || null)}>
            {reclass ? "Yeniden Sınıflandır" : "Sebebi Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
