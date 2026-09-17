// =============================================================================
// CARİ KARTI — "Fason iş yapar" (fason = carinin rolü, kullanıcı kararı 2026-09-17)
// =============================================================================
// Kart kaydedildikten sonra (düzenleme) görünür: kutu işaretlenince profil yoksa `Subcontractor`
// yaratılır (ad/kod/vergi no/telefon/adres cariden, `customerId` bağ), pasif profil varsa aktife
// döner; kaldırılınca profil `isActive:false` (SİLİNMEZ — sevk/kabul tarihçesi ona bağlı).
// Tedarikçi ROLÜ olmayan kartta kutu pasif: önce Tedarikçi rolü (backend 400 ile aynı kural, rol modeli).
// Anında sunucuya yazar (alias panelleri emsali); hata apiClient tek toast.
// =============================================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { partnerRoleLabels } from "@/lib/partnerRoles";
import type { Customer } from "./types";

export const SUBCONTRACTOR_ROLE_LABEL = "Fason iş yapar";
export const SUBCONTRACTOR_ROLE_TYPE_HINT = `Fason profili için kartın ${partnerRoleLabels.supplier} rolü olmalı (önce Tedarikçi kutusunu işaretleyip kaydedin).`;
export const SUBCONTRACTORS_PATH = "/definitions/subcontractors";

/** Bu carinin fason profili (aktif ya da pasif) — bağ `customerId` üzerinden, liste süzgeciyle. */
export function useSubcontractorProfile(customerId: string) {
  return useQuery({
    queryKey: ["subcontractor-profile", customerId],
    queryFn: async () => {
      const res = await subcontractorService.getAll({ page: 1, pageSize: 1, sortBy: "name", sortOrder: "asc", filters: { customerId } });
      return (res.data[0] as Subcontractor | undefined) ?? null;
    },
    staleTime: 30_000,
  });
}

export function CustomerSubcontractorRole({ customer }: { customer: Customer }) {
  const qc = useQueryClient();
  const profile = useSubcontractorProfile(customer.id);
  const typeOk = customer.isSupplierRole === true;
  const checked = profile.data?.isActive === true;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["subcontractor-profile", customer.id] });
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["subcontractors"] });
    void qc.invalidateQueries({ queryKey: ["supplier-picker"] });
  };
  const mut = useMutation({
    mutationFn: async (on: boolean) => {
      const p = profile.data;
      if (on && !p) {
        return subcontractorService.create({
          code: customer.code,
          name: customer.name,
          taxNumber: customer.taxNumber ?? null,
          phone: customer.contactPhone ?? null,
          address: customer.address ?? null,
          customerId: customer.id,
        } as Partial<Subcontractor>);
      }
      if (!p) return null;
      return subcontractorService.update(p.id, { isActive: on } as Partial<Subcontractor>);
    },
    onSuccess: (_res, on) => {
      toast.success(on ? "Fason profili açıldı" : "Fason profili pasife alındı (kayıt silinmedi)");
      refresh();
    },
  });
  const disabled = !typeOk || profile.isLoading || mut.isPending;
  return (
    <div className="space-y-1 rounded-md border p-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => mut.mutate(e.target.checked)} aria-describedby="fason-rol-ipucu" />
        {SUBCONTRACTOR_ROLE_LABEL}
      </label>
      <p id="fason-rol-ipucu" className="text-xs text-muted-foreground">
        {!typeOk
          ? SUBCONTRACTOR_ROLE_TYPE_HINT
          : profile.data
            ? <>Fason profili: <span className="font-mono">{profile.data.code}</span>{profile.data.isActive ? "" : " (pasif)"} — <Link className="underline underline-offset-2" to={SUBCONTRACTORS_PATH}>fason firmaları sayfasında aç</Link></>
            : "İşaretlenince bu kart için fason profili açılır (kategori ve belge profili fason sayfasından düzenlenir)."}
      </p>
    </div>
  );
}
