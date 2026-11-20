// =============================================================================
// GERİ ALMA DİYALOGLARI — son hareketi geri al · kaydı iptal et (ikisi de önizlemeli, sebep zorunlu)
// =============================================================================
// Geri alma ileri kaydı silmez: sunucu `<TÜR>_CANCEL` ters olayını yazar (defter). Önizleme engeli (belgeli olay,
// son hareket değil, kayıttan sonra hareket var) sunucunun cümlesiyle gösterilir; onay düğmesi kapanır.
// =============================================================================
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Textarea } from "@/components/ui/textarea";
import { toastServerSuccess } from "@/lib/serverNotes";
import { apiErrorMessage } from "@/services/apiClient";
import { BEAM_BODIES_QUERY_KEY, beamBodyService } from "./service";
import { eventTimeText } from "./model";
import type { BeamBody, BeamBodyEvent } from "./types";

interface ShellProps {
  title: string;
  description: string;
  loading: boolean;
  error: unknown;
  allowed: boolean;
  blocker: string | null;
  summary: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

function ReasonPreviewDialog(p: ShellProps) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          <DialogDescription>{p.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {p.loading && <p className="text-sm text-muted-foreground">Önizleme hazırlanıyor…</p>}
          {p.error != null && <Callout tone="danger">{apiErrorMessage(p.error)}</Callout>}
          {!p.loading && p.error == null && p.summary}
          {p.blocker && <Callout tone="warning">{p.blocker}</Callout>}
          {p.allowed && (
            <FormField label="Sebep" required htmlFor="bb-undo-reason">
              <Textarea id="bb-undo-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="En az 3 karakter" />
            </FormField>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={p.onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!p.allowed || !ok || p.pending} onClick={() => p.onConfirm(reason.trim())}>
            {p.pending ? "İşleniyor…" : p.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useDone(onClose: () => void, fallback: string) {
  const qc = useQueryClient();
  return (res: { message?: string }) => {
    toastServerSuccess(res, fallback);
    void qc.invalidateQueries({ queryKey: [BEAM_BODIES_QUERY_KEY] });
    onClose();
  };
}

export function UndoEventDialog({ body, event, onClose }: { body: BeamBody; event: BeamBodyEvent; onClose: () => void }) {
  const pv = useQuery({ queryKey: [BEAM_BODIES_QUERY_KEY, "undo-preview", body.id, event.id], queryFn: () => beamBodyService.undoPreview(body.id, event.id), retry: false, staleTime: 0 });
  const done = useDone(onClose, `${body.bodyNo}: hareket geri alındı.`);
  const m = useMutation({ mutationFn: (reason: string) => beamBodyService.undo(body.id, event.id, reason), onSuccess: done });
  const d = pv.data;
  return (
    <ReasonPreviewDialog
      title={`${body.bodyNo} — son hareketi geri al`}
      description="Hareket silinmez; geçmişe ters kayıt yazılır ve gövde önceki durumuna döner."
      loading={pv.isLoading}
      error={pv.error}
      allowed={Boolean(d?.undoable)}
      blocker={d?.blocker ?? null}
      summary={
        d && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div className="font-medium">{d.event.label}</div>
            <div className="text-xs text-muted-foreground">{eventTimeText(d.event.createdAt)}</div>
            {d.restoresTo && <div className="mt-1">Gövde “{d.restoresTo.label}” durumuna döner.</div>}
          </div>
        )
      }
      confirmLabel="Geri al"
      pending={m.isPending}
      onConfirm={(r) => m.mutate(r)}
      onClose={onClose}
    />
  );
}

export function CancelRegistrationDialog({ body, onClose }: { body: BeamBody; onClose: () => void }) {
  const pv = useQuery({ queryKey: [BEAM_BODIES_QUERY_KEY, "cancel-reg-preview", body.id], queryFn: () => beamBodyService.cancelRegistrationPreview(body.id), retry: false, staleTime: 0 });
  const done = useDone(onClose, `${body.bodyNo} kaydı iptal edildi.`);
  const m = useMutation({ mutationFn: (reason: string) => beamBodyService.cancelRegistration(body.id, reason), onSuccess: done });
  const d = pv.data;
  return (
    <ReasonPreviewDialog
      title={`${body.bodyNo} — kaydı iptal et`}
      description="Yanlış açılmış kart içindir: kayıt silinmez, iptal kaydı yazılır ve kart pasife alınır. Yalnız kayıttan sonra hiç hareket yokken yapılır."
      loading={pv.isLoading}
      error={pv.error}
      allowed={Boolean(d?.cancellable)}
      blocker={d?.blocker ?? null}
      summary={d && <p className="text-sm">Kayıttan sonraki hareket sayısı: <b>{d.laterEventCount}</b></p>}
      confirmLabel="Kaydı iptal et"
      pending={m.isPending}
      onConfirm={(r) => m.mutate(r)}
      onClose={onClose}
    />
  );
}
