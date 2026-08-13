// =============================================================================
// KAT KATALOĞU — tek okuma noktası (2026-08-10)
// =============================================================================
// Kat değerleri artık kodda DEĞİL, `FabricProperty(code="KAT")` altındaki
// `FabricPropertyValue` satırlarında. Bu dosyadan önce aynı `["2-KAT","4-KAT"]`
// dizisi Electron'da ÜÇ, mobilde BEŞ yerde tekrarlanıyordu; fabrika "6-KAT"
// ekleyince üç projede kod değişikliği gerekiyordu.
//
// ⚠️ Buraya varsayılan bir liste (fallback) KOYMA. Katalog okunamıyorsa doğru
// davranış boş liste ve ekranda görünür bir uyarıdır — sabit iki tuş basmak,
// panelden eklenmiş 6-KAT'ı sessizce yok saymak demektir ve kullanıcı sebebini
// hiçbir yerde göremez.
// =============================================================================

import { fabricPropertyService } from "@/pages/FabricProperties/service";
import type { FabricProperty, FabricPropertyValue } from "@/pages/FabricProperties/types";

/** Kat değerlerini taşıyan katalog satırının kodu — backend ile aynı sabit. */
export const FOLD_PROPERTY_CODE = "KAT";

/** react-query anahtarı — tüm kat tüketicileri AYNI cache satırını paylaşsın. */
export const FOLD_CATALOG_QUERY_KEY = ["fabric-properties", "fold-catalog"] as const;

/**
 * Aktif kat değerlerini sıralı döner. Katalog satırı yoksa BOŞ dizi —
 * çağıran "kat tanımlı değil" durumunu ekranda söylemeli.
 */
export async function loadFoldValues(): Promise<FabricPropertyValue[]> {
  const res = await fabricPropertyService.getAll({
    page: 1,
    pageSize: 5,
    sortBy: "sortOrder",
    sortOrder: "asc",
    // Tam-eşleşme aramak yerine kod filtresi: `search` ad/açıklamada da
    // eşleşip yanlış satır getirebilir.
    filters: { code: FOLD_PROPERTY_CODE, isActive: "true" },
  });
  const rows = (res.data ?? []) as FabricProperty[];
  const prop = rows.find((p) => p.code === FOLD_PROPERTY_CODE);
  return (prop?.values ?? []).filter((v) => v.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
}
