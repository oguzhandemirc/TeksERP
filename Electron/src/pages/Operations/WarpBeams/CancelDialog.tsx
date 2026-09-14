// =============================================================================
// SARIMI İPTAL ET — önizlemeli yıkıcı işlem: dönecek iplik satırları ADIYLA, gerekçe zorunlu
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { warpBeamService } from "./service";
import { formatKg, formatM, type WarpBeam } from "./types";

interface Props {
  target: WarpBeam;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export function CancelDialog({ target, isPending, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  const preview = useQuery({ queryKey: ["warp-beams", "cancel-preview", target.id], queryFn: () => warpBeamService.cancelPreview(target.id) });
  const p = preview.data?.data;
  const ok = reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{target.beamNo} sarımı iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            Doğuşun stornosu: levent İPTAL olur (yeniden sarılmaz, yeni levent açılır); çıkan iplik depoya NET döner, dip iadeleri düşer. Defter satırı silinmez, ters kayıt yazılır.
          </DialogDescription>
        </DialogHeader>
        {preview.isError ? (
          <p className="text-destructive text-sm">Önizleme alınamadı — bu bir “etkisi yok” cevabı DEĞİLDİR.</p>
        ) : p ? (
          <ul className="space-y-1 text-sm">
            <li>Sarım: {formatM(p.wound?.lengthM)} · nominal {formatKg(p.wound?.theoreticalKg)}</li>
            {/* Devere Faz 2: satır anahtarı depo × LOT — aynı depoda iki lot iki satırdır, çakışmaz. */}
            {p.issueReversals.map((r) => (
              <li key={`i-${r.warehouse.id}-${r.lot?.id ?? ""}`}>↩ {r.warehouse.name}{r.lot ? ` · lot ${r.lot.lotNo}` : ""}: {formatKg(r.qtyKg)} depoya döner (çıkış tersi)</li>
            ))}
            {p.returnReversals.map((r) => (
              <li key={`r-${r.warehouse.id}-${r.reasonCode}-${r.lot?.id ?? ""}`}>↩ {r.warehouse.name}{r.lot ? ` · lot ${r.lot.lotNo}` : ""}: {formatKg(r.qtyKg)} dip iadesi düşer ({r.reasonCode})</li>
            ))}
            {p.issueReversals.length === 0 && p.returnReversals.length === 0 && <li className="text-muted-foreground">İplik satırı yok (fason/hazır alım kökeni) — yalnız levent iptal olur.</li>}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Önizleme yükleniyor…</p>
        )}
        <div className="space-y-1">
          <Label htmlFor="wb-cancel-reason">Gerekçe</Label>
          <Textarea id="wb-cancel-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={!ok || isPending || !p} onClick={() => onConfirm(reason.trim())}>
            Sarımı İptal Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
