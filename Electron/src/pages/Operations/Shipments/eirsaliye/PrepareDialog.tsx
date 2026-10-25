// e-İrsaliye hazırla (TASLAK doğar) ya da taşıma/alıcı alanlarını düzelt. `clientToken`
// MANTIKSAL deneme başına doğar; yalnız belirsiz hatada (ağ/5xx) yapışır (kk1.md).
// Hazırlıkta boş bırakılan alan sunucuda önerilir (sevkiyat + aynı plakanın son kaydı).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { EIrsaliyeFieldsForm, emptyFields, fieldsFromRecord, payloadOf, type FieldDraft } from "./EIrsaliyeFieldsForm";
import { eIrsaliyeService } from "./service";
import type { EIrsaliyeRecord } from "./types";

export interface PrepareDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  shipmentId: string;
  /** Verilirse düzenleme kipi (PATCH); yoksa hazırlık (POST). */
  record: EIrsaliyeRecord | null;
  onDone: () => void;
}

export function PrepareDialog({ open, onOpenChange, shipmentId, record, onDone }: PrepareDialogProps) {
  const attempt = useAttemptToken();
  const [draft, setDraft] = useState<FieldDraft>(emptyFields);
  const [error, setError] = useState<{ text: string; field: string | null } | null>(null);
  const [pending, setPending] = useState(false);
  const editing = record !== null;

  useEffect(() => {
    if (!open) return;
    attempt.renew();
    setDraft(record ? fieldsFromRecord(record) : emptyFields);
    setError(null);
  }, [open, record, attempt]);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      if (record) await eIrsaliyeService.updateFields(record.id, payloadOf(draft, true));
      else await eIrsaliyeService.prepare(shipmentId, payloadOf(draft, false), attempt.token());
      attempt.onSuccess();
      toast.success(editing ? "Taşıma bilgileri kaydedildi." : "e-İrsaliye hazırlandı (taslak).");
      onDone();
      onOpenChange(false);
    } catch (e) {
      attempt.onFailure(e);
      setError({ text: apiErrorText(e, "Kaydedilemedi."), field: fieldOf(e) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(42rem,calc(100vw-2rem))] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Taşıma bilgileri" : "e-İrsaliye hazırla"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Yalnız GİB'e gönderilmemiş kayıtta düzeltilir. Değişiklikten sonra XML'i yeniden üretin."
              : "Boş bıraktığınız alanlar sevkiyattan ve aynı plakanın son kaydından önerilir; sonra düzeltebilirsiniz."}
          </DialogDescription>
        </DialogHeader>
        {error && <Callout tone="danger">{error.text}</Callout>}
        <EIrsaliyeFieldsForm draft={draft} onChange={setDraft} invalidField={error?.field ?? null} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={pending}>
            {editing ? "Kaydet" : "Hazırla"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fieldOf(e: unknown): string | null {
  const alan = (e as { response?: { data?: { details?: { alan?: unknown } } } })?.response?.data?.details?.alan;
  return typeof alan === "string" ? alan : null;
}
