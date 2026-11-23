// =============================================================================
// MALİYET & TEKLİF HUB KAROLARI (MAL-3)
// =============================================================================
// ⚠️ KARO ile ROUTE AYNI izin listesini taşır (`content-routes` aynası; `test_screen_catalog`).
// Görüntüleme kapısı `cost:read` (teklif `quote:read`, fiyat listesi `price-list:read`); yazma sayfa İÇİNDE `PermissionGate`.
// Menü satırı ayrıca `maliyetEnabled` bayrağına bağlıdır (`nav-config`): modül kapalıysa hiçbiri çizilmez.
// =============================================================================
import { Calculator, Coins, Cog, FileSignature, Layers, ListOrdered, SlidersHorizontal, Spool, TrendingUp, type LucideIcon } from "lucide-react";

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
    key: "input-prices",
    title: "Girdi Fiyatları",
    description: "İplik kg fiyatları, fason tarifeleri, ek maliyet formülleri ve hizmet sarf normları — her değişiklik yeni sürümdür, eskisi damgalı kalır.",
    to: "/cost/input-prices",
    icon: Coins,
    tone: "text-station-depo",
    permissionAny: ["cost:read"],
  },
  {
    key: "machine-rates",
    title: "Makine Saat Ücretleri",
    description: "Kârlılıkta makineye giden maliyet: makine başına saat ücreti (TL) ve beklenen metre/saat — değişiklik şu andan itibaren geçerli, eskisi damgalı kalır.",
    to: "/cost/machine-rates",
    icon: Cog,
    tone: "text-station-depo",
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
  {
    key: "calculator",
    title: "Hızlı Hesaplayıcı",
    description: "Bir kumaşın ya da elle kurulan yapının metre maliyetini kaydetmeden deneyin — ezmeler ve kur ile canlı döküm.",
    to: "/cost/calculator",
    icon: Calculator,
    tone: "text-info",
    permissionAny: ["cost:read"],
  },
  {
    key: "quotes",
    title: "Teklifler",
    description: "Müşteriye fiyat teklifi: kart ürünü ya da yeni desen, sunucu fiyat önerir; gönder → kabul → tek tıkla sipariş. Gönderilen teklif değişmez, revizyon açılır.",
    to: "/cost/quotes",
    icon: FileSignature,
    tone: "text-primary",
    permissionAny: ["quote:read"],
  },
  {
    key: "price-lists",
    title: "Fiyat Listeleri",
    description: "Genel ya da müşteriye özel dövizli satış fiyatları; standart maliyetten doldurulur, yayındaki liste teklif fiyat önerisinin ilk kaynağıdır.",
    to: "/cost/price-lists",
    icon: ListOrdered,
    tone: "text-success",
    permissionAny: ["price-list:read"],
  },
  {
    key: "yarn-need",
    title: "İplik İhtiyaç Planı",
    description: "Açık siparişleri dokumak için hangi iplikten kaç kg lazım (çözgü/atkı ayrı); serbest stok, açık alış ve hazır levent düşülünce eksik ne?",
    to: "/cost/yarn-need",
    icon: Spool,
    tone: "text-warning",
    permissionAny: ["report:yarn-need"],
  },
  {
    key: "karlilik",
    title: "Kârlılık",
    description: "Hangi müşteri, hangi işlem, hangi ay ne kazandırdı: kesinleşen gelirden ipe, makineye ve dışarıya giden çıkınca kalan; eksik girdiler rozetli.",
    to: "/reports/maliyet/karlilik",
    icon: TrendingUp,
    tone: "text-success",
    permissionAny: ["cost:read"],
  },
];


/**
 * Hub ve testin TEK süzgeci: izni olmayan karo çizilmez (`isAdmin` kısa devresi YOK). `routeOpen` verilirse bağlı
 * modülü kapalı karo da düşer (K19: Kârlılık finans ister — `lib/route-modules.ts` `ROUTE_ALSO_REQUIRES`).
 */
export function visibleCostTiles(hasAnyPermission: (codes: string[]) => boolean, routeOpen: (to: string) => boolean = () => true): CostTile[] {
  return costTiles.filter((t) => hasAnyPermission(t.permissionAny) && routeOpen(t.to));
}
