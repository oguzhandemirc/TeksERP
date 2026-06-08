import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { routeService } from "@/pages/Routes/service";
import type { ProductionRoute } from "@/pages/Routes/types";
import { RouteDesignerStepRow } from "./RouteDesignerStepRow";
import { RouteDesignerTemplatePanel } from "./RouteDesignerTemplatePanel";
import { useDesignerSteps } from "./useDesignerSteps";
import type { FasonStepPlan } from "./FasonPlanningDialog";

export interface DesignerStep {
  clientId: string;
  /** Mevcut WO step'inin DB id'si — smart-merge için backend'e iletilir. */
  serverId?: string | null;
  stationId: string;
  stationCode: string;
  stationName: string;
  stationType: "INTERNAL" | "EXTERNAL";
  /** Backend StationKind (RAW_QC/PROCESS_QC/TAMBUR…) — adımı renkten okumak için. */
  stationKind?: string | null;
  notes: string;
  requiredCategoryId: string | null;
  plannedSubcontractorId: string | null;
}

export interface CustomRouteStep {
  /** Mevcut step'i güncelleme için backend smart-merge id'si. */
  id?: string;
  stationId: string;
  notes: string | null;
  requiredCategoryId: string | null;
  plannedSubcontractorId: string | null;
}

export type RouteDesignerResult =
  | { mode: "template"; routeTemplateId: string; fasonPlans: FasonStepPlan[] }
  | { mode: "custom"; customSteps: CustomRouteStep[] };

/**
 * Şablon kodu otomatik üretilir — kullanıcı kod girmez.
 * Format: ad'ın kelime baş harfleri (en fazla 4) + 4 hex karakter.
 * Örn: "Boyahane + Kursun + Tambur" → "BKT-A3F2".
 * Unique constraint (Route.code) çakışmaya karşı güvence.
 */
