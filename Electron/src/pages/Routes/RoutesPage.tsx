import { CrudPage } from "@/components/layout/CrudPage";
import { routeColumns } from "./columns";
import { routeService } from "./service";
import { RouteFormDialog } from "./RouteFormDialog";
import type { ProductionRoute } from "./types";
import { generateRouteCode, type RouteFormValues } from "./schema";

interface StepCreate {
  stationId: string;
  sequence: number;
  defaultNotes: string | null;
  requiredCategoryId: string | null;
  plannedSubcontractorId: string | null;
}

interface CreatePayload {
  code?: string | null;
  name: string;
  description?: string | null;
  customerId?: string | null;
  isFavorite: boolean;
  isActive: boolean;
  steps:
    | { create: StepCreate[] }
    | { deleteMany: Record<string, never>; create: StepCreate[] };
}

function buildPayload(v: RouteFormValues, isEdit: boolean): CreatePayload {
  const stepCreates: StepCreate[] = v.steps.map((s, i) => ({
    stationId: s.stationId,
    sequence: i + 1,
    defaultNotes: s.defaultNotes?.trim() ? s.defaultNotes.trim() : null,
    // Fason planlaması (INTERNAL adımda buildDefaults/handleStationPick null tutar).
    requiredCategoryId: s.requiredCategoryId ?? null,
    plannedSubcontractorId: s.plannedSubcontractorId ?? null,
  }));

  const base = {
    name: v.name,
    description: v.description?.trim() ? v.description.trim() : null,
    customerId: v.customerId ?? null,
    isFavorite: v.isFavorite,
    isActive: v.isActive,
    steps: isEdit
      ? { deleteMany: {} as Record<string, never>, create: stepCreates }
      : { create: stepCreates },
  };

  // Yeni kayıtta kod otomatik üretilir; düzenlemede mevcut kod backend'de değişmez (alanı göndermiyoruz).
  if (!isEdit) {
    return { ...base, code: generateRouteCode() };
  }
  return base;
}

export function RoutesPage() {
  return (
    <CrudPage<ProductionRoute>
      title="Üretim Rotaları"
      description="İş emri şablonları — sık kullanılan istasyon sıralarını burada tanımla."
      entityName="Rota"
      queryKey="routes"
      service={routeService}
      columns={routeColumns}
      writePermission="station:write"
      searchPlaceholder="Rota adı ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <RouteFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) =>
            onSubmit(
              buildPayload(values, Boolean(initial)) as unknown as Partial<ProductionRoute>,
            )
          }
        />
      )}
    />
  );
}
