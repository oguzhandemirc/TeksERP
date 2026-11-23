// Cari kartından bağlı fason profilini düzenle (belge profili, ücretler, kategoriler) — T1/T9 ile ayrı "Fason Firmalar"
// ekranı kalktı; bağlı profil Cariler listesinde ayrı satır olmadığından TEK düzenleme yolu budur.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PermissionGate } from "@/components/PermissionGate";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { SubcontractorFormDialog } from "@/pages/Subcontractors/SubcontractorFormDialog";
import { buildSubcontractorPayload } from "@/pages/Subcontractors/subcontractorPayload";
import type { Subcontractor } from "@/pages/Subcontractors/types";

export const SUBCONTRACTOR_PROFILE_EDIT_LABEL = "fason profilini düzenle";

export function SubcontractorProfileEdit({ profile, onSaved }: { profile: Subcontractor; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (payload: Partial<Subcontractor>) => subcontractorService.update(profile.id, payload),
    onSuccess: () => {
      toast.success("Fason profili güncellendi.");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["subcontractors"] });
      onSaved();
    },
  });
  return (
    <PermissionGate permission="subcontractor:write">
      <button type="button" className="underline underline-offset-2" onClick={() => setOpen(true)}>
        {SUBCONTRACTOR_PROFILE_EDIT_LABEL}
      </button>
      {/* React olayları portaldan da kabarır: iç formun submit'i dıştaki cari kartı formunu kaydetmesin. */}
      <span className="contents" onSubmit={(e) => e.stopPropagation()}>
        <SubcontractorFormDialog
          open={open}
          onOpenChange={setOpen}
          initial={profile}
          isSubmitting={save.isPending}
          onSubmit={(values) => save.mutate(buildSubcontractorPayload(values, profile) as unknown as Partial<Subcontractor>)}
        />
      </span>
    </PermissionGate>
  );
}
