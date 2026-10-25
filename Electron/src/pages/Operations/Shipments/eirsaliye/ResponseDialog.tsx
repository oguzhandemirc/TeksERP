// Müşteri yanıtını elle kaydet (dışa aktar yöntemi): KABUL / KISMI_KABUL / REDDEDILDI / HATA + not.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { eIrsaliyeService } from "./service";
import type { EIrsaliyeRecord, EIrsaliyeResponseStatus } from "./types";

const OPTIONS: ReadonlyArray<{ value: EIrsaliyeResponseStatus; label: string; hint: string }> = [
  { value: "KABUL", label: "Kabul", hint: "Müşteri irsaliyeyi kabul etti." },
  { value: "KISMI_KABUL", label: "Kısmi kabul", hint: "Müşteri bir kısmını kabul etti — notta açıklayın." },
  { value: "REDDEDILDI", label: "Reddedildi", hint: "Yerine yeni e-İrsaliye hazırlanır (yeni numara)." },
  { value: "HATA", label: "Hata", hint: "Portal/entegratör hata verdi — düzeltip yeniden üretin." },
];

export function ResponseDialog({ record, onClose, onDone }: { record: EIrsaliyeRecord | null; onClose: () => void; onDone: () => void }) {
  const [durum, setDurum] = useState<EIrsaliyeResponseStatus | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setDurum(null);
    setNote("");
    setError(null);
  }, [record?.id]);
  if (!record) return null;

  const submit = async () => {
    if (!durum) return;
    setPending(true);
    try {
      await eIrsaliyeService.recordResponse(record.id, { durum, not: note.trim() || null });
      toast.success("Müşteri yanıtı kaydedildi.");
      onDone();
      onClose();
    } catch (e) {
      setError(apiErrorText(e, "Kaydedilemedi."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(32rem,calc(100vw-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle>Müşteri yanıtını kaydet</DialogTitle>
          <DialogDescription>e-İrsaliye no {record.documentNo}</DialogDescription>
        </DialogHeader>
        {error && <Callout tone="danger">{error}</Callout>}
        <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={durum === o.value}
              onClick={() => setDurum(o.value)}
              className={cn(
                "rounded-md border p-2.5 text-left text-sm transition-colors hover:bg-accent",
                durum === o.value && "border-primary bg-primary/5 ring-1 ring-primary",
              )}
            >
              <div className="font-medium">{o.label}</div>
              <div className="text-xs text-muted-foreground">{o.hint}</div>
            </button>
          ))}
        </div>
        <Textarea value={note} maxLength={1000} rows={3} placeholder="Not (opsiyonel)" onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Vazgeç</Button>
          <Button onClick={() => void submit()} disabled={pending || !durum}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
