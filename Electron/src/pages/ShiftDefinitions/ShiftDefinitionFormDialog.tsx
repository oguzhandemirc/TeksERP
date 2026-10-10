// =============================================================================
// VARDİYA TANIMI — oluştur / düzenle; takvimi etkileyen değişiklikte ÖNCE önizleme
// =============================================================================
// İki adım: form → (saat/süre/gün değiştiyse ya da yeni tanımsa) takvim etkisi → kaydet.
// Etki listesi backend'in job planından gelir (her pencere tek tek); geçmiş/başlamış
// pencere ve mühürlü karne hiçbir durumda değişmez.
// =============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shiftDefinitionService } from "./service";
import { ShiftFormFields } from "./ShiftFormFields";
import { ShiftPreviewList } from "./ShiftPreviewList";
import { changedFields, toFormState, touchesCalendar, validateShiftForm, type ShiftFormState } from "./form-model";
import type { ShiftDefinition, ShiftDefinitionFields, ShiftDefinitionPreview } from "./types";

interface Props {
  target: ShiftDefinition | null; // null = yeni
  isPending: boolean;
  onClose: () => void;
  onCreate: (body: ShiftDefinitionFields & { code: string }) => void;
  onUpdate: (id: string, body: Partial<ShiftDefinitionFields>) => void;
}

type Pending = { kind: "create"; body: ShiftDefinitionFields & { code: string } } | { kind: "update"; body: Partial<ShiftDefinitionFields> };

export function ShiftDefinitionFormDialog({ target, isPending, onClose, onCreate, onUpdate }: Props) {
  const isCreate = target === null;
  const [state, setState] = useState<ShiftFormState>(() => toFormState(target ?? undefined));
  const [errors, setErrors] = useState<Partial<Record<keyof ShiftFormState, string>>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [preview, setPreview] = useState<ShiftDefinitionPreview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [loading, setLoading] = useState(false);

  const save = (p: Pending) => (p.kind === "create" ? onCreate(p.body) : onUpdate(target!.id, p.body));

  const next = async () => {
    const r = validateShiftForm(state, isCreate);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    const p: Pending = isCreate ? { kind: "create", body: { ...r.fields, code: r.code } } : { kind: "update", body: changedFields(target!, r.fields) };
    if (p.kind === "update" && Object.keys(p.body).length === 0) return onClose();
    if (p.kind === "update" && !touchesCalendar(p.body)) return save(p);
    setPending(p);
    setLoading(true);
    setPreviewError(false);
    try {
      const f = p.body;
      const res = await shiftDefinitionService.preview({ id: target?.id ?? null, startMinute: f.startMinute, durationMinutes: f.durationMinutes, activeWeekdays: f.activeWeekdays });
      setPreview(res.data);
    } catch {
      setPreviewError(true);
    } finally {
      setLoading(false);
    }
  };

  const breakChanged = !isCreate && pending?.kind === "update" && pending.body.plannedBreakMinutes !== undefined;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isCreate ? "Yeni vardiya" : `Vardiyayı düzenle — ${target!.code}`}</DialogTitle>
          <DialogDescription>
            Vardiya takvimi önümüzdeki 30 gün için bu tanımdan kurulur. Değişiklik yalnız henüz BAŞLAMAMIŞ vardiyalara uygulanır; geçmiş vardiyalar ve mühürlü karneler değişmez.
          </DialogDescription>
        </DialogHeader>
        {pending === null ? (
          <ShiftFormFields state={state} errors={errors} isCreate={isCreate} onChange={(p) => setState((s) => ({ ...s, ...p }))} />
        ) : (
          <div className="space-y-2">
            {loading && <p className="text-muted-foreground text-sm">Takvim etkisi hesaplanıyor…</p>}
            {previewError && <Callout tone="warning">Takvim etkisi okunamadı — kaydedilirse sonuç bildirimde yazar.</Callout>}
            {preview && <ShiftPreviewList preview={preview} />}
            {breakChanged && <Callout tone="warning">Mola değişikliği henüz mühürlenmemiş karnelerin hesabına da yansır; mühürlü karneler değişmez.</Callout>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={pending ? () => setPending(null) : onClose} disabled={isPending}>
            {pending ? "Geri" : "Vazgeç"}
          </Button>
          {pending ? (
            <Button disabled={isPending || loading} onClick={() => save(pending)}>
              Kaydet
            </Button>
          ) : (
            <Button disabled={isPending || loading} onClick={() => void next()}>
              {isCreate ? "Devam — takvim etkisi" : "Devam"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
