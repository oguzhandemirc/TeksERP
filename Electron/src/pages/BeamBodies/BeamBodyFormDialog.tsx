// =============================================================================
// LEVENT GÖVDESİ — yeni / düzenle (geniş form)
// =============================================================================
// Solda kimlik + ölçüler · sahip · (yalnız yeni kayıtta) bulunduğu yer; sağda uyumlu tezgâhlar + not.
// `clientToken` mantıksal deneme başına (`useAttemptToken`): belirsiz hatada yapışır, kesin 4xx'te yenilenir.
// Düzenlemede gövde no ve yer DEĞİŞMEZ (no QR'da kalıcı; yer yalnız hareketle değişir).
// =============================================================================
import { Cog, Fingerprint, MapPin, UserRound } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormCard, WideFormColumns } from "@/components/forms/WideFormDialog";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { beamBodyDefaults, beamBodyFormSchema, buildCreateBody, buildPatchBody, type BeamBodyFormValues } from "./model";
import { BEAM_BODIES_QUERY_KEY, beamBodyService } from "./service";
import { IdentityFields, MachineFitField, NotesField, OwnerFields, PlaceFields } from "./BeamBodyFields";
import type { BeamBody } from "./types";

const OWNER_FIELDS = ["ownerKind", "ownerCustomerId", "ownerSubcontractorId"] as const;
const PLACE_FIELDS = ["initialStatus", "warehouseId", "subcontractorId"] as const;

interface Props {
  initial: BeamBody | null;
  onClose: () => void;
  onSaved?: (body: BeamBody) => void;
}

export function BeamBodyFormDialog({ initial, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const save = useMutation({
    mutationFn: (v: BeamBodyFormValues) => (initial ? beamBodyService.update(initial.id, buildPatchBody(v, initial)) : beamBodyService.create(buildCreateBody(v), attempt.token())),
    onSuccess: (res) => {
      attempt.onSuccess();
      toastServerSuccess(res, initial ? "Gövde güncellendi." : "Gövde kaydedildi.");
      void qc.invalidateQueries({ queryKey: [BEAM_BODIES_QUERY_KEY] });
      if (res.data) onSaved?.(res.data);
      onClose();
    },
    onError: (e) => attempt.onFailure(e),
  });
  return (
    <EntityFormDialog<BeamBodyFormValues>
      open
      onOpenChange={(o) => !o && onClose()}
      size="wide"
      sectionsKey="beam-body.form"
      title={initial ? `${initial.bodyNo} — gövdeyi düzenle` : "Yeni levent gövdesi"}
      description="Boş levent gövdesi demirbaştır: numarası ve QR etiketi kalıcıdır, sahibi ve bulunduğu yer hareketlerle izlenir."
      schema={beamBodyFormSchema}
      defaultValues={beamBodyDefaults(initial)}
      onSubmit={async (v) => {
        await save.mutateAsync(v).catch(() => undefined);
      }}
      isSubmitting={save.isPending}
      submitLabel={initial ? "Kaydet" : "Gövdeyi kaydet"}
    >
      {(form) => (
        <WideFormColumns
          main={
            <>
              <FormCard sectionId="identity" sectionRequired title="Kimlik ve ölçüler" icon={Fingerprint}>
                <IdentityFields form={form} editing={Boolean(initial)} />
              </FormCard>
              <FormCard sectionId="owner" sectionRequired errorFields={OWNER_FIELDS} title="Sahibi" icon={UserRound}>
                <OwnerFields form={form} initial={initial} />
              </FormCard>
              {!initial && (
                <FormCard sectionId="place" sectionRequired errorFields={PLACE_FIELDS} title="Bulunduğu yer" icon={MapPin} note="Sonraki yer değişimleri hareketle yazılır">
                  <PlaceFields form={form} />
                </FormCard>
              )}
            </>
          }
          side={
            <FormCard title="Tezgâh uyumu ve not" icon={Cog}>
              <div className="space-y-4">
                <MachineFitField form={form} initial={initial} />
                <NotesField form={form} />
              </div>
            </FormCard>
          }
        />
      )}
    </EntityFormDialog>
  );
}
