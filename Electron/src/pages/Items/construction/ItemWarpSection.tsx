// Ürün penceresi > Çözgü (B19): çözgü çok kumaşta paylaşılır (devere siparişi / levent ona bağlı) → var olanı seçmek varsayılan.
// "Yeni çözgü kartı" ve "Kopyasını oluştur" Çözgü Kartları formunu iç pencerede açar; kart kendi Kaydet'iyle hemen yazılır,
// bu kumaşa bağ ürün kaydıyla gider. Paylaşılan kartı düzenlemek bütün kumaşları etkiler — bant bunu söyler.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Copy, Pencil, Plus, Ruler } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import { WarpSpecFormDialog } from "@/pages/WarpSpecs/WarpSpecFormDialog";
import { buildPayload, copyDraft } from "@/pages/WarpSpecs/payload";
import type { WarpSpec } from "@/pages/WarpSpecs/types";
import type { WarpSpecFormValues } from "@/pages/WarpSpecs/schema";
import apiClient from "@/services/apiClient";
import { buildQueryString } from "@/lib/query-builder";
import type { PaginatedResponse } from "@/types/api";
import type { ItemFormValues } from "../schema";

type Dialog = { kind: "new" } | { kind: "edit"; spec: WarpSpec } | { kind: "copy"; spec: WarpSpec } | null;

function countWarpUsers(warpSpecId: string) {
  const qs = buildQueryString({ pageSize: 1, filters: { warpSpecId } });
  return apiClient.get<PaginatedResponse<unknown>>(`/api/items${qs}`).then((r) => r.data.pagination.total);
}

export function ItemWarpSection({ form, canWrite, itemId }: { form: UseFormReturn<ItemFormValues>; canWrite: boolean; itemId: string | null }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const warpId = form.watch("warpSpecId");
  const spec = useQuery({ queryKey: ["warp-specs", "detail", warpId], queryFn: () => warpSpecService.getById(warpId).then((r) => r.data), enabled: !!warpId });
  const users = useQuery({ queryKey: ["warp-specs", "users", warpId], queryFn: () => countWarpUsers(warpId), enabled: !!warpId });
  const savedHere = itemId && users.data !== undefined ? 1 : 0;
  const others = Math.max(0, (users.data ?? 0) - savedHere);
  const save = useMutation({
    mutationFn: async (values: WarpSpecFormValues) => {
      const body = buildPayload(values) as unknown as Partial<WarpSpec>;
      return dialog?.kind === "edit" ? warpSpecService.update(dialog.spec.id, body) : warpSpecService.create(body);
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["warp-specs"] });
      if (dialog?.kind !== "edit") {
        form.setValue("warpSpecId", res.data.id, { shouldDirty: true });
        toast.success(`${res.data.code} çözgü kartı açıldı ve bu kumaşa seçildi.`);
      } else toast.success("Çözgü kartı güncellendi.");
      setDialog(null);
    },
  });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <FormField label="Çözgü kartı" info="Dokuma iş emri açarken çözgü kartı bundan ön-dolar; devere siparişi ve levent takibi çözgü kartına bağlıdır">
          <Controller
            control={form.control}
            name="warpSpecId"
            render={({ field }) => (
              <EntityPickerModal<WarpSpec>
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                service={warpSpecService}
                queryKey="warp-specs-item-default"
                getLabel={(w) => w.name}
                getSubLabel={(w) => w.code}
                icon={Ruler}
                nullable
                noneLabel="Çözgü kartı yok"
                placeholder="Çözgü kartı seç"
                quickAddLabel={canWrite ? "Yeni çözgü kartı" : undefined}
                onQuickAdd={canWrite ? () => setDialog({ kind: "new" }) : undefined}
              />
            )}
          />
        </FormField>
        {canWrite && (
          <Button type="button" variant="outline" onClick={() => setDialog({ kind: "new" })}>
            <Plus className="mr-1.5 h-4 w-4" />Yeni çözgü kartı
          </Button>
        )}
      </div>
      {warpId && spec.data && (
        <div className="rounded-md border bg-muted/20 p-4 text-sm" data-testid="warp-summary">
          <p className="font-medium">{spec.data.name} <span className="font-mono text-xs text-muted-foreground">{spec.data.code}</span></p>
          <p className="text-muted-foreground">
            Toplam tel {spec.data.endsCount}
            {spec.data.reedWidthCm != null ? ` · tarak eni ${spec.data.reedWidthCm} cm` : ""}
            {(spec.data.yarns ?? []).length > 0 ? ` · ${(spec.data.yarns ?? []).map((y) => y.yarnItem?.name ?? "iplik").join(", ")}` : ""}
          </p>
          {others > 0 && (
            <Callout tone="warning" className="mt-3" title={`Bu çözgü kartı ${others} kumaşta daha kullanılıyor`}>
              Düzenlerseniz hepsinde değişir. Yalnız bu kumaş için farklı çözgü gerekiyorsa kopyasını oluşturun.
            </Callout>
          )}
          {canWrite && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: "edit", spec: spec.data! })}>
                <Pencil className="mr-1.5 h-4 w-4" />{others > 0 ? `Düzenle (${others + savedHere} kumaşın hepsi)` : "Düzenle"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: "copy", spec: spec.data! })}>
                <Copy className="mr-1.5 h-4 w-4" />Kopyasını oluştur (yalnız bu kumaş)
              </Button>
            </div>
          )}
        </div>
      )}
      {dialog && (
        <WarpSpecFormDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          initial={dialog.kind === "edit" ? dialog.spec : null}
          draft={dialog.kind === "copy" ? copyDraft(dialog.spec) : null}
          isSubmitting={save.isPending}
          onSubmit={(values) => save.mutateAsync(values).then(() => undefined)}
        />
      )}
    </div>
  );
}
