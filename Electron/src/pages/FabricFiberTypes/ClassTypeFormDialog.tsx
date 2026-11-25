import { useMemo } from "react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import { classTypeDefaults, classTypeSchema, type ClassTypeFormValues } from "./schema";
import { usageCount, type ClassTypeRow } from "./types";
import { CLASS_TYPE_KINDS, type ClassTypeKind } from "./kinds";

interface Props {
  kind: ClassTypeKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ClassTypeRow | null;
  /** Örnek al taslağı (kimliksiz) — YENİ kayıt olarak açılır. */
  draft?: Partial<ClassTypeRow> | null;
  onSubmit: (values: ClassTypeFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function ClassTypeFormDialog({ kind, open, onOpenChange, initial, draft, onSubmit, isSubmitting }: Props) {
  const cfg = CLASS_TYPE_KINDS[kind];
  const schema = useMemo(() => classTypeSchema(cfg.nameMax), [cfg.nameMax]);
  const used = initial ? usageCount(initial) : 0;
  const src = initial ?? draft;
  const defaults: ClassTypeFormValues = src
    ? {
        name: src.name ?? "",
        abbreviation: (src as { abbreviation?: string | null }).abbreviation ?? "",
        sortOrder: String(src.sortOrder ?? 0),
        isActive: src.isActive ?? true,
      }
    : classTypeDefaults;

  return (
    <EntityFormDialog<ClassTypeFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? `${cfg.entity} düzenle` : `Yeni ${cfg.entityLower}`}
      schema={schema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          {used > 0 ? (
            <Callout tone="warning" title={`Bu ${cfg.entityLower} ${used} ${cfg.usageNoun} kullanılıyor`}>
              Ad değişikliği o kartların hepsinde görünür. Pasife alırsan kartlarda kalır, yalnız yeni seçimde çıkmaz.
            </Callout>
          ) : null}
          <div className="grid grid-cols-[1fr_8rem_8rem] gap-3">
            <FormField label="Ad" htmlFor="ct-name" error={form.formState.errors.name} required>
              <Input id="ct-name" autoFocus placeholder={cfg.namePlaceholder} {...form.register("name")} />
            </FormField>
            {cfg.hasAbbreviation ? (
              <FormField
                label="Kısaltma"
                htmlFor="ct-abbr"
                error={form.formState.errors.abbreviation}
                info="Kompozisyon metninde yazılır (ör. %83 PES). Boşsa ad yazılır."
              >
                <Input id="ct-abbr" placeholder="ör. PES" {...form.register("abbreviation")} />
              </FormField>
            ) : (
              <div />
            )}
            <FormField label="Sıra" htmlFor="ct-sort" error={form.formState.errors.sortOrder} info="Seçicide küçük sayı önce gelir.">
              <Input id="ct-sort" inputMode="numeric" placeholder="ör. 10" {...form.register("sortOrder")} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}
