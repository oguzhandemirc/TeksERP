import { useEffect, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTabsStore } from "@/store/tabs";
import { AnnotateDialog } from "./annotate/AnnotateDialog";
import { AttachmentField, filesFromClipboard } from "./AttachmentField";
import { useDestekStore } from "./destek-store";
import { DISCLOSURE } from "./labels";
import { TicketTypePicker } from "./TicketTypePicker";
import { useAttachmentDrafts } from "./useAttachmentDrafts";
import { useCreateTicket, validateTicketForm, type TicketFormErrors, type TicketFormValues } from "./useCreateTicket";
import { useScreenshotActions } from "./useScreenshotActions";
import type { TicketView } from "./types";

const EMPTY: TicketFormValues = { type: "BUG", subject: "", message: "" };

function announceCreated(t: TicketView) {
  toast.success(`Talebiniz alındı · ${t.number}`, {
    description: "Yanıt geldiğinde Destek düğmesinde işaret göreceksiniz.",
    action: { label: "Görüntüle", onClick: () => useTabsStore.getState().openTab(`/destek?talep=${t.id}`) },
  });
}

/** "Sorun bildir" formu — kabukta tek örnek; açılışı `useDestekStore.openReport` tetikler. */
export function ReportIssueDialog() {
  const report = useDestekStore((s) => s.report);
  const closeReport = useDestekStore((s) => s.closeReport);
  const [values, setValues] = useState<TicketFormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<TicketFormErrors>({});
  const drafts = useAttachmentDrafts();
  const shots = useScreenshotActions(drafts);
  const { submit, isPending, error } = useCreateTicket(report.open, (t) => {
    closeReport();
    announceCreated(t);
  });

  // Her açılış yeni bir form: alanlar boş, açılış anındaki ekran görüntüsü ilk ek.
  const { reset } = drafts;
  useEffect(() => {
    if (!report.open) return;
    setValues(EMPTY);
    setFieldErrors({});
    reset(report.screenshot);
  }, [report.open, report.nonce, report.screenshot, reset]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    const errs = validateTicketForm(values);
    setFieldErrors(errs);
    if (Object.keys(errs).length === 0) submit({ values, files: drafts.items });
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    void drafts.addFiles(files);
  };

  const set = <K extends keyof TicketFormValues>(k: K, v: TicketFormValues[K]) => setValues((cur) => ({ ...cur, [k]: v }));

  return (
    <>
      <Dialog open={report.open && !shots.capturing} onOpenChange={(o) => !o && !isPending && closeReport()}>
        <DialogContent className="max-w-2xl" onPaste={onPaste}>
          <DialogHeader>
            <DialogTitle>Sorun bildir</DialogTitle>
            <DialogDescription>Ekran adı, panel sürümü ve sistem bilgisi talebe otomatik eklenir.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <TicketTypePicker value={values.type} onChange={(t) => set("type", t)} disabled={isPending} />
            <FormRow id="destek-konu" label="Konu" error={fieldErrors.subject}>
              <Input id="destek-konu" value={values.subject} maxLength={200} disabled={isPending} placeholder="Kısaca ne oldu?" onChange={(e) => set("subject", e.target.value)} />
            </FormRow>
            <FormRow id="destek-mesaj" label="Mesaj" error={fieldErrors.message}>
              <Textarea id="destek-mesaj" rows={5} value={values.message} disabled={isPending} placeholder="Ne yapıyordunuz, ne bekliyordunuz, ne oldu?" onChange={(e) => set("message", e.target.value)} />
            </FormRow>
            <AttachmentField drafts={drafts} onEdit={shots.startEdit} onCapture={shots.capture} disabled={isPending} />
            {error && <Callout tone="danger">{error.message}</Callout>}
            <DialogFooter className="items-center sm:justify-between">
              <p className="text-[11px] text-muted-foreground">{DISCLOSURE}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={isPending} onClick={closeReport}>Vazgeç</Button>
                <Button type="submit" disabled={isPending}>{isPending ? "Gönderiliyor…" : error ? "Tekrar dene" : "Gönder"}</Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AnnotateDialog source={shots.editSource} onClose={shots.cancelEdit} onSave={shots.saveEdit} />
    </>
  );
}

function FormRow({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