function generateRouteCode(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]/g, ""))
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 4)
    .join("");
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return initials ? `${initials}-${suffix}` : `RT-${suffix}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Müşteriye bağlı WO ise toggle ile şablon o müşteriye özel kaydedilebilir. */
  customerId?: string | null;
  /** Daha önce designer ile oluşturulmuş custom rota varsa pre-fill için. */
  initialSteps?: DesignerStep[];
  onConfirm: (result: RouteDesignerResult, snapshot: DesignerStep[]) => void;
}

export function RouteDesignerDialog({
  open,
  onOpenChange,
  customerId,
  initialSteps,
  onConfirm,
}: Props) {
  const qc = useQueryClient();
  const {
    steps,
    reset: resetSteps,
    addStep,
    removeStep,
    moveStep,
    updateStep,
    seedFromRoute,
    handleStationPick,
  } = useDesignerSteps(initialSteps);
  const [seedRouteId, setSeedRouteId] = useState<string | null>(null);
  const [pendingSeedId, setPendingSeedId] = useState<string | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [forCustomer, setForCustomer] = useState(false);

  useEffect(() => {
    if (!open) return;
    resetSteps(initialSteps ?? []);
    setSeedRouteId(null);
    setPendingSeedId(null);
    setSaveAsTemplate(false);
    setTemplateName("");
    setForCustomer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSeedConfirmed = async (routeId: string) => {
    await seedFromRoute(routeId);
    setSeedRouteId(routeId);
  };

  const handleSeedChange = (newId: string | null) => {
    if (!newId) return;
    if (steps.length === 0) {
      void handleSeedConfirmed(newId);
    } else {
      setPendingSeedId(newId);
    }
  };

  const createRouteMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: templateName.trim(),
        code: generateRouteCode(templateName),
        customerId: forCustomer && customerId ? customerId : null,
        isActive: true,
        isFavorite: false,
        steps: steps.map((s, i) => ({
          stationId: s.stationId,
          sequence: i + 1,
          defaultNotes: s.notes.trim() || null,
        })),
      };
      return routeService.create(payload as unknown as Partial<ProductionRoute>);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["routes"] });
    },
  });

  const buildFasonPlans = (): FasonStepPlan[] =>
    steps
      .map((s, i) => ({
        sequence: i + 1,
        stationId: s.stationId,
        stationCode: s.stationCode,
        stationName: s.stationName,
        requiredCategoryId: s.requiredCategoryId,
        plannedSubcontractorId: s.plannedSubcontractorId,
        notes: s.notes,
        type: s.stationType,
      }))
      .filter((p) => p.type === "EXTERNAL")
      .map(({ type: _t, ...rest }) => rest);

  const handleConfirm = async () => {
    if (steps.some((s) => !s.stationId)) {
      toast.error("Her adımda bir istasyon seçmelisin.");
      return;
    }
    if (steps.length === 0) {
      toast.error("En az bir adım gerekli.");
      return;
    }

    if (saveAsTemplate) {
      if (!templateName.trim()) {
        toast.error("Şablon adı gerekli.");
        return;
      }
      try {
        const res = await createRouteMut.mutateAsync();
        const newId = res.data.id;
        toast.success(`Şablon oluşturuldu: ${templateName.trim()}`);
        onConfirm(
          {
            mode: "template",
            routeTemplateId: newId,
            fasonPlans: buildFasonPlans(),
          },
          steps,
        );
        onOpenChange(false);
      } catch {
        // apiClient interceptor toast yapar
      }
      return;
    }

    onConfirm(
      {
        mode: "custom",
        customSteps: steps.map((s) => ({
          id: s.serverId ?? undefined,
          stationId: s.stationId,
          notes: s.notes.trim() || null,
          requiredCategoryId: s.requiredCategoryId,
          plannedSubcontractorId: s.plannedSubcontractorId,
        })),
      },
      steps,
    );
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Özel Rota Tasarla</DialogTitle>
            <DialogDescription>
              Bu iş emrine özel rota tasarla. İstersen var olan bir şablondan başla,
              istersen sıfırdan. Sonunda yeni şablon olarak da kaydedebilirsin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Şablondan başlat (opsiyonel)
              </label>
              <ReferenceSelect<ProductionRoute>
                value={seedRouteId}
                onChange={handleSeedChange}
                service={routeService}
                queryKey="routes"
                getLabel={(r) => `${r.name}${r.code ? ` (${r.code})` : ""}`}
                placeholder="Şablondan başla..."
                nullable
                noneLabel="— Boş başla"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Adımlar ({steps.length})</span>
                <Button type="button" size="sm" variant="outline" onClick={addStep} className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Adım Ekle
                </Button>
              </div>
              <div className="max-h-[50vh] space-y-2 overflow-y-auto">
                {steps.length === 0 && (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Henüz adım yok. "Adım Ekle" ile başla veya yukarıdan bir şablon seç.
                  </div>
                )}
                {steps.map((step, idx) => (
                  <RouteDesignerStepRow
                    key={step.clientId}
                    step={step}
                    index={idx}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < steps.length - 1}
                    onMoveUp={() => moveStep(step.clientId, -1)}
                    onMoveDown={() => moveStep(step.clientId, 1)}
                    onRemove={() => removeStep(step.clientId)}
                    onStationPick={(id) => void handleStationPick(step.clientId, id)}
                    onUpdate={(patch) => updateStep(step.clientId, patch)}
                  />
                ))}
              </div>
            </div>

            <RouteDesignerTemplatePanel
              enabled={saveAsTemplate}
              onEnabledChange={setSaveAsTemplate}
              name={templateName}
              onNameChange={setTemplateName}
              customerId={customerId ?? null}
              forCustomer={forCustomer}
              onForCustomerChange={setForCustomer}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={createRouteMut.isPending}
            >
              {createRouteMut.isPending ? "Kaydediliyor..." : "Kullan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingSeedId !== null}
        onOpenChange={(o) => !o && setPendingSeedId(null)}
        title="Mevcut tasarımı sil?"
        description="Yeni şablonun adımları üzerine yazılır. Mevcut özel düzenlemen kaybolur."
        confirmLabel="Yükle"
        destructive
        onConfirm={() => {
          if (pendingSeedId) void handleSeedConfirmed(pendingSeedId);
          setPendingSeedId(null);
        }}
      />
    </>
  );
}
