import { Fingerprint, Layers, Ruler } from "lucide-react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormCard, WideFormColumns } from "@/components/forms/WideFormDialog";
import { warpSpecFormSchema, type WarpSpecFormValues } from "./schema";
import { buildDefaults } from "./payload";
import { YarnRowsEditor } from "./YarnRowsEditor";
import { WarpCalcPanel } from "./WarpCalcPanel";
import { IdentityFields, NotesField, ReedFields, ReedHelper } from "./WarpSpecFields";
import type { WarpSpec } from "./types";
import { ModalSection } from "@/components/forms/modal-sections/ModalSections";

// Gizli bölümün bu alanlarında doğrulama hatası olursa bölüm kendiliğinden görünür.
const REED_FIELDS = ["selvedgeEnds", "reedNo", "endsPerDent", "reedWidthCm", "sequenceNote", "takeUpPct", "wastePct"] as const;
const NOTE_FIELDS = ["notes"] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WarpSpec | null;
  /** "Kopyala": aynı reçeteden yeni kart taslağı (kayıt OLUŞTURMA olarak gider). */
  draft?: WarpSpecFormValues | null;
  onSubmit: (values: WarpSpecFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

/** Geniş form: solda Kimlik · Çözgü iplikleri · Tarak ve dizilim, sağda yapışkan Hesap paneli + Not; dar ekranda tek sütun, hesap altta. */
export function WarpSpecFormDialog({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }: Props) {
  return (
    <EntityFormDialog<WarpSpecFormValues>
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      sectionsKey="warp-spec.form"
      title={initial ? "Çözgü Kartını Düzenle" : draft ? "Çözgü Kartını Kopyala" : "Yeni Çözgü Kartı"}
      description="İplikler ve telleri, tarak ve dizilim. Sağdaki hesap iplik kartındaki denyeyle anında güncellenir."
      schema={warpSpecFormSchema}
      defaultValues={initial ? buildDefaults(initial) : (draft ?? buildDefaults(null))}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <WideFormColumns
          main={
            <>
              <FormCard sectionId="identity" sectionRequired title="Kimlik" icon={Fingerprint}>
                <IdentityFields form={form} excludeId={initial?.id} />
              </FormCard>
              <FormCard sectionId="yarns" sectionRequired title="Çözgü iplikleri" icon={Layers}>
                <YarnRowsEditor />
              </FormCard>
              <FormCard sectionId="reed" errorFields={REED_FIELDS} title="Tarak ve dizilim" icon={Ruler} note="Kenar teli, tarak ve dizilim hesaba girmez" aside={<ReedHelper form={form} />}>
                <ReedFields form={form} />
              </FormCard>
            </>
          }
          side={
            <>
              <ModalSection id="calc" title="Hesap">
                <WarpCalcPanel />
              </ModalSection>
              <ModalSection id="notes" title="Not" fields={NOTE_FIELDS}>
                <div className="rounded-xl border border-card-border bg-card px-5 py-4 shadow-card">
                  <NotesField form={form} />
                </div>
              </ModalSection>
            </>
          }
        />
      )}
    </EntityFormDialog>
  );
}
