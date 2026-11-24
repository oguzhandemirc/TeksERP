// Cari kartı → fason rolü + kategorileri, kart KAYDEDİLİRKEN yazılır (tek kayıt modeli, B18/7): düzenlemede
// "Fason iş yapar" ve kategori seçimi form değeridir; Kaydet önce kartı (rol bayrakları) sonra profili yazar —
// profil açmak Tedarikçi rolünü ister (sunucu 400), sıra bu yüzden kart → profil. İptal hiçbir şey yazmaz.
// Profil SİLİNMEZ: kaldırma `isActive:false`, yeniden açma aynı profili aktife döndürür (ikinci profil doğmaz).
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { CustomerFormValues } from "./schema";
import type { Customer } from "./types";

export interface SubcontractorIntent {
  want: boolean;
  /** undefined = kategorilere dokunulmadı (sunucu kümesi korunur). */
  categoryIds?: string[];
}

/** Formda fason tarafı değiştiyse niyet; değişmediyse null (profil uçlarına hiç gidilmez). */
export function subcontractorIntentOf(v: CustomerFormValues, initial: Customer): SubcontractorIntent | null {
  const roleChanged = v.isSubcontractorRole !== (initial.isSubcontractorRole === true);
  if (!roleChanged && v.subcontractorCategoryIds === undefined) return null;
  return { want: v.isSubcontractorRole, categoryIds: v.subcontractorCategoryIds };
}

/** Kartın fason profili (aktif ya da pasif) — bağ `customerId`. */
export async function fetchSubcontractorProfile(customerId: string): Promise<Subcontractor | null> {
  const res = await subcontractorService.getAll({ page: 1, pageSize: 1, sortBy: "name", sortOrder: "asc", filters: { customerId } });
  return (res.data[0] as Subcontractor | undefined) ?? null;
}

/** Niyeti profile uygular (kart kaydından SONRA). Yeni profilin ad/vergi/telefon/adresi formun kaydedilen değerinden. */
export async function syncSubcontractorRole(customer: Customer, v: CustomerFormValues, intent: SubcontractorIntent): Promise<void> {
  const p = await fetchSubcontractorProfile(customer.id);
  const cats = intent.categoryIds ? { categoryIds: intent.categoryIds } : {};
  if (!intent.want) {
    if (p?.isActive) await subcontractorService.update(p.id, { isActive: false } as Partial<Subcontractor>);
    return;
  }
  if (!p) {
    await subcontractorService.create({
      code: customer.code,
      name: v.name.trim(),
      taxNumber: v.taxNumber?.trim() || null,
      phone: v.contactPhone?.trim() || null,
      address: v.address?.trim() || null,
      customerId: customer.id,
      ...cats,
    } as Partial<Subcontractor>);
    return;
  }
  const patch = { ...(p.isActive ? {} : { isActive: true }), ...cats };
  if (Object.keys(patch).length > 0) await subcontractorService.update(p.id, patch as Partial<Subcontractor>);
}
