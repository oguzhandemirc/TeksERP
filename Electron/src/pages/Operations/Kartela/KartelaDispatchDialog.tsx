// Yeni Kartela Sevki — tablet "Kartela Sevk" ekranının panel eşi. `/dispatch` clientToken almaz
// (bilinçli; sunucu aynı firma + aynı toplu açık sevki idempotent döndürür) → çift gönderime karşı
// düğme kilidi + istek uçuştayken diyalog kapanmaz.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ListChecks, Send, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/ui/callout";
import { ScanField } from "@/components/scanner/ScanField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { RollPickerDialog } from "@/components/operations/roll-picker/RollPickerDialog";
import { toastServerSuccess } from "@/lib/serverNotes";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { kartelaService } from "./service";
import { buildDispatchPayload, KARTELA_PICKER_SCOPES, refreshKartelaLists, type KartelaPickedRoll } from "./kartelaActions";
import { useDispatchDraft, type DispatchDraft } from "./useDispatchDraft";
import { useKartelaFirmCategory } from "./useKartelaFirmCategory";
import { useSingleFlight } from "./useSingleFlight";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sevk oluştu → sayfa çeki diyaloğunu açar. */
  onCreated: (dispatchId: string) => void;
  /** "Sevke ekle" ile gelen toplar — açılışta taslağa eklenir (mükerrer eklenmez). */
  initialRolls?: readonly KartelaPickedRoll[] | null;
}

const fmtM = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1, useGrouping: false });

