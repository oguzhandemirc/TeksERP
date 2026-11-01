// Cari kilidi AÇ diyaloğu (D4-I3). Açma sebebi zorunlu; sunucunun 409 metni (ör. `releaseBySamePerson=DENY`de
// "Bu kilidi siz koydunuz…") diyalogda olduğu gibi gösterilir — istemci metin üretmez.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/api-error";
import { RELEASE_REASON_MIN, releaseCariHold, scopeLabels, type CariHoldRow } from "./cariHoldService";
import { invalidateHoldViews } from "./invalidateHoldViews";

interface Props {
  hold: CariHoldRow;
  onClose: () => void;
}

export function ReleaseHoldDialog({ hold, onClose }: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => releaseCariHold(hold.id, reason),
    onSuccess: (r) => {
      toast.success(r.message ?? "Cari kilidi açıldı.");
      invalidateHoldViews(qc);
      onClose();
    },
    onError: (e) => setError(apiErrorText(e, "Kilit açılamadı.")),
  });
  const tooShort = reason.trim().length < RELEASE_REASON_MIN;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cari kilidini aç</DialogTitle>
          <DialogDescription>
            Kilit: {scopeLabels(hold.scopes)} · {hold.reasonLabel}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <Label htmlFor="release-reason">Açma sebebi</Label>
          <Textarea id="release-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ör. Borç ödendi" />
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={tooShort || m.isPending} onClick={() => { setError(null); m.mutate(); }}>
            {m.isPending ? "Açılıyor…" : "Kilidi aç"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
