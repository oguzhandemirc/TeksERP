// Yeni emanet çıkış belgesi: müşteri (doğrudan modal) → levent / iplik lotu kalemleri → sunucu önizlemesi → kaydet.
// Top bu belgeye girmez: emanet top normal sevkiyattan çıkar (çuval/tartı/brüt sevk kuralı değişmez).
import { useState } from "react";
import { Boxes, Cylinder, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { useDevereEnabled, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { BeamPicker } from "./BeamPicker";
import { YarnLinePicker } from "./YarnLinePicker";
import { DraftItemsTable } from "./DraftItemsTable";
import { useConsignmentDraft } from "./useConsignmentDraft";
import { fmtNum } from "./consignmentText";
import type { DraftMeta } from "./draft";
import type { ConsignmentDispatchDto } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (d: ConsignmentDispatchDto) => void;
}

type Draft = ReturnType<typeof useConsignmentDraft>;

export function ConsignmentDispatchFormDialog({ open, onOpenChange, onCreated }: Props) {
  const d = useConsignmentDraft(open, onCreated);
  const [picker, setPicker] = useState<"beam" | "yarn" | null>(null);
  const owner = d.ownerCustomerId;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Yeni Emanet Çıkışı</DialogTitle>
          <DialogDescription>Müşterinin emanet leventini ya da ipliğini sahibine geri verir. Kalemler kaydetmeden önce sunucuda ölçülür.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto">
          <div className="space-y-1">
            <Label>Müşteri (malın sahibi)</Label>
            <CustomerPickerField value={owner} onChange={d.changeOwner} />
            {owner && d.items.length > 0 && <p className="text-xs text-muted-foreground">Müşteri değişirse kalem listesi boşalır.</p>}
          </div>
          <AddItemButtons hasOwner={Boolean(owner)} onPick={setPicker} />
          <DraftItemsTable items={d.items} preview={d.preview} onRemove={d.removeItem} />
          {d.previewError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              Önizleme alınamadı — kayıt açılmadı.{" "}
              <Button variant="link" className="h-auto p-0" onClick={d.retryPreview}>Tekrar dene</Button>
            </div>
          )}
          {d.preview?.warnings.map((w) => (
            <p key={w} className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{w}</p>
          ))}
          <MetaFields meta={d.meta} onChange={d.setMeta} />
        </div>
        <FormFooter d={d} onClose={() => onOpenChange(false)} />
        {owner && (
          <>
            <BeamPicker open={picker === "beam"} onOpenChange={(o) => setPicker(o ? "beam" : null)} ownerCustomerId={owner} takenKeys={new Set(d.items.map((x) => x.key))} onPick={d.addItem} />
            <YarnLinePicker open={picker === "yarn"} onOpenChange={(o) => setPicker(o ? "yarn" : null)} ownerCustomerId={owner} onPick={d.addItem} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Kalem türü düğmeleri yalnız modülü açıkken (levent = Devere, iplik = İplik; sunucu ikinci hatta 403 verir). Seçici
 * listeleri mevcut uçlardan okunur (`warpbeam:read` · `warehouse:read`); izin yoksa düğme nedeniyle pasif (403 yutulmaz).
 */
function AddItemButtons({ hasOwner, onPick }: { hasOwner: boolean; onPick: (k: "beam" | "yarn") => void }) {
  const devereOn = useDevereEnabled();
  const iplikOn = useFeatureFlags().data?.data?.iplikEnabled ?? false;
  const { hasPermission } = useRoleAccess();
  if (!devereOn && !iplikOn) return <p className="text-sm text-muted-foreground">Levent (Devere) ve İplik modülleri kapalı — çıkacak kalem türü yok.</p>;
  const beamPerm = hasPermission("warpbeam:read");
  const lotPerm = hasPermission("warehouse:read");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {devereOn && (
        <Button type="button" variant="outline" disabled={!hasOwner || !beamPerm} title={beamPerm ? undefined : "Levent listesini görme yetkiniz yok"} onClick={() => onPick("beam")}>
          <Cylinder className="mr-1 h-4 w-4" />Levent ekle
        </Button>
      )}
      {iplikOn && (
        <Button type="button" variant="outline" disabled={!hasOwner || !lotPerm} title={lotPerm ? undefined : "İplik lotlarını görme yetkiniz yok"} onClick={() => onPick("yarn")}>
          <Boxes className="mr-1 h-4 w-4" />İplik lotu ekle
        </Button>
      )}
      {!hasOwner && <p className="text-xs text-muted-foreground">Önce müşteriyi seçin.</p>}
      {hasOwner && ((devereOn && !beamPerm) || (iplikOn && !lotPerm)) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Bazı kalem türlerinin listesini görme yetkiniz yok — yöneticiden levent/depo görüntüleme izni isteyin.</p>
      )}
    </div>
  );
}

function FormFooter({ d, onClose }: { d: Draft; onClose: () => void }) {
  const t = d.preview?.totals;
  return (
    <DialogFooter className="items-center gap-2 sm:justify-between">
      <span className="text-sm text-muted-foreground" data-testid="draft-totals">
        {t ? `${t.beamCount} levent · ${fmtNum(t.beamLengthM)} m · ${fmtNum(t.yarnKg)} kg iplik` : d.previewLoading ? "Ölçülüyor…" : ""}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose}>Vazgeç</Button>
        <Button disabled={!d.canSubmit} onClick={d.submit}>
          {d.submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Çıkışı Kaydet
        </Button>
      </div>
    </DialogFooter>
  );
}

// Uzunluklar DB `VarChar` ile aynı (plateNumber 32 · driverName 100 · notes 500).
const META_FIELDS: { key: keyof DraftMeta; label: string; max: number }[] = [
  { key: "plateNumber", label: "Plaka", max: 32 },
  { key: "driverName", label: "Şoför", max: 100 },
  { key: "notes", label: "Not", max: 500 },
];

function MetaFields({ meta, onChange }: { meta: DraftMeta; onChange: (m: DraftMeta) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {META_FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`cd-${f.key}`}>{f.label}</Label>
          <Input id={`cd-${f.key}`} value={meta[f.key]} maxLength={f.max} onChange={(e) => onChange({ ...meta, [f.key]: e.target.value })} />
        </div>
      ))}
    </div>
  );
}
