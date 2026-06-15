import { CrudPage } from "@/components/layout/CrudPage";
import { labelFormatProfileColumns } from "./columns";
import { labelFormatProfileService } from "./service";
import { LabelFormatProfileFormDialog } from "./LabelFormatProfileFormDialog";
import { buildLabelFormatProfilePayload } from "./schema";
import type { LabelFormatProfile } from "./types";

/**
 * Etiket Format Profilleri — top etiketinin fiziksel geometrisi (medya boyutu +
 * güvenlik payı). Yazıcı modeli/makine bunlara referans tutar; etiket birkaç mm
 * küçük çıksa bile pay sayesinde kırpılmaz. Test baskısı sonrası buradan ayarlanır.
 */
export function LabelFormatProfilesPage() {
  return (
    <CrudPage<LabelFormatProfile>
      title="Etiket Format Profilleri"
      description="Top etiketinin fiziksel boyutu (mm) + güvenlik payı + DPI/yön. Yazıcıya/etikete göre ayarlanır."
      entityName="Format Profili"
      queryKey="label-format-profiles"
      service={labelFormatProfileService}
      columns={labelFormatProfileColumns}
      writePermission="station:write"
      searchPlaceholder="Profil kodu/adı ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <LabelFormatProfileFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) =>
            onSubmit(buildLabelFormatProfilePayload(values) as Partial<LabelFormatProfile>)
          }
        />
      )}
    />
  );
}
