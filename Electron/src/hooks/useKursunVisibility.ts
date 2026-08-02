import { useQuery } from "@tanstack/react-query";
import { kursunDagitimService } from "@/pages/Operations/KursunDagitim/service";
import { useKursunBypassEnabled } from "./usePricingEnabled";
import { useRoleAccess } from "./useRoleAccess";

/**
 * `["kursun-bypass", ...]` ÖN EKİ BİLİNÇLİ: Kurşun Dağıtım ekranının `refresh()`'i
 * `invalidateQueries({ queryKey: ["kursun-bypass"] })` ile ön ek bazlı geçersiz
 * kılıyor → dağıt/iptal/bitir sonrası menü sayaçları ayrı bir invalidate satırı
 * yazmaya gerek kalmadan tazelenir (biri eklenip diğeri unutulamaz).
 */
export const KURSUN_VISIBILITY_QUERY_KEY = ["kursun-bypass", "visibility"] as const;

/**
 * Sayaçları çözebilmek için gereken izinler. Backend ucu daha GENİŞ
 * (`quality:read` + mobil izinler de kabul eder) ama burada dar tutmak doğru:
 * bu iki sayının Electron'daki TEK tüketicisi Kurşun Sırası (`quality:write` |
 * `workorder:distribute`) ve Kurşun Dağıtım (`workorder:distribute`) karolarıdır.
 * Bu izinlerden hiçbiri yoksa iki karo da zaten izin filtresine takılıyor →
 * isteği hiç atma (her hub açılışında boşa 403 + toast üretirdi).
 */
const VISIBILITY_PERMISSIONS = ["quality:write", "workorder:distribute"];

export interface KursunVisibility {
  /** `production.kursunBypassEnabled` — YENİ dağıtım açık mı. */
  flagEnabled: boolean;
  /** Açık (bekleyen) dağıtım sayısı. Veri yokken 0. */
  pendingAssignmentCount: number;
  /** Tablet rejiminde bekleyen kurşun adımı sayısı. Veri yokken 0. */
  tabletRegimeCount: number;
  /**
   * Sayaçlar HENÜZ bilinmiyor (ilk yükleme sürüyor). MENÜ bunu umursamaz —
   * 0'lara düşüp saf bayrak kuralıyla çizer, karo titremesin. ROUTE kapısı ise
   * umursar: yanlış yönlendirme kullanıcıyı sayfadan atar, gizli karo ise
   * saniyeler içinde kendiliğinden düzelir (bkz. `KursunQueueRouteGate`).
   */
  isLoading: boolean;
}

/**
 * Kurşun ekranlarının "işi kaldı mı" sayaçları — `GET /api/kursun-bypass/visibility`.
 *
 * Neden hook: iki KARO ve bir ROUTE kapısı aynı üç sayıya bakıyor; kural tek
 * yerde (`tile-config.ts`) yaşasın diye veri de tek yerden gelir.
 *
 * ⚠️ `flagEnabled` bilinçli olarak BU UÇTAN OKUNMAZ, feature-flag cache'inden
 * gelir. İki gerekçe: (1) bayrak zaten uygulama genelinde tek kaynaktan
 * (`useFeatureFlags`) okunuyor — ikinci bir kaynak, ikisi anlık ayrışınca
 * "menüde var, sayfada yok" tipi tuhaflık doğurur; (2) admin bayrağı Genel
 * Ayarlar'dan çevirdiğinde feature-flag sorgusu ANINDA invalidate edilir,
 * bu uç ise `staleTime` dolana kadar eski değeri taşır — yani feature-flag
 * tarafı hem tek kaynak hem daha taze. Uçtaki `flagEnabled` alanı yine de
 * tiplenir (mobil aynı payload'ı bayrak kaynağı olarak kullanır).
 */
export function useKursunVisibility(): KursunVisibility {
  const { hasAnyPermission } = useRoleAccess();
  const flagEnabled = useKursunBypassEnabled();
  const enabled = hasAnyPermission(VISIBILITY_PERMISSIONS);

  const query = useQuery({
    queryKey: KURSUN_VISIBILITY_QUERY_KEY,
    queryFn: () => kursunDagitimService.getVisibility(),
    enabled,
    // Menü çizme verisi: hub her açıldığında yeniden istek atmasın, ama
    // dağıtım bitince bir dakikayı bulmadan kendiliğinden düşsün.
    staleTime: 45_000,
  });

  const data = query.data?.data;
  return {
    flagEnabled,
    // Hata / yetkisiz / yüklenirken 0: karar saf bayrak kuralına düşer.
    pendingAssignmentCount: data?.pendingAssignmentCount ?? 0,
    tabletRegimeCount: data?.tabletRegimeCount ?? 0,
    // `isLoading` = ilk yükleme (pending + fetching). Sorgu `enabled:false` iken
    // ya da hata sonrası FALSE'tur → bekleyen taraf sonsuza kadar asılı kalmaz.
    isLoading: query.isLoading,
  };
}
