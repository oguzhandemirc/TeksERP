// Kâğıttan muayene — saha kâğıdındaki 4 puan formunu panele geçirir. Top seçici DOĞRUDAN modal.
// clientToken deneme başına: belirsiz hatada (ağ/5xx) aynı token yapışır, kesin 4xx'te yenilenir.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RollPickerDialog } from "@/components/operations/roll-picker/RollPickerDialog";
import type { PickedRoll } from "@/components/operations/roll-picker/pickable-rolls";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { inspectionService, type InspectionPhase } from "./service";
import { PHASE_LABEL, errorCodeOf } from "./inspectionRules";
import { MeasureForm, measurePayload, type MeasureState } from "./MeasureForm";

const ROLL_SCOPES = [{ key: "all", label: "Tüm toplar", filters: {} }];

interface Props { onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }

function activeIdOf(e: unknown): string | null {
  if (!axios.isAxiosError(e)) return null;
  const id = (e.response?.data as { details?: { inspectionId?: unknown } } | undefined)?.details?.inspectionId;
  return typeof id === "string" ? id : null;
}

export function PaperInspectionDialog({ onOpenChange, onCreated }: Props) {
  const attempt = useAttemptToken();
  const [pickerOpen, setPickerOpen] = useState(true);
  const [roll, setRoll] = useState<PickedRoll | null>(null);
  const [phase, setPhase] = useState<InspectionPhase | null>(null);
  const [m, setM] = useState<MeasureState>({ rows: [], length: "", width: "" });
  const [note, setNote] = useState("");
  const [err, setErr] = useState<{ text: string; activeId: string | null } | null>(null);
  const payload = measurePayload(m);
  const save = useMutation({
    mutationFn: () => inspectionService.create({ ...payload!, rollId: roll!.id, phase, note: note.trim() || null, clientToken: attempt.token() }),
    onSuccess: (r) => { attempt.onSuccess(); toast.success("Muayene kaydedildi."); onCreated(r.id); },
    onError: (e) => {
      attempt.onFailure(e);
      setErr({ text: apiErrorText(e, "Muayene kaydedilemedi."), activeId: errorCodeOf(e) === "INSPECTION_ALREADY_ACTIVE" ? activeIdOf(e) : null });
    },
  });
  const canSave = !!roll && !!phase && payload !== null && !save.isPending;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Kâğıttan muayene</DialogTitle>
          <DialogDescription>Kâğıt formdaki hataları girin; puan ve derece önerisi sunucuda hesaplanır.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setPickerOpen(true)}>{roll ? <span className="font-mono">{roll.barcode ?? "—"}</span> : "Top seç"}</Button>
          {roll && <span className="text-sm text-muted-foreground">{roll.itemName}{roll.colorName ? ` · ${roll.colorName}` : ""} · {roll.qty} m</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Aşama">
          <span className="mr-2 text-sm">Aşama</span>
          {(["RAW", "FINAL"] as const).map((p) => (
            <Button key={p} type="button" size="sm" variant={phase === p ? "default" : "outline"} aria-pressed={phase === p} onClick={() => { setPhase(p); attempt.renew(); setErr(null); }}>{PHASE_LABEL[p]}</Button>
          ))}
        </div>
        <MeasureForm rollId={roll?.id ?? null} m={m} onChange={(x) => { setM(x); setErr(null); }} />
        <div className="space-y-1">
          <Label htmlFor="paper-note">Not</Label>
          <Textarea id="paper-note" maxLength={500} placeholder="Ör. kâğıt form no" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err.text}
            {err.activeId && <Button variant="link" size="sm" className="h-auto px-1" onClick={() => onCreated(err.activeId!)}>Mevcut muayeneyi aç</Button>}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!canSave} onClick={() => save.mutate()}>{save.isPending ? "Kaydediliyor…" : "Kaydet"}</Button>
        </DialogFooter>
        <RollPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} title="Top seç" description="Muayene edilen top. Birden çok seçerseniz ilki alınır."
          scopes={ROLL_SCOPES} confirmLabel="Seç" onConfirm={(picked) => { setRoll(picked[0] ?? null); attempt.renew(); setErr(null); }} />
      </DialogContent>
    </Dialog>
  );
}
