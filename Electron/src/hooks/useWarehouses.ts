// =============================================================================
// DEPO LİSTESİ + "TEK DEPO MU" bayrağı
// =============================================================================
// ⚠️ FABRİKADA SIFIR GÖRÜNÜR FARK KURALININ ARAYÜZ AYAĞI: aktif depo sayısı 1 ise
// hiçbir depo yüzeyi çizilmez (seçici, kolon, filtre, transfer karosu). Tek depolu
// üretici fabrika güncelleme sonrası tek piksel fark görmemeli; ikinci depo
// açıldığı gün yüzeyler kendiliğinden belirir.
//
// Emsal: mobil `PlaceActions.tsx` — makine/bölüm çipi yalnız seçenek sayısı 1'den
// büyükken çizilir ("1 tane varsa değişilecek bir yer YOK, madde anlamsız").
//
// TEK KAYNAK: `multiWarehouse` kararını hiçbir ekran kendi başına hesaplamaz.
// Kopyalanırsa biri gün gelir "aktif" süzgecini unutur ve pasif depolar sayılır.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { warehouseService } from "@/pages/Warehouses/service";
import type { Warehouse } from "@/pages/Warehouses/types";
import { loadAllForPicker } from "@/lib/picker-loader";

export const WAREHOUSES_QUERY_KEY = ["warehouses", "active"] as const;

/** Aktif depolar (ada göre). Depo tanımı nadiren değişir → uzun staleTime. */
export function useWarehouses() {
  return useQuery({
    queryKey: WAREHOUSES_QUERY_KEY,
    queryFn: async (): Promise<Warehouse[]> => {
      // ⚠️ Satır içi `pageSize` YOK: sınır TEK KAYNAKTAN gelir
      // (`loadAllForPicker`). Backend `MAX_PAGE_SIZE` tarihte 100→200→500
      // değişti ve her seferinde satır içi çağrılar 400 üretti.
      const res = await loadAllForPicker(warehouseService, {
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      });
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Çok depolu kurulum mu? Liste yüklenene kadar `false` döner — yani belirsizken
 * yüzey ÇİZİLMEZ. Bilinçli: yanlış tarafa düşmek "fabrikada bir an için depo
 * kolonu belirip kaybolması" demekti; tersi yalnız bir gecikmedir.
 */
export function useMultiWarehouse(): { multiWarehouse: boolean; warehouses: Warehouse[]; isLoading: boolean } {
  const q = useWarehouses();
  const warehouses = q.data ?? [];
  return { multiWarehouse: warehouses.length > 1, warehouses, isLoading: q.isLoading };
}

/** Varsayılan depo (tek depolu kurulumda seçici çizilmeden otomatik seçilir). */
export function useDefaultWarehouse(): Warehouse | null {
  const { warehouses } = useMultiWarehouse();
  return warehouses.find((w) => w.isDefault) ?? warehouses[0] ?? null;
}
