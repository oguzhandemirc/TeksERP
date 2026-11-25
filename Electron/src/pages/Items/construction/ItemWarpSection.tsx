// Ürün penceresi > Çözgü (B19): çözgü çok kumaşta paylaşılır (devere siparişi / levent ona bağlı) → var olanı seçmek varsayılan.
// Burası çözgü kartının KULLANIM YERİ (kullanıcı 2026-11-25: override yalnız tanımın asıl yerinden): Yeni ve Örnek al serbest;
// Düzenle yalnız başka kumaşta kullanılmayan kartta yerinde, paylaşılan kartta "Çözgü Kartları ekranında aç" / "Örnek al".
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Copy, Pencil, Plus, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { useRecordForm } from "@/components/forms/record-form/useRecordForm";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import { useWarpSpecRecordForm } from "@/pages/WarpSpecs/useWarpSpecRecordForm";
import type { WarpSpec } from "@/pages/WarpSpecs/types";
import apiClient from "@/services/apiClient";
import { buildQueryString } from "@/lib/query-builder";
import type { PaginatedResponse } from "@/types/api";
import type { ItemFormValues } from "../schema";

function countWarpUsers(warpSpecId: string) {
  const qs = buildQueryString({ pageSize: 1, filters: { warpSpecId } });
  return apiClient.get<PaginatedResponse<unknown>>(`/api/items${qs}`).then((r) => r.data.pagination.total);
}

export function ItemWarpSection({ form, canWrite, itemId }: { form: UseFormReturn<ItemFormValues>; canWrite: boolean; itemId: string | null }) {
  const warpId = form.watch("warpSpecId");
  const spec = useQuery({ queryKey: ["warp-specs", "detail", warpId], queryFn: () => warpSpecService.getById(warpId).then((r) => r.data), enabled: !!warpId });
  const users = useQuery({ queryKey: ["warp-specs", "users", warpId], queryFn: () => countWarpUsers(warpId), enabled: !!warpId });
  const savedHere = itemId && users.data !== undefined ? 1 : 0;
  const others = Math.max(0, (users.data ?? 0) - savedHere);
  // Yalnız bu kumaşa ait = seçili kart + kullanım sayısı ÖLÇÜLDÜ + başka kumaş yok; bilinmeyen her durumda kilitli.
  const exclusive = useCallback(
    (row: WarpSpec) => row.id === warpId && users.data !== undefined && others === 0,
    [warpId, users.data, others],
  );
  const recordSpec = useWarpSpecRecordForm(exclusive);
  const select = (saved: WarpSpec) => form.setValue("warpSpecId", saved.id, { shouldDirty: true });
  const record = useRecordForm(recordSpec, select);
  const showActions = canWrite && record.canWrite;
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
                title="Çözgü kartı seç"
                placeholder="Çözgü kartı seç"
                recordForm={canWrite ? recordSpec : undefined}
              />
            )}
          />
        </FormField>
        {showActions && (
          <Button type="button" variant="outline" onClick={record.openCreate}>
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
              Ortak kart burada değiştirilmez: değişiklik Çözgü Kartları ekranında yapılır. Yalnız bu kumaş için farklı çözgü gerekiyorsa örnek alarak yeni kart açın.
            </Callout>
          )}
          {showActions && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => record.openEdit(spec.data!)}>
                <Pencil className="mr-1.5 h-4 w-4" />Düzenle
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void record.openTemplate(spec.data!)}>
                <Copy className="mr-1.5 h-4 w-4" />Örnek al (yalnız bu kumaş)
              </Button>
            </div>
          )}
        </div>
      )}
      {record.element}
    </div>
  );
}
