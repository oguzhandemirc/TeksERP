import { Navigate } from "react-router-dom";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useKursunVisibility } from "@/hooks/useKursunVisibility";
import { kursunQueueTileVisible } from "../tile-config";
import { KursunQueuePage } from "./KursunQueuePage";

/**
 * Kurşun Sırası ROUTE KAPISI — ekran, KAROSUYLA AYNI koşulda açılır:
 *   görünür ⇔ bayrak KAPALI **VEYA** tablet rejiminde açık kurşun adımı VAR.
 *
 * Karoyu gizlemek yetmez: komut paleti ve doğrudan adres (`#/operations/
 * kursun-queue`) route'u yine açardı. Bu yüzden kural iki yerde de UYGULANIR ama
 * TEK yerde YAZILIR — `tile-config.ts` → `kursunQueueTileVisible` (kural + tam
 * gerekçe orada). Kopyalanan ikinci bir koşul zamanla ilkinden ayrışırdı.
 *
 * Bayrak açıkken tablette DOKUNULMUŞ işler dağıtılamaz ve tablet rejiminde kalır;
 * onlar bitene kadar planlamacının sıralama/acil işaretleme yapabilmesi gerekir →
 * sayfa AÇILABİLİR. Yönlendirme Kurşun Dağıtım'a DEĞİL hub'a yapılır (kullanıcının
 * `workorder:distribute` izni olmayabilir; hub yetkiye göre neyin açık olduğunu
 * zaten gösterir).
 *
 * ⚠️ YÜKLEME ANI MENÜDEN FARKLI: menü sayaçları 0 kabul edip saf bayrak kuralıyla
 * çizer (karo titremesin), route ise VERİYİ BEKLER (hiçbir şey render etmez).
 * Asimetri bilinçli — geç gelen karo saniyeler içinde kendiliğinden belirir, ama
 * hatalı bir yönlendirme kullanıcıyı açtığı sayfadan atar ve geri dönüşü elledir.
 * `isLoading` yalnız İLK yüklemede true'dur; sorgu hata verirse ya da yetki
 * nedeniyle hiç koşmazsa false döner → kapı boş ekranda asılı kalmaz.
 */
export function KursunQueueRouteGate() {
  const flags = useFeatureFlags();
  const kursun = useKursunVisibility();

  if (flags.isLoading || kursun.isLoading) return null;

  const allowed = kursunQueueTileVisible({
    kursunBypassEnabled: kursun.flagEnabled,
    kursunPendingAssignmentCount: kursun.pendingAssignmentCount,
    kursunTabletRegimeCount: kursun.tabletRegimeCount,
  });

  if (!allowed) return <Navigate to="/operations" replace />;
  return <KursunQueuePage />;
}
