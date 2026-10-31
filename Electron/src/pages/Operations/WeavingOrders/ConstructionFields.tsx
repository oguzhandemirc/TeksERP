// =============================================================================
// DOKUMA İŞ EMRİ FORMU — yapı seçimi + etkin yapı özeti (Seyitoğlu SY-A4, tasarım §2.4/§2.8)
// =============================================================================
// Atkı/desen kartı boş bırakılırsa sunucu ürünün ETKİN YAPISINDAN doldurur (ön dolgu sunucuda, tek
// kaynak); panel ürün kartını okuyup kopyalamaz. Varyant (ürün şablonu) yalnız seçilirse taşınır.
// ⚠️ Uçlar `warpspec:read` (+ varyant için `station:read`) ister: izin yoksa bölüm/seçici hiç çizilmez.
// =============================================================================
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Grid3x3, Layers, Rows3 } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { productRecipeService } from "@/pages/ProductRecipes/service";
import type { ProductRecipe } from "@/pages/ProductRecipes/types";
import {
  fetchEffectiveConstruction,
  weaveDesignPickerService,
  weftSpecPickerService,
  type WeaveDesignRef,
  type WeftSpecRef,
} from "@/pages/Items/construction-service";
import { ConstructionSummary } from "./ConstructionSummary";
import type { WeavingOrderFormValues } from "./schema";

type Form = UseFormReturn<WeavingOrderFormValues>;

function RecipePicker({ form, itemId }: { form: Form; itemId: string }) {
  return (
    <FormField label="Varyant (opsiyonel)" error={form.formState.errors.recipeId} hint="Varyantın değiştirdiği atkı ipliği özete yansır">
      <Controller
        control={form.control}
        name="recipeId"
        render={({ field }) => (
          <EntityPickerModal<ProductRecipe & { variantCode?: string | null }>
            value={field.value || null}
            onChange={(id) => field.onChange(id ?? "")}
            service={productRecipeService}
            queryKey={`product-recipes-weaving-${itemId}`}
            filters={{ itemId, isActive: "true" }}
            getLabel={(r) => (r.variantCode ? `${r.variantCode} · ${r.name}` : r.name)}
            getSubLabel={(r) => r.code}
            icon={Layers}
            nullable
            noneLabel="Varyant yok"
            title="Varyant seç"
            placeholder="Varyant yok"
          />
        )}
      />
    </FormField>
  );
}

/** Ürün değişince önceki ürünün varyantı/kartları formda kalmasın (sunucu yeni ürünün kartını türetir). */
function useResetOnItemChange(form: Form, itemId: string): void {
  const prev = useRef(itemId);
  useEffect(() => {
    if (prev.current && prev.current !== itemId) {
      for (const k of ["recipeId", "weftSpecId", "weaveDesignId"] as const) form.setValue(k, "", { shouldDirty: true });
    }
    prev.current = itemId;
  }, [form, itemId]);
}

/** `initialItemId`: düzenlenen kaydın ürünü (oluştururken null) — boş alanın anlamını belirler. */
export function ConstructionFields({ form, initialItemId = null }: { form: Form; initialItemId?: string | null }) {
  const { hasPermission } = useRoleAccess();
  const canRead = hasPermission("warpspec:read");
  const itemId = form.watch("itemId");
  useResetOnItemChange(form, itemId);
  // Düzenlemede (ürün aynıyken) boş alan açık null = "kartsız"; oluştururken/ürün değişince ürünün kartı.
  const derives = !initialItemId || initialItemId !== itemId;
  const weftNone = derives ? "Ürünün atkı kartı" : "Kartsız";
  const designNone = derives ? "Ürünün desen kartı" : "Kartsız";
  const recipeId = form.watch("recipeId") || null;
  const q = useQuery({
    queryKey: ["item-construction", itemId, recipeId],
    queryFn: () => fetchEffectiveConstruction(itemId, recipeId),
    enabled: canRead && Boolean(itemId),
    staleTime: 30_000,
  });
  if (!canRead) return null;
  const err = form.formState.errors;
  return (
    <>
      {itemId && hasPermission("station:read") && <RecipePicker form={form} itemId={itemId} />}
      <ConstructionSummary data={q.data} loading={q.isLoading && Boolean(itemId)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Atkı kartı" error={err.weftSpecId} hint={derives ? "Boş = ürünün atkı kartı" : "Boş = kartsız"}>
          <Controller
            control={form.control}
            name="weftSpecId"
            render={({ field }) => (
              <EntityPickerModal<WeftSpecRef>
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                service={weftSpecPickerService}
                queryKey="weft-specs-weaving"
                getLabel={(w) => w.name}
                getSubLabel={(w) => w.code}
                icon={Rows3}
                nullable
                noneLabel={weftNone}
                title="Atkı kartı seç"
                placeholder={weftNone}
              />
            )}
          />
        </FormField>
        <FormField label="Desen kartı" error={err.weaveDesignId} hint={derives ? "Boş = ürünün desen kartı" : "Boş = kartsız"}>
          <Controller
            control={form.control}
            name="weaveDesignId"
            render={({ field }) => (
              <EntityPickerModal<WeaveDesignRef>
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                service={weaveDesignPickerService}
                queryKey="weave-designs-weaving"
                getLabel={(d) => d.name}
                getSubLabel={(d) => d.code}
                icon={Grid3x3}
                nullable
                noneLabel={designNone}
                title="Desen kartı seç"
                placeholder={designNone}
              />
            )}
          />
        </FormField>
      </div>
    </>
  );
}
