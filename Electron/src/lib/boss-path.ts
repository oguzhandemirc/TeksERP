/**
 * Patron özetinin yolu — TEK KAYNAK.
 *
 * Üç tüketicisi var ve elle yazılsaydı biri değişince arıza SESSİZ olurdu:
 *  ① `App.tsx` kapısı (hangi kabuk çizilecek),
 *  ② `content-routes` kaydı (sayfanın kendisi),
 *  ③ `BossShell`in açılış girişi.
 * Kapı ile rota ayrışırsa kabuk açılır ama içi boş kalır — hata da log da yok.
 */
export const BOSS_PATH = "/boss";
