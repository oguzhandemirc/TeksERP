// Rota yazma gövdesi — Üretim Rotaları ekranı ve seçicideki kayıt formu (Yeni · Örnek al) aynısını kullanır.
import type { RollStage } from "@/types/enums";
import { shortcutBody } from "./RouteShortcutFields";
import type { RouteFormValues } from "./schema";

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

export interface RouteCreatePayload {
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

export function buildRoutePayload(v: RouteFormValues, isEdit: boolean): RouteCreatePayload {
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

  // Kod backend'de üretilir (ROT+GGAAYY+NNNN); create'te gönderilmez, edit'te backend korur.
  return {
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
}
