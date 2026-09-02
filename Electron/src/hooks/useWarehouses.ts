// =============================================================================
// DEPO LİSTESİ + "ÇOK DEPOLU MU" bayrağı
// =============================================================================
// ⚠️ FABRİKADA SIFIR GÖRÜNÜR FARK KURALININ ARAYÜZ AYAĞI: çoklu depo modülü
// kapalıysa hiçbir depo yüzeyi çizilmez (seçici, kolon, filtre, transfer karosu).
// Tek depolu üretici fabrika güncelleme sonrası tek piksel fark görmemeli.
//
// ⚠️ 2026-09-02 — KARAR VERİDEN DEĞİL BAYRAKTAN OKUNUR. Eskiden `warehouses.length
// > 1` idi: ikinci depo açan herkes yüzeyleri de açmış oluyordu ve backend'de
// buna karşılık gelen bir kapı yoktu. Artık `depo.multiEnabled` modül anahtarı
// tek kaynak — transfer uçlarındaki `requireDepoMultiEnabled` kapısıyla AYNI
// değeri okur, yani "karo var ama uç 403" (ya da tersi) ayrışması imkânsız.
// Fabrikanın değeri migration'da AKTİF DEPO SAYISINDAN ölçülerek damgalandı,
// yani bu geçiş sahada tek piksel fark üretmez.
//
// TEK KAYNAK: `multiWarehouse` kararını hiçbir ekran kendi başına hesaplamaz —
// hesaplanacak bir şey de kalmadı, okunacak bir bayrak var.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
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
 * Çok depolu kurulum mu (`depo.multiEnabled`)? Bayrak yüklenene kadar `false`
 * döner — yani belirsizken yüzey ÇİZİLMEZ. Bilinçli: yanlış tarafa düşmek
 * "fabrikada bir an için depo kolonu belirip kaybolması" demekti; tersi yalnız
 * bir gecikmedir.
 *
 * ⚠️ `warehouses` dizisi AYNEN döner (seçiciler onu kullanır) — değişen tek şey
 * kararın KAYNAĞI. `isLoading` de depo listesinin yüklenmesidir: seçici çizmeden
 * önce beklenecek şey odur, bayrak değil.
 */
export function useMultiWarehouse(): { multiWarehouse: boolean; warehouses: Warehouse[]; isLoading: boolean } {
  const q = useWarehouses();
  const flagsQuery = useFeatureFlags();
  const warehouses = q.data ?? [];
  const multiWarehouse = flagsQuery.data?.data?.depoMultiEnabled ?? false;
  return { multiWarehouse, warehouses, isLoading: q.isLoading };
}

/** Varsayılan depo (tek depolu kurulumda seçici çizilmeden otomatik seçilir). */
export function useDefaultWarehouse(): Warehouse | null {
  const { warehouses } = useMultiWarehouse();
  return warehouses.find((w) => w.isDefault) ?? warehouses[0] ?? null;
}
