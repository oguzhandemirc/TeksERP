import { authService } from "@/services/authService";
import { canEnterApp, type AuthMeResponse, type JwtPayload } from "@/types/auth";

/**
 * WEB AÇILIŞ YOKLAMASI (bulut web paneli, sözleşme `docs/design/BULUT-WEB-PANELI.md`).
 *
 * Webde kimlik httpOnly çerezdedir; istemci JWT görmez, çözmez. Açılışta `GET /api/auth/me`
 * oturumu yoklar. Oturum yok sayılan üç durum (hepsi giriş ekranına düşer):
 *   • 401 / ağ hatası — çerez yok, süresi dolmuş ya da sunucuya ulaşılamıyor;
 *   • `mustChangePassword` — kısıtlı oturum uygulamaya girmez, yeni girişte adım yeniden açılır;
 *   • masaüstü izni yok — giriş akışındaki `canEnterApp` kapısının aynası.
 * `/me` `exp` taşımaz: mutlak süre bitiminde sunucunun 401'i oturumu kapatır.
 */
export async function probeWebSession(): Promise<{ user: JwtPayload; me: AuthMeResponse } | null> {
  let me: AuthMeResponse;
  try {
    me = (await authService.getMe()).data;
  } catch {
    return null;
  }
  if (!me || me.mustChangePassword === true || !canEnterApp(me.permissions)) return null;
  return { user: { userId: me.userId, username: me.username, permissions: me.permissions }, me };
}
