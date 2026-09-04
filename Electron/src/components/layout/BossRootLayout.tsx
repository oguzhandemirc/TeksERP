import { Navigate, useLocation } from "react-router-dom";
import { TabRootLayout } from "./tabs/TabRootLayout";
import { BossUnavailablePage } from "@/pages/Boss/BossUnavailablePage";
import { isBossAllowedPath } from "@/lib/boss-menu";
import { BOSS_PATH } from "@/lib/boss-path";

/**
 * Özet görünümünün (BossShell) kök layout'u — `TabRootLayout`un kapılı ikizi.
 *
 * Görünürlüğü menüde daraltmak YETMEZ: `content-routes` düz bir liste ve hash
 * ile herhangi bir yola gidilebilir. Menüde çizilmeyen bir yol açılabilir
 * kalırsa daraltma hiç olmamış olur — üstelik en sessiz biçimde (kimse yanlış
 * bir şey görmez, sadece koruma yoktur).
 *
 * ⚠️ KAPI `Outlet`İN ÖNÜNDE. Çocuk rota elemanı hiç MOUNT EDİLMEZ, yani o
 * sayfanın açılış sorguları da atılmaz. Sayfayı çizip üstüne bir kutu basmak,
 * kapatmak istediğimiz yüzeyin isteklerini yine de göndermek olurdu.
 *
 * ⚠️ KÖK (`/`) YÖNLENDİRİLİR, REDDEDİLMEZ. Kök tam panelin Dashboard'ıdır ve
 * özet görünümüne ait değildir, ama oraya kullanıcı TIKLAYARAK gitmez — geri
 * oku ya da bir `replace` düşürebilir. Hata sayfası basmak, kullanıcının
 * yapmadığı bir şey için onu suçlamak olurdu.
 */
export function BossRootLayout() {
  const { pathname } = useLocation();
  if (pathname === "/" || pathname === "") return <Navigate to={BOSS_PATH} replace />;
  if (!isBossAllowedPath(pathname)) return <BossUnavailablePage />;
  return <TabRootLayout />;
}
