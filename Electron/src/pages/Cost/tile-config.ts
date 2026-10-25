// =============================================================================
// MALİYET & TEKLİF HUB KAROLARI (MAL-3)
// =============================================================================
// ⚠️ KARO ile ROUTE AYNI izin listesini taşır (`content-routes` aynası; `test_screen_catalog`).
// Görüntüleme kapısı `cost:read`; yazma (`cost:write` · `cost:settings`) sayfa İÇİNDE `PermissionGate`.
// Menü satırı ayrıca `maliyetEnabled` bayrağına bağlıdır (`nav-config`): modül kapalıysa hiçbiri çizilmez.
// =============================================================================
import { Factory, Layers, SlidersHorizontal, Spool, type LucideIcon } from "lucide-react";

export interface CostTile {
  key: string;
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  tone: string;
  /** Bu izinlerden HERHANGİ biri yeterli — route ile birebir. */
  permissionAny: string[];
}

export const costTiles: CostTile[] = [
  {
    key: "parameters",
    title: "Maliyet Parametreleri",
    description: "Tezgah/işçilik saat ücreti, enerji, fireler, genel gider ve kâr — sürümlü set; yürürlüğe alma eski hesapları değiştirmez.",
    to: "/cost/parameters",
    icon: SlidersHorizontal,
    tone: "text-primary",
    permissionAny: ["cost:read"],
  },
  {
    key: "yarn-prices",
    title: "İplik Maliyet Fiyatları",
    description: "Maliyette kullanılan iplik kg fiyatları — eski fiyat silinmez, damgalanır; 90 günden eski fiyat uyarılır.",
    to: "/cost/yarn-prices",
    icon: Spool,
    tone: "text-station-depo",
    permissionAny: ["cost:read"],
  },
  {
    key: "finishing-rates",
    title: "Fason Tarifeleri",
    description: "Terbiye/boya/apre fason ücretleri (ham ya da mamul metre bazlı) — değişiklik yeni sürümdür, eskisi damgalı kalır.",
    to: "/cost/finishing-rates",
    icon: Factory,
    tone: "text-station-fason",
    permissionAny: ["cost:read"],
  },
  {
    key: "items",
    title: "Maliyet Kartları",
    description: "Kumaş başına yapı durumu, canlı döküm ve kayıtlı standart metre maliyeti; girdi değişince rozet.",
    to: "/cost/items",
    icon: Layers,
    tone: "text-success",
    permissionAny: ["cost:read"],
  },
];


/** Hub ve testin TEK süzgeci: izni olmayan karo çizilmez (`isAdmin` kısa devresi YOK). */
export function visibleCostTiles(hasAnyPermission: (codes: string[]) => boolean): CostTile[] {
  return costTiles.filter((t) => hasAnyPermission(t.permissionAny));
}
