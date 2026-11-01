import { authService } from "@/services/authService";
import { featureFlagService } from "@/services/featureFlagService";
import { forgetRememberedLogin, writeRememberedLogin } from "@/lib/remembered-login";

export type RememberSyncResult = "saved" | "cleared" | "skipped";

/**
 * Başarılı girişten SONRA son-kullanıcı kaydını ayara göre günceller. Giriş ekranı
 * kimliksiz olduğundan ayar burada (oturumla) okunur: açıksa yaz, kapalıysa SİL.
 * Sistem hesabı ASLA yazılmaz ve mevcut kaydı değiştirmez; `/auth/me` ya da bayrak
 * okunamazsa hiçbir şey yapılmaz (fail-closed — sistem hesabı yanlışlıkla yazılmasın).
 */
export async function syncRememberedLoginAfterLogin(username: string): Promise<RememberSyncResult> {
  try {
    const me = (await authService.getMe()).data;
    // Alanı taşımayan eski backend ya da sistem hesabı → dokunma.
    if (!me || me.isSystemAccount !== false) return "skipped";
    if (me.username !== username) return "skipped";
    const flags = (await featureFlagService.get()).data;
    if (!flags) return "skipped";
    if (flags.rememberLastUser !== true) {
      await forgetRememberedLogin();
      return "cleared";
    }
    await writeRememberedLogin({ username: me.username, displayName: me.fullName ?? null });
    return "saved";
  } catch {
    return "skipped";
  }
}
