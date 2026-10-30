// "Ücret gir / Ücreti değiştir" — yeni sürüm ŞU ANDAN itibaren geçerli; eski sürüm silinmez, geçmişte damgalı kalır.
// Token MANTIKSAL DENEME başına (`useAttemptToken`): belirsiz hatada yapışır, kesin 4xx'te ve başarıda yenilenir.
// Sunucunun 409 cümlesi (ör. "aynı anda başka bir işlemle değişti") diyalogda KALIR; toast'a bırakılmaz.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { useAttemptToken } from "@/lib/attemptToken";
import { apiErrorText } from "@/lib/api-error";
import { decToInput, toDecimalText } from "../shared/format";
import { machineRateService, type MachineCostRate } from "./service";
import { MACHINE_RATE_NOTE_MAX } from "./schema";

type MachineBrief = { id: string; code: string; name: string };

interface Props {
  onClose: () => void;
  /** Değişim: aktif sürüm. Yoksa yaratma (makine verilmişse kilitli, verilmemişse seçici). */
  current?: MachineCostRate | null;
  machine?: MachineBrief | null;
}

export function MachineRateDialog({ onClose, current, machine: presetMachine }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [machineId, setMachineId] = useState<string | null>(current?.machineId ?? presetMachine?.id ?? null);
  const fixedMachine = current?.machine ?? presetMachine ?? null;
  const [rate, setRate] = useState(decToInput(current?.hourRateTry));
  const [norm, setNorm] = useState(decToInput(current?.normMPerHour));
  const [note, setNote] = useState("");
  const rateText = toDecimalText(rate);
  const save = useMutation({
    mutationFn: () => {
      const values = { hourRateTry: rateText!, normMPerHour: toDecimalText(norm), note: note.trim() || null, clientToken: attempt.token() };
      return current ? machineRateService.change(current.id, values) : machineRateService.create(machineId!, values);
    },
    onSuccess: (r) => {
      attempt.onSuccess();
      toast.success(r.message ?? "Saat ücreti kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["cost-machine-rates"] });
      onClose();
    },
    onError: (e) => attempt.onFailure(e),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{current ? "Saat ücretini değiştir" : "Makine saat ücreti"}</DialogTitle>
          <DialogDescription>
            Yeni ücret şu andan itibaren geçerli olur; eski ücret silinmez, geçmişte damgalı kalır. Geçmiş ayların kârlılığı değişmez.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <MachineField fixed={fixedMachine} value={machineId} onChange={setMachineId} />
          <div className="flex flex-wrap gap-2">
            <label className="min-w-[10rem] flex-1">
              <span className="text-muted-foreground">Saat ücreti (TL/saat)</span>
              <Input aria-label="Saat ücreti" className="mt-1 text-right tabular-nums" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
            <label className="min-w-[10rem] flex-1">
              <span className="text-muted-foreground">Beklenen metre/saat (isteğe bağlı)</span>
              <Input aria-label="Beklenen metre/saat" className="mt-1 text-right tabular-nums" inputMode="decimal" value={norm} onChange={(e) => setNorm(e.target.value)} />
            </label>
          </div>
          {current && (
            <p className="text-xs text-muted-foreground">
              Şu anki: {decToInput(current.hourRateTry)} TL/saat{current.normMPerHour ? ` · ${decToInput(current.normMPerHour)} m/saat` : ""}
            </p>
          )}
          <label>
            <span className="text-muted-foreground">Not</span>
            <Input className="mt-1" maxLength={MACHINE_RATE_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {save.isError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
              {apiErrorText(save.error, "Saat ücreti kaydedilemedi.")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!machineId || !rateText || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Değişimde/satırdan açılışta makine kilitli; başlıktan açılışta seçici DOĞRUDAN modal (combobox yok). */
function MachineField({ fixed, value, onChange }: { fixed: MachineBrief | null; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <div>
      <span className="text-muted-foreground">Makine</span>
      {fixed ? (
        <p className="mt-1 font-medium">{fixed.code} — {fixed.name}</p>
      ) : (
        <EntityPickerModal<Machine>
          value={value}
          onChange={onChange}
          service={machineService}
          queryKey="machines"
          getLabel={(m) => `${m.code} — ${m.name}`}
          getSubLabel={(m) => m.station?.name}
          placeholder="Makine seç…"
          title="Makine seç"
          countLabel="makine"
        />
      )}
    </div>
  );
}
