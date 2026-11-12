import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { shortcutBody } from "./RouteShortcutFields";
import { CrudPage } from "@/components/layout/CrudPage";
import { routeColumns } from "./columns";
import { routeService } from "./service";
import { RouteFormDialog } from "./RouteFormDialog";
import type { ProductionRoute } from "./types";
import { type RouteFormValues } from "./schema";
import type { RoutesNavState } from "@/pages/Operations/WorkOrders/oie/nav";
import { TERIM } from "@/lib/terim";
import type { RollStage } from "@/types/enums";

interface StepCreate {
  stationId: string;
  sequence: number;
  defaultNotes: string | null;
  requiredCategoryId: string | null;
  plannedSubcontractorId: string | null;
  /** Önerilen makine (yalnız öneri) — backend adımın istasyonuna ait olmasını doğrular. */
  plannedMachineId: string | null;
  /** Çıktı aşaması — her zaman gönderilir (anahtar yoksa backend eski değeri korur). */
  outputStage: RollStage | null;
  /** Şablon hedefi. Backend `plannedPropertyIds`'i pivot nested write'ına ÇEVİRİR
   *  — istemci ham Prisma yazımı göndermez (mass-assignment allowlist'i). */
  plannedColorId: string | null;
  plannedPropertyIds: string[];
}

interface CreatePayload {
  code?: string | null;
  name: string;
  description?: string | null;
  customerId?: string | null;
  isFavorite: boolean;
  isActive: boolean;
  isWorkOrderShortcut?: boolean;
  shortcutOrder?: number;
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
    plannedMachineId: s.plannedMachineId ?? null,
    outputStage: s.outputStage ?? null,
    plannedColorId: s.plannedColorId ?? null,
    plannedPropertyIds: s.plannedPropertyIds ?? [],
  }));

  const base = {
    name: v.name,
    description: v.description?.trim() ? v.description.trim() : null,
    customerId: v.customerId ?? null,
    isFavorite: v.isFavorite,
    isActive: v.isActive,
    ...shortcutBody(v),
    steps: isEdit
      ? { deleteMany: {} as Record<string, never>, create: stepCreates }
      : { create: stepCreates },
  };

  // Kod backend'de üretilir (ROT+GGAAYY+NNNN); create'te gönderilmez, edit'te backend korur.
  return base;
}

export function RoutesPage() {
  // "Yeni özel iş emri" kartı (K20): diyalog açık + kısayol işaretli doğar; ilk kapanışta tohum söner (sonraki "Yeni" düz).
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as RoutesNavState | null;
  const [shortcutSeed, setShortcutSeed] = useState(navState?.newShortcut === true);
  // Tohum bir kez tüketilir: geçmiş girdisinde kalırsa geri dönüşte (yeniden bağlanınca) diyalog tekrar açılırdı.
  useEffect(() => {
    if (navState?.newShortcut) void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [navState, navigate, location.pathname, location.search]);
  return (
    <CrudPage<ProductionRoute>
      title="Üretim Rotaları"
      description={`${TERIM.terbiyeIsEmri.cumleBasi.yalin} şablonları — sık kullanılan istasyon sıralarını burada tanımla.`}
      entityName="Rota"
      importEntity="route"
      queryKey="routes"
      service={routeService}
      columns={routeColumns}
      writePermission="station:write"
      searchHint="Rota adı"
      openCreateOnMount={shortcutSeed}
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <RouteFormDialog
          open={open}
          onOpenChange={(o) => {
            if (!o) setShortcutSeed(false);
            onOpenChange(o);
          }}
          initial={initial}
          newAsShortcut={shortcutSeed}
          isSubmitting={isSubmitting}
          onSubmit={(values) =>
            onSubmit(
              buildPayload(values, Boolean(initial)) as unknown as Partial<ProductionRoute>,
            ).then(() => setShortcutSeed(false))
          }
        />
      )}
    />
  );
}
