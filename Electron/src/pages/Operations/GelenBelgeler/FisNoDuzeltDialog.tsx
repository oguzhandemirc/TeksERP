// Onaylı belgede fiş no / fiş tarihi düzeltme (`PATCH /irsaliyeler/:id/kunye`): şablon fiş no'yu okumadıysa istasyon
// "Belgeden iş bul" fiş no ile arayamaz. Yalnız iki alan; değişmeyen alan gövdeye konmaz. Mükerrer WARN 409 kutusu
// onay diyaloğuyla aynı bileşenden ("Yine de kaydet"); BLOCK ve diğer hatalar sunucu mesajıyla satır içinde.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { apiErrorMessage } from "@/services/apiClient";
import { DuplicateDocNoConfirm, duplicateDocNoConflict } from "./DuplicateDocNo";
import { fixNoteIdentity, INCOMING_DOCUMENT_QUERY_KEY } from "./service";
import type { DeliveryNoteDetail } from "./types";
import { TERIM } from "@/lib/terim";

type NoteIdentity = Pick<DeliveryNoteDetail, "id" | "noteNo" | "senderDocNo" | "senderDocDate">;
type Body = { senderDocNo?: string | null; senderDocDate?: string | null };

/** Yalnız değişen alanlar; hiçbiri değişmediyse null (Kaydet pasif). */
export function identityFixBody(note: NoteIdentity, docNo: string, docDate: string): Body | null {
  const body: Body = {};
  const no = docNo.trim() || null;
  if (no !== (note.senderDocNo ?? null)) body.senderDocNo = no;
  const day = docDate || null;
  if (day !== (note.senderDocDate?.slice(0, 10) ?? null)) body.senderDocDate = day;
  return Object.keys(body).length ? body : null;
}

function FixForm({ note, onDone }: { note: NoteIdentity; onDone: () => void }) {
  const qc = useQueryClient();
  const [docNo, setDocNo] = useState(note.senderDocNo ?? "");
  const [docDate, setDocDate] = useState(note.senderDocDate?.slice(0, 10) ?? "");
  const body = identityFixBody(note, docNo, docDate);
  const run = useMutation({
    mutationFn: (confirm: boolean) => fixNoteIdentity(note.id, { ...body, ...(confirm ? { confirmDuplicateDocNo: true as const } : {}) }),
    onSuccess: () => {
      toast.success(`${note.noteNo}: fiş bilgisi düzeltildi.`);
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      onDone();
    },
  });
  const conflict = run.error ? duplicateDocNoConflict(run.error) : null;
  return (
    <>
      <div className="grid gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fis-no-duzelt">Fiş no</Label>
          <Input id="fis-no-duzelt" value={docNo} maxLength={64} onChange={(e) => { setDocNo(e.target.value); run.reset(); }} autoFocus />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Fiş tarihi</Label>
          <DatePickerInput value={docDate} onChange={(v) => { setDocDate(v); run.reset(); }} />
        </div>
        {conflict && <DuplicateDocNoConfirm conflict={conflict} busy={run.isPending} onConfirm={() => run.mutate(true)} confirmLabel="Yine de kaydet" />}
        {run.error && !conflict && <p role="alert" className="text-sm text-destructive" data-testid="fis-no-duzelt-error">{apiErrorMessage(run.error)}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={run.isPending}>Vazgeç</Button>
        <Button onClick={() => run.mutate(false)} disabled={!body || run.isPending || !!conflict} className="gap-1.5" data-testid="fis-no-duzelt-save">
          {run.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Kaydet
        </Button>
      </DialogFooter>
    </>
  );
}

export function FisNoDuzeltDialog({ note, open, onOpenChange }: { note: NoteIdentity; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fiş no / tarih düzelt — {note.noteNo}</DialogTitle>
          <DialogDescription>Onaylı belgede yalnız fiş no ve fiş tarihi düzeltilir; toplar ve {TERIM.terbiyeIsEmri.cogulKucuk} değişmez. İstasyon araması yeni fiş no ile bulur.</DialogDescription>
        </DialogHeader>
        {/* Her açılış güncel değerlerle başlar (kapalıyken form sökülür). */}
        {open && <FixForm note={note} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
