// "Portala yükledim": numara/ETTN teyidi. Portal farklı numara/ETTN verdiyse girilir
// (bizim üretimimiz değişmez; teyit ayrı kolonda tutulur).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorText } from "@/lib/api-error";
import { eIrsaliyeService } from "./service";
import type { EIrsaliyeRecord } from "./types";

export function MarkSentDialog({ record, onClose, onDone }: { record: EIrsaliyeRecord | null; onClose: () => void; onDone: () => void }) {
  const [differs, setDiffers] = useState(false);
  const [no, setNo] = useState("");
  const [ettn, setEttn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setDiffers(false);
    setNo("");
    setEttn("");
    setError(null);
  }, [record?.id]);
  if (!record) return null;

  const submit = async () => {
    setPending(true);
    try {
      await eIrsaliyeService.markSent(record.id, {
        confirmedNo: differs && no.trim() ? no.trim() : null,
        confirmedEttn: differs && ettn.trim() ? ettn.trim() : null,
      });
      toast.success("Gönderildi olarak kaydedildi.");
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
          <DialogTitle>Portala yükledim</DialogTitle>
          <DialogDescription>Gönderilen XML mühürlenir; bu kaydın kâğıt irsaliyesi artık revize edilemez.</DialogDescription>
        </DialogHeader>
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="space-y-1 rounded-md border bg-muted/30 p-2.5 font-mono text-xs">
          <div>No: {record.documentNo}</div>
          <div className="break-all">ETTN: {record.ettn}</div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={differs} onCheckedChange={(v) => setDiffers(v === true)} />
          Portal farklı numara/ETTN verdi
        </label>
        {differs && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="eirs-confirmed-no">Portal belge no</Label>
              <Input id="eirs-confirmed-no" value={no} maxLength={32} onChange={(e) => setNo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eirs-confirmed-ettn">Portal ETTN</Label>
              <Input id="eirs-confirmed-ettn" value={ettn} maxLength={36} onChange={(e) => setEttn(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Vazgeç</Button>
          <Button onClick={() => void submit()} disabled={pending}>Gönderildi olarak kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
