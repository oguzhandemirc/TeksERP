import { Fingerprint, Layers, Ruler } from "lucide-react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { warpSpecFormSchema, type WarpSpecFormValues } from "./schema";
import { buildDefaults } from "./payload";
import { YarnRowsEditor } from "./YarnRowsEditor";
import { WarpCalcPanel } from "./WarpCalcPanel";
import { IdentityFields, NotesField, ReedFields, ReedHelper, SpecSection } from "./WarpSpecFields";
import type { WarpSpec } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WarpSpec | null;
  /** "Kopyala": aynı reçeteden yeni kart taslağı (kayıt OLUŞTURMA olarak gider). */
  draft?: WarpSpecFormValues | null;
  onSubmit: (values: WarpSpecFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

/** Geniş yüzey: solda Kimlik · Çözgü iplikleri · Tarak ve dizilim, sağda yapışkan Hesap paneli; dar ekranda tek sütun, hesap altta. */
export function WarpSpecFormDialog({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }: Props) {
  return (
    <EntityFormDialog<WarpSpecFormValues>
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      title={initial ? "Çözgü Kartını Düzenle" : draft ? "Çözgü Kartını Kopyala" : "Yeni Çözgü Kartı"}
      schema={warpSpecFormSchema}
      defaultValues={initial ? buildDefaults(initial) : (draft ?? buildDefaults(null))}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]" data-testid="warp-spec-layout">
          <div className="min-w-0 space-y-4">
            <SpecSection title="Kimlik" icon={Fingerprint}>
              <IdentityFields form={form} excludeId={initial?.id} />
            </SpecSection>
            <SpecSection title="Çözgü iplikleri" icon={Layers}>
              <YarnRowsEditor />
            </SpecSection>
            <SpecSection title="Tarak ve dizilim" icon={Ruler} note="Kenar teli, tarak ve dizilim hesaba girmez" aside={<ReedHelper form={form} />}>
              <ReedFields form={form} />
            </SpecSection>
          </div>
          {/* Hesap yapışkan; Not geniş ekranda hesabın altındaki boşluğa oturur (form kaydırmasız sığsın). */}
          <div className="min-w-0 space-y-4 xl:sticky xl:top-0 xl:self-start">
            <WarpCalcPanel />
            <div className="rounded-xl border border-card-border bg-card px-4 py-3 shadow-card">
              <NotesField form={form} />
            </div>
          </div>
        </div>
      )}
    </EntityFormDialog>
  );
}
