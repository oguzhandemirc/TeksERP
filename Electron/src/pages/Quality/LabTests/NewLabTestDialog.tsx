// Yeni lab testi — konu top (modal seçici) ya da parti (parti detayından gelir ya da seçilen topun partisi).
// clientToken mantıksal deneme başına; yalnız belirsiz hatada yapışır (kk1.md).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { LabCustomerField } from "./LabCustomerField";
import { RollPickerDialog } from "@/components/operations/roll-picker/RollPickerDialog";
import type { PickedRoll } from "@/components/operations/roll-picker/pickable-rolls";
import apiClient from "@/services/apiClient";
import { useAttemptToken } from "@/lib/attemptToken";
import { factoryDayKey } from "@/lib/factory-time";
import { labTestService } from "./service";

export interface LabSubjectPreset { batchId: string; batchLabel: string }
interface Props { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void; presetBatch?: LabSubjectPreset }

const ROLL_SCOPES = [{ key: "all", label: "Tüm toplar", filters: {} }];

export function NewLabTestDialog({ open, onOpenChange, onCreated, presetBatch }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [roll, setRoll] = useState<PickedRoll | null>(null);
  const [wholeBatch, setWholeBatch] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sampleCode, setSampleCode] = useState(""), [labName, setLabName] = useState("");
  const [testedOn, setTestedOn] = useState(factoryDayKey()), [note, setNote] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      let subject: { rollId?: string; batchId?: string };
      if (presetBatch) subject = { batchId: presetBatch.batchId };
      else if (roll && wholeBatch) {
        // Topun partisi detay ucundan okunur; partisiz topta parti testi açılamaz.
        const detail = await apiClient.get<{ data: { batchId?: string | null } }>(`/api/rolls/${roll.id}`);
        const batchId = detail.data.data?.batchId;
        if (!batchId) throw new Error("Bu top bir partiye bağlı değil — testi topa açın.");
        subject = { batchId };
      } else subject = { rollId: roll!.id };
      return labTestService.create({
        clientToken: attempt.token(), ...subject, customerId,
        sampleCode: sampleCode.trim() || null, labName: labName.trim() || null, testedOn: testedOn || null, note: note.trim() || null,
      });
    },
    onSuccess: (t) => {
      attempt.onSuccess();
      void qc.invalidateQueries({ queryKey: ["lab-tests"] });
      toast.success(`${t.testNo} açıldı.`);
      onOpenChange(false);
      onCreated(t.id);
    },
    // Sunucu hatasını apiClient zaten basar; yalnız istemci tarafı ret (partisiz top) dialogda yazılır.
    onError: (e) => { attempt.onFailure(e); setLocalError((e as { isAxiosError?: boolean }).isAxiosError ? null : (e as Error).message); },
  });

  const ready = Boolean(presetBatch || roll) && !save.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni lab testi</DialogTitle>
          <DialogDescription>Numuneyi kaydedin; sonuçları açılan testte tür tür girersiniz. Onaylanan test donar.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Konu</Label>
            {presetBatch ? (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">Parti <span className="font-mono">{presetBatch.batchLabel}</span> — parti düzeyi test</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>{roll ? "Topu değiştir" : "Top seç…"}</Button>
                {roll && <span className="text-sm"><span className="font-mono">{roll.barcode ?? "Açık kumaş"}</span> · {roll.itemName}{roll.colorName ? ` · ${roll.colorName}` : ""}</span>}
              </div>
            )}
            {!presetBatch && roll && (
              <label className="flex items-center gap-2 pt-1 text-sm">
                <Checkbox checked={wholeBatch} onCheckedChange={(v) => setWholeBatch(v === true)} />
                Testi topun partisine uygula (partinin bütün toplarında görünür)
              </label>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="lab-sample">Numune kodu</Label><Input id="lab-sample" maxLength={64} value={sampleCode} onChange={(e) => setSampleCode(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="lab-name">Laboratuvar</Label><Input id="lab-name" maxLength={120} placeholder="İç lab ya da dış lab adı" value={labName} onChange={(e) => setLabName(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="lab-date">Test tarihi</Label><DatePickerInput id="lab-date" max={factoryDayKey()} value={testedOn} onChange={setTestedOn} /></div>
          </div>
          <LabCustomerField value={customerId} onChange={(v) => { setCustomerId(v); attempt.renew(); }} />
          {localError && <p className="text-sm text-destructive">{localError}</p>}
          <div className="space-y-1"><Label htmlFor="lab-note">Not</Label><Textarea id="lab-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!ready} onClick={() => save.mutate()}>{save.isPending ? "Açılıyor…" : "Testi aç"}</Button>
        </DialogFooter>
        <RollPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} title="Top seç" description="Testin numunesinin alındığı top. Birden çok seçerseniz ilki alınır."
          scopes={ROLL_SCOPES} confirmLabel="Seç" onConfirm={(picked) => { setRoll(picked[0] ?? null); attempt.renew(); }} />
      </DialogContent>
    </Dialog>
  );
}