export function KartelaDispatchDialog({ open, onOpenChange, onCreated, initialRolls }: Props) {
  const qc = useQueryClient();
  const draft = useDispatchDraft();
  // Aynı ön seçim bir kez uygulanır; taslak kapanışta korunduğu için yeni seçim ekleme yapar.
  const seeded = useRef<readonly KartelaPickedRoll[] | null>(null);
  const { addPicked } = draft;
  useEffect(() => {
    if (!open || !initialRolls?.length || seeded.current === initialRolls) return;
    seeded.current = initialRolls;
    addPicked(initialRolls);
  }, [open, initialRolls, addPicked]);
  const once = useSingleFlight();
  const mut = useMutation({
    mutationFn: (body: ReturnType<typeof buildDispatchPayload>) => kartelaService.dispatch(body),
    onSuccess: (res) => {
      toastServerSuccess(res, "Kartela sevki oluşturuldu");
      refreshKartelaLists(qc);
      draft.reset();
      onOpenChange(false);
      if (res.data?.id) onCreated(res.data.id);
    },
    // onError YOK: apiClient 4xx mesajını (ör. "Top X bir çuvalda") zaten basar; taslak korunur.
  });
  const pending = mut.isPending;
  const canSubmit = Boolean(draft.firmId) && draft.rolls.length > 0 && !pending;
  const submit = () => {
    if (!canSubmit || !draft.firmId) return;
    const body = buildDispatchPayload({ subcontractorId: draft.firmId, ...draft });
    once((done) => mut.mutate(body, { onSettled: done }));
  };
  // Uçuştaki istek bitmeden kapatma yok (Esc · dış tık · X aynı yoldan geçer).
  const change = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Yeni Kartela Sevki</DialogTitle>
          <DialogDescription>Depodaki bitmiş topları kartela firmasına gönder — çeki listesi sevkle birlikte donar.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <FirmField draft={draft} enabled={open} disabled={pending} />
          <RollsSection draft={draft} disabled={pending} />
          <VehicleFields draft={draft} disabled={pending} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => change(false)}>Vazgeç</Button>
          <Button className="gap-1.5" disabled={!canSubmit} onClick={submit}>
            <Send className="h-4 w-4" />
            {pending ? "Gönderiliyor…" : `Sevk Et (${draft.rolls.length} top)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FirmField({ draft, enabled, disabled }: { draft: DispatchDraft; enabled: boolean; disabled: boolean }) {
  const cat = useKartelaFirmCategory(enabled);
  return (
    <section className="space-y-1.5">
      <div className="text-sm font-medium">Kartela firması</div>
      {cat.categoryMissing ? (
        <Callout tone="warning">
          "KARTELA" kodlu fason kategorisi tanımlı değil. Tanımlar › Fason Kategorileri'nden açıp firmaya atayın.
        </Callout>
      ) : (
        <EntityPickerModal<Subcontractor>
          value={draft.firmId}
          onChange={draft.setFirmId}
          service={subcontractorService}
          queryKey="subcontractors-kartela"
          filters={cat.categoryId ? { categoryId: cat.categoryId } : undefined}
          disabled={disabled || !cat.categoryId}
          getLabel={(s) => s.name}
          getSubLabel={(s) => s.code}
          icon={Building2}
          placeholder={cat.isLoading ? "Yükleniyor…" : "Firma seçin…"}
          title="Kartela Firması Seç"
          description="Yalnız Kartela kategorisindeki aktif fason firmaları"
          countLabel="firma"
        />
      )}
    </section>
  );
}

function RollsSection({ draft, disabled }: { draft: DispatchDraft; disabled: boolean }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const total = draft.rolls.reduce((s, r) => s + r.qty, 0);
  return (
    <section className="space-y-2">
      <div className="text-sm font-medium">Toplar ({draft.rolls.length}) · {fmtM(total)} m</div>
      <div className="flex flex-wrap items-start gap-2">
        <ScanField
          value={draft.scan}
          onChange={draft.setScan}
          onScan={(c) => void draft.addScanned(c)}
          placeholder="Top barkodu okut ya da yaz…"
          expectPrefix="ROLL"
          busy={draft.resolving || disabled}
          submitLabel="Ekle"
          busyLabel="…"
          widthClassName="w-72"
          autoFocus
        />
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled} onClick={() => setPickerOpen(true)}>
          <ListChecks className="h-4 w-4" /> Listeden Seç
        </Button>
      </div>
      <div className="max-h-[32vh] overflow-auto rounded-md border">
        {draft.rolls.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Henüz top eklenmedi — barkod okutun ya da listeden seçin.</p>
        ) : draft.rolls.map((r) => (
          <div key={r.id} className="flex items-center gap-3 border-b px-3 py-1.5 text-sm last:border-0">
            <span className="min-w-0 flex-1 truncate">{r.itemName}{r.colorName ? ` · ${r.colorName}` : ""}</span>
            <span className="font-mono text-xs text-muted-foreground">{r.barcode ?? "—"}</span>
            <span className="w-20 text-right tabular-nums">{fmtM(r.qty)} m</span>
            <button type="button" disabled={disabled} aria-label={`${r.barcode ?? r.itemName} çıkar`} onClick={() => draft.removeRoll(r.id)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <RollPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Kartelalık Top Seç"
        description="Depodaki bitmiş toplar (çuvalda/sevkiyatta olanlar listelenmez)."
        scopes={KARTELA_PICKER_SCOPES}
        excludeIds={draft.rolls.map((r) => r.id)}
        onConfirm={draft.addPicked}
      />
    </section>
  );
}

function VehicleFields({ draft, disabled }: { draft: DispatchDraft; disabled: boolean }) {
  return (
    <section className="grid gap-2 sm:grid-cols-2">
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Plaka</span>
        <Input value={draft.plateNumber} maxLength={32} disabled={disabled} onChange={(e) => draft.setPlateNumber(e.target.value)} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Şoför</span>
        <Input value={draft.driverName} maxLength={128} disabled={disabled} onChange={(e) => draft.setDriverName(e.target.value)} />
      </label>
      <label className="space-y-1 text-sm sm:col-span-2">
        <span className="text-muted-foreground">Not</span>
        <Textarea rows={2} value={draft.notes} maxLength={1000} disabled={disabled} onChange={(e) => draft.setNotes(e.target.value)} />
      </label>
    </section>
  );
}
