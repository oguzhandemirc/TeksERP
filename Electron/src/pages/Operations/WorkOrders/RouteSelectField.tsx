import { Controller, type Control, type FieldError } from "react-hook-form";
import { Pencil, Plus, Route as RouteIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { routeService } from "@/pages/Routes/service";
import type { ProductionRoute } from "@/pages/Routes/types";
import type { WorkOrderFormValues } from "./schema";

interface Props {
  control: Control<WorkOrderFormValues>;
  error?: FieldError;
  customStepCount: number;
  onOpenDesigner: () => void;
  onClearCustom: () => void;
}

export function RouteSelectField({
  control,
  error,
  customStepCount,
  onOpenDesigner,
  onClearCustom,
}: Props) {
  const hasCustom = customStepCount > 0;

  return (
    <FormField label="Rota" error={error} required={!hasCustom}>
      {hasCustom ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <RouteIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            Özel rota · {customStepCount} adım
          </span>
          <div className="ml-auto flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1"
              onClick={onOpenDesigner}
            >
              <Pencil className="h-3.5 w-3.5" /> Düzenle
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive"
              onClick={onClearCustom}
              aria-label="Temizle"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Controller
              control={control}
              name="routeTemplateId"
              render={({ field }) => (
                <ReferenceSelect<ProductionRoute>
                  value={field.value || undefined}
                  onChange={(v) => field.onChange(v ?? "")}
                  service={routeService}
                  queryKey="routes"
                  getLabel={(r) => r.name}
                  placeholder="Şablon seç..."
                />
              )}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-1"
            onClick={onOpenDesigner}
          >
            <Plus className="h-3.5 w-3.5" /> Özel Rota
          </Button>
        </div>
      )}
    </FormField>
  );
}
