// =============================================================================
// CARİ KARTI — Fason bölümü (fason = carinin rolü, kullanıcı kararı 2026-09-17)
// =============================================================================
// "Fason iş yapar" düğmesi Yeni Cari'de olduğu gibi düzenlemede de Kimlik › Roller satırındadır (B18/2, tek yer);
// bu bölüm yalnız profilin durumu + kategori seçimini taşır. Tek kayıt modeli (B18/7): rol ve kategoriler form
// değeridir, Kaydet kartla birlikte yazar (`subcontractorRoleSync`), İptal geri alır. Profil SİLİNMEZ — rol
// kaldırılınca `isActive:false` (sevk/kabul tarihçesi ona bağlı). Profil penceresi (belge profili, ücretler) ayrı kayıttır.
// =============================================================================
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormContext } from "react-hook-form";
import { partnerRoleLabels } from "@/lib/partnerRoles";
import type { CustomerFormValues } from "./schema";
import type { Customer } from "./types";
import { CustomerSubcontractorCategories } from "./CustomerSubcontractorCategories";
import { SubcontractorProfileEdit } from "./SubcontractorProfileEdit";
import { fetchSubcontractorProfile } from "./subcontractorRoleSync";

export const SUBCONTRACTOR_ROLE_LABEL = "Fason iş yapar";
export const SUBCONTRACTOR_ROLE_TYPE_HINT = `Fason profili için kartın ${partnerRoleLabels.supplier} rolü olmalı.`;
export const SUBCONTRACTOR_ROLE_OFF_HINT = `Kimlik › Roller satırında "${SUBCONTRACTOR_ROLE_LABEL}" seçilince fason kategorileri burada seçilir.`;

/** Bu carinin fason profili (aktif ya da pasif) — bağ `customerId` üzerinden, liste süzgeciyle. */
export function useSubcontractorProfile(customerId: string) {
  return useQuery({ queryKey: ["subcontractor-profile", customerId], queryFn: () => fetchSubcontractorProfile(customerId), staleTime: 30_000 });
}

export function CustomerSubcontractorRole({ customer }: { customer: Customer }) {
  const qc = useQueryClient();
  const form = useFormContext<CustomerFormValues>();
  const profile = useSubcontractorProfile(customer.id);
  const on = form.watch("isSubcontractorRole");
  const draftCats = form.watch("subcontractorCategoryIds");
  const p = profile.data ?? null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["subcontractor-profile", customer.id] });
    void qc.invalidateQueries({ queryKey: ["subcontractors"] });
  };

  if (!on) {
    return (
      <p className="text-xs text-muted-foreground">
        {SUBCONTRACTOR_ROLE_OFF_HINT}
        {p ? <> Önceki profil <span className="font-mono">{p.code}</span> {p.isActive ? "Kaydet ile pasife alınır (silinmez)." : "pasif; yeniden seçilirse aynı profil açılır."}</> : null}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {p ? (
          <>
            Fason profili: <span className="font-mono">{p.code}</span>
            {p.isActive ? "" : " (pasif — Kaydet ile yeniden açılır)"} — <SubcontractorProfileEdit profile={p} onSaved={refresh} />
          </>
        ) : (
          "Kaydet'e basınca bu kart için fason profili açılır (belge profili ve ücretler sonra profil penceresinden)."
        )}
      </p>
      <CustomerSubcontractorCategories
        value={draftCats ?? (p?.categories ?? []).map((c) => c.categoryId)}
        onChange={(ids) => form.setValue("subcontractorCategoryIds", ids, { shouldDirty: true })}
        disabled={profile.isLoading}
      />
    </div>
  );
}
