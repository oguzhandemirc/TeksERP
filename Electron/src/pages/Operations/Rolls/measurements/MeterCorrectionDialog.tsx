// Tambur kesim metresi düzeltme diyaloğu (D4-B4; uç D4-B2). Token MANTIKSAL DENEME başına (kk1.md): yalnız belirsiz
// hatada (ağ · zaman aşımı · 5xx) yapışır; 409/400'de ve başarıda düşer. 409 metni diyalogda kalır, liste tazelenir.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAttemptToken } from "@/lib/attemptToken";
import { correctCutReading, correctionErrorText } from "./correctionService";
import { measureSourceLabel, type RollMeterReadingView } from "./measure-source";

interface Props {
  reading: RollMeterReadingView;
  onClose: () => void;
  /** Başarıda ve 409'da (durum değişti) liste tazelenir. */
  onChanged: () => void;
}

export function MeterCorrectionDialog({ reading, onClose, onChanged }: Props) {
  const [meters, setMeters] = useState(String(reading.meters).replace(".", ","));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const attempt = useAttemptToken();
  const parsed = Number(meters.replace(",", "."));
  // Değer değişirse yeni mantıksal deneme (aynı token başka metreyle 409 CLIENT_TOKEN_COLLISION olurdu).
  const edit = (set: (v: string) => void, v: string) => {
    attempt.renew();
    set(v);
  };
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed < 1e6 && reason.trim().length >= 3;

  const save = useMutation({
    mutationFn: () => correctCutReading(reading.id, { meters: parsed, reason: reason.trim(), clientToken: attempt.token() }),
    onSuccess: () => {
      attempt.onSuccess();
      toast.success("Kesim metresi düzeltildi");
      onChanged();
      onClose();
    },
    onError: (e) => {
      attempt.onFailure(e);
      setError(correctionErrorText(e));
      onChanged();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kesim metresini düzelt</DialogTitle>
          <DialogDescription>
            Kayıtlı: {reading.meters.toLocaleString("tr-TR")} m ({measureSourceLabel(reading.source)}). Eski okuma silinmez, düzeltildi olarak
            işaretlenir; faturaya yeni (Süpervizör) metre girer. Topun stok metresi değişmez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cut-correct-meters">Doğru metre</Label>
            <Input id="cut-correct-meters" inputMode="decimal" value={meters} onChange={(e) => edit(setMeters, e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cut-correct-reason">Sebep</Label>
            <Textarea
              id="cut-correct-reason"
              value={reason}
              maxLength={250}
              onChange={(e) => edit(setReason, e.target.value)}
              placeholder="Ör. sayaç simülasyondaydı, şerit metreyle ölçüldü"
            />
          </div>
          {error && (
            <Callout tone="danger" title="Düzeltme kaydedilmedi">
              <span data-testid="cut-correct-error">{error}</span>
            </Callout>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Vazgeç
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Düzelt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
