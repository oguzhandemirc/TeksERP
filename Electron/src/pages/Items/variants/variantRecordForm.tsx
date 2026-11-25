// Varyant (kumaşın iş emri şablonu, `ProductRecipe.variantCode`) kayıt formu sözleşmesi: Yeni · Örnek al · Düzenle.
// Şablon ortak kayıttır (iş emirleri ondan doğar) → Düzenle İş Emri Şablonları ekranına götürür (yerinde düzenleme yok);
// Örnek al kaynağı değiştirmez (taslak kimliksiz, yalnız create).
import { useMemo } from "react";
import type { RecordFormService, RecordFormSpec } from "@/components/forms/record-form/types";
import apiClient from "@/services/apiClient";
import { TERIM } from "@/lib/terim";
import type { ApiResponse } from "@/types/api";
import type { DesignVariant } from "@/pages/WeaveDesigns/types";
import { VariantFormDialog } from "./VariantFormDialog";

export interface VariantFabric { id: string; code: string; name: string; allowedColorIds: string[] }
export interface VariantBody { itemId: string; variantCode: string; name: string; colorId: string | null; finishingRateCode: string | null }

const variantService: RecordFormService<DesignVariant> = {
  create: (data) => apiClient.post<ApiResponse<DesignVariant>>("/api/product-recipes", data).then((r) => r.data),
  update: (id, data) => apiClient.patch<ApiResponse<DesignVariant>>(`/api/product-recipes/${id}`, data).then((r) => r.data),
};

export function useVariantRecordForm(fabric: VariantFabric): RecordFormSpec<DesignVariant> {
  const { id, code, name } = fabric;
  const colorsKey = fabric.allowedColorIds.join(",");
  return useMemo<RecordFormSpec<DesignVariant>>(() => {
    const f: VariantFabric = { id, code, name, allowedColorIds: colorsKey ? colorsKey.split(",") : [] };
    return {
      entityName: "Varyant",
      service: variantService,
      writePermission: "station:write", // İş Emri Şablonları ekranı ile aynı
      invalidateKeys: ["product-recipes"],
      templateRule: { clear: ["code", "variantCode"], suggestCopy: ["name"] },
      cardPath: (v) => `/definitions/product-recipes?search=${encodeURIComponent(v.code || v.name)}`,
      renderForm: ({ open, onOpenChange, draft, onSubmit, isSubmitting }) => (
        <VariantFormDialog
          open={open}
          onOpenChange={onOpenChange}
          fabric={f}
          draft={draft as Partial<DesignVariant> | null}
          isSubmitting={isSubmitting}
          onSubmit={(body) => onSubmit(body as unknown as Partial<DesignVariant>)}
        />
      ),
    };
  }, [id, code, name, colorsKey]);
}

/** İş emri şablonunun rejime göre adı ("Terbiye iş emri şablonu" / "Dokuma …") — yetki notunda. */
export const variantTemplateNoun = () => `${TERIM.terbiyeIsEmri.tekilKucuk} şablonu`;
