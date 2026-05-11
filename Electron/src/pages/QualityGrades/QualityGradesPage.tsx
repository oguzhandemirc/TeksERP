import { CrudPage } from "@/components/layout/CrudPage";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import { qualityGradeColumns } from "./columns";
import { qualityGradeService } from "./service";
import { QualityGradeFormDialog } from "./QualityGradeFormDialog";
import type { QualityGrade } from "./types";
import type { QualityGradeFormValues } from "./schema";

const buildPayload = (
  v: QualityGradeFormValues,
  initial: QualityGrade | null,
): Partial<QualityGrade> => ({
  code: initial?.code ?? generateCode(CODE_PREFIXES.QUALITY_GRADE),
  name: v.name,
  description: v.description || null,
  color: v.color || null,
  sortOrder: v.sortOrder,
  isActive: v.isActive,
});

export function QualityGradesPage() {
  return (
    <CrudPage<QualityGrade>
      title="Kalite Sınıfları"
      description="A1, A2, FIRE gibi kalite kademeleri."
      entityName="Kalite sınıfı"
      queryKey="quality-grades"
      service={qualityGradeService}
      columns={qualityGradeColumns}
      writePermission="quality:write"
      searchPlaceholder="Kod veya ad ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <QualityGradeFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildPayload(values, initial))}
        />
      )}
    />
  );
}
