import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrudPage } from "@/components/layout/CrudPage";
import { screenTitle } from "@/components/layout/screen-title";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { ClassTypeFormDialog } from "./ClassTypeFormDialog";
import { classTypeColumns } from "./columns";
import { CLASS_TYPE_KINDS, type ClassTypeKind } from "./kinds";
import { classTypePayload } from "./schema";
import { usageCount, type ClassTypeRow } from "./types";

/** Silme yok: kaldırma = pasife alma; kullanımdaysa uyarır ama engellemez (sınıflama yapılandırması). */
export function ClassTypePage({ kind }: { kind: ClassTypeKind }) {
  const cfg = CLASS_TYPE_KINDS[kind];
  const columns = useMemo(() => classTypeColumns(kind), [kind]);
  const qc = useQueryClient();
  const [deactivating, setDeactivating] = useState<ClassTypeRow | null>(null);
  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => cfg.service.update(id, { isActive }),
    onSuccess: (_d, v) => {
      toast.success(v.isActive ? `${cfg.entity} etkinleştirildi.` : `${cfg.entity} pasife alındı.`);
      void qc.invalidateQueries({ queryKey: [cfg.queryKey] });
    },
  });
  const used = deactivating ? usageCount(deactivating) : 0;

  return (
    <>
      <CrudPage<ClassTypeRow>
        title={screenTitle(cfg.screenPath)}
        description={cfg.description}
        entityName={cfg.entity}
        queryKey={cfg.queryKey}
        service={cfg.service}
        columns={columns}
        writePermission="item:write"
        searchHint="Ad"
        defaultSortBy="sortOrder"
        defaultSortOrder="asc"
        removeLabel="Pasife al (geri alınabilir)"
        onRemove={(row) => setDeactivating(row)}
        restoreLabel="Etkinleştir"
        onRestore={(row) => setActive.mutate({ id: row.id, isActive: true })}
        renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
          <ClassTypeFormDialog
            kind={kind}
            open={open}
            onOpenChange={onOpenChange}
            initial={initial}
            isSubmitting={isSubmitting}
            onSubmit={(values) => onSubmit(classTypePayload(cfg.hasAbbreviation, values))}
          />
        )}
      />
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={`“${deactivating?.name ?? ""}” pasife alınsın mı?`}
        description={
          used > 0
            ? `${used} ${cfg.usageNoun} kullanılıyor. O kartlarda kalır; yalnız yeni seçimde çıkmaz. Sonra yeniden etkinleştirebilirsin.`
            : "Yeni seçimde çıkmaz. Sonra yeniden etkinleştirebilirsin."
        }
        confirmLabel="Pasife al"
        isPending={setActive.isPending}
        onConfirm={async () => {
          if (!deactivating) return;
          await setActive.mutateAsync({ id: deactivating.id, isActive: false });
          setDeactivating(null);
        }}
      />
    </>
  );
}

export const FabricTypesPage = () => <ClassTypePage kind="fabric" />;
export const FiberTypesPage = () => <ClassTypePage kind="fiber" />;
