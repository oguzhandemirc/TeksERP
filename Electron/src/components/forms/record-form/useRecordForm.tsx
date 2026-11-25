import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { SharedRecordDialog } from "./SharedRecordDialog";
import { stripIdentity, toTemplateDraft } from "./template";
import type { RecordFormSpec, TemplateDraft } from "./types";

/**
 * Formun hangi kipte açık olduğu — ayrık birleşim: `template` kipi HİÇ kayıt kimliği taşımaz,
 * bu yüzden örnek akışından `update` yoluna ulaşılamaz (kaynağı değiştirmek teknik olarak imkânsız).
 */
type FormState<T> =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; record: T }
  | { mode: "template"; draft: TemplateDraft<T> };

export interface RecordFormHandle<R> {
  /** Yazma izni yoksa false — düğmeler hiç çizilmez. */
  canWrite: boolean;
  openCreate: () => void;
  /** Paylaşılan/bilinmeyen kayıtta formu değil "kart ekranında aç" seçeneklerini açar. */
  openEdit: (row: R) => void;
  openTemplate: (row: R) => Promise<void>;
  /** Form + paylaşılan-kayıt penceresi; seçici modalının İÇİNE çizilir (iç içe yığın, Esc önce bunu kapatır). */
  element: ReactNode;
}

export function useRecordForm<T extends { id: string }, R extends { id: string } = T>(
  spec: RecordFormSpec<T, R> | undefined,
  onSaved: (record: T) => void,
): RecordFormHandle<R> {
  const { hasPermission } = useRoleAccess();
  const qc = useQueryClient();
  const [state, setState] = useState<FormState<T>>({ mode: "closed" });
  const [shared, setShared] = useState<R | null>(null);
  const canWrite = Boolean(spec) && hasPermission(spec?.writePermission ?? "");

  const save = useMutation({
    mutationFn: async (values: Partial<T>) => {
      if (!spec) throw new Error("Kayıt formu tanımsız");
      if (state.mode === "edit") return { res: await spec.service.update(state.record.id, values), created: false };
      return { res: await spec.service.create(stripIdentity(values)), created: true };
    },
    onSuccess: ({ res, created }) => {
      if (!spec) return;
      toast.success(`${spec.entityName} ${created ? "oluşturuldu" : "güncellendi"}.`);
      for (const key of spec.invalidateKeys) void qc.invalidateQueries({ queryKey: [key] });
      setState({ mode: "closed" });
      onSaved(res.data);
    },
  });

  // R = T değilse spec `loadFull` verir (tip sözleşmesi); verilmediyse satır kaydın kendisidir.
  const full = async (row: R): Promise<T> => (spec?.loadFull ? spec.loadFull(row) : (row as unknown as T));
  const openTemplate = async (row: R) => {
    if (!spec) return;
    setShared(null);
    const source = await full(row);
    setState({ mode: "template", draft: toTemplateDraft(source, spec.templateRule) });
  };

  const element = spec && canWrite ? (
    <>
      {spec.renderForm({
        open: state.mode !== "closed",
        onOpenChange: (open) => { if (!open) setState({ mode: "closed" }); },
        mode: state.mode === "closed" ? "create" : state.mode,
        initial: state.mode === "edit" ? state.record : null,
        draft: state.mode === "template" ? state.draft : null,
        onSubmit: async (values) => { await save.mutateAsync(values); },
        isSubmitting: save.isPending,
      })}
      <SharedRecordDialog
        entityName={spec.entityName}
        open={shared !== null}
        onOpenChange={(open) => { if (!open) setShared(null); }}
        onTemplate={() => { if (shared) void openTemplate(shared); }}
        onOpenCard={() => {
          // Sekme deposu tembel: statik import bütün rota ağacını (tab-meta) ortak seçiciye bağlardı.
          if (shared) { const path = spec.cardPath(shared); void import("@/store/tabs").then((m) => m.useTabsStore.getState().openTab(path, { forceNew: true })); }
          setShared(null);
        }}
      />
    </>
  ) : null;

  return {
    canWrite,
    openCreate: () => setState({ mode: "create" }),
    openEdit: (row) => {
      if (spec?.isExclusive?.(row)) void full(row).then((record) => setState({ mode: "edit", record }));
      else setShared(row);
    },
    openTemplate,
    element,
  };
}
