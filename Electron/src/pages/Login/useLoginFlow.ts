import { useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { authService } from "@/services/authService";
import { tokenStore } from "@/lib/secure-token";
import { decodeJwt } from "@/lib/jwt";
import { readSessionConflict } from "@/lib/session-auth";
import { pinServerIdentityAfterLogin } from "@/lib/server-identity";
import {
  isTotpEnrollmentRequired,
  isTotpInvalid,
  isTotpRequired,
} from "@/lib/totp-auth";
import { useAuthStore } from "@/store/auth";
import { canEnterApp, type ExistingSessionInfo } from "@/types/auth";

/**
 * GİRİŞ AKIŞI — `LoginPage`ten AYRILDI (sayfa 200 satır kuralını aşıyordu).
 *
 * Sayfa yalnız SUNUM yapar; hangi ekranın çizileceğine dair tüm karar burada.
 * Dört çıkış yolu var ve üçü hata değil AKIŞ ADIMI:
 *   ① başarı           → token + yönlendirme
 *   ② 409 SESSION_EXISTS → "hesap başka yerde açık" onayı
 *   ③ 409/401 TOTP     → ikinci faktör adımı (yalnız uzak girişte)
 *   ④ 403 TOTP_ENROLLMENT → "yöneticinden kurulum iste" ekranı
 */
const schema = z.object({
  username: z.string().min(1, "Kullanıcı adı gerekli"),
  password: z.string().min(1, "Şifre gerekli"),
});

export type LoginFormValues = z.infer<typeof schema>;

export function useLoginFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useAuthStore((s) => s.setUser);
  const [submitting, setSubmitting] = useState(false);
  // 409 SESSION_EXISTS ('notify' politikası) — onay bekleyen çakışma bilgisi.
  const [conflict, setConflict] = useState<{ values: LoginFormValues; existing: ExistingSessionInfo } | null>(null);
  // İkinci faktör — YALNIZ uzak (tünel) girişte doldurulur. `pending` kod
  // adımını açar; `invalid` son denemenin yanlış olduğunu söyler; `enrollment`
  // hiç kurulmamış hesabın ekranını açar. LAN'da üçü de hep null/false kalır.
  const [totp, setTotp] = useState<{ values: LoginFormValues; invalid: boolean } | null>(null);
  const [enrollmentNeeded, setEnrollmentNeeded] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  /**
   * Girişi dener. `confirmKick=true` → 'notify' politikasında kullanıcı "iki
   * oturum da açık kalsın" onayı verince tekrar çağrılır. Hata UX'ini bu fonksiyon
   * yönetir (`suppressErrorToast`): 401 (yanlış şifre) interceptor'ın özel dalında
   * zaten toast'lanır; 409 SESSION_EXISTS onay diyaloğunu açar; diğerleri burada.
   */
  const performLogin = async (values: LoginFormValues, confirmKick: boolean, totpCode?: string) => {
    setSubmitting(true);
    try {
      const res = await authService.login(
        { ...values, confirmKick: confirmKick || undefined, totpCode },
        { suppressErrorToast: true },
      );
      await tokenStore.set(res.data.token);
      const decoded = decodeJwt(res.data.token) ?? res.data.user;
      if (!canEnterApp(decoded.permissions)) {
        await tokenStore.clear();
        toast.error("Bu uygulamayı kullanma yetkin yok. Yöneticine başvur.");
        return;
      }
      setConflict(null);
      setTotp(null);
      setEnrollmentNeeded(false);
      setUser(decoded);
      // Token'da OLMAYAN kimlik alanları (sistem hesabı / kurulumda var mı)
      // `/auth/me`den gelir — arka planda; navigasyonu bekletmez.
      void useAuthStore.getState().refreshSystemAccount();
      // Kimlik sabitleme: insan bu sunucuya GİRDİ, yani "bu benim sunucum" dedi.
      // Bundan sonraki keşiflerde kimlik tutmazsa kullanıcıya sorulur.
      void pinServerIdentityAfterLogin();
      const dest = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? "/";
      navigate(dest, { replace: true });
    } catch (err) {
      // ── İkinci faktör dalları ────────────────────────────────────────────
      // ⚠️ SIRA: TOTP kontrolleri oturum-çakışması kontrolünden ÖNCE gelmeli.
      // İkisi de 409 taşıyor; `readSessionConflict` koda bakıyor ama sıralamayı
      // koda bağlı bırakmak, ileride biri kodu unutursa sessizce yanlış ekranı
      // açardı.
      if (isTotpRequired(err)) {
        // Sunucu kod istedi — parola DOĞRU. Kod adımını aç.
        setTotp({ values, invalid: false });
        return;
      }
      if (isTotpInvalid(err)) {
        // Kod yanlış: adımda KAL, alanı kırmızıya çek. Kullanıcıyı parola
        // ekranına geri atmak, doğru bildiği şeyi yeniden yazdırmak olurdu.
        setTotp({ values, invalid: true });
        return;
      }
      if (isTotpEnrollmentRequired(err)) {
        setTotp(null);
        setEnrollmentNeeded(true);
        return;
      }

      const existing = readSessionConflict(err);
      if (existing) {
        // 'notify': aynı hesap başka yerde açık — kullanıcıya sor, onaylarsa
        // confirmKick=true ile tekrar dene (iki oturum da açık kalır).
        setConflict({ values, existing });
        return;
      }
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      // 401 ve login-403 interceptor'da toast'landı; kalanları burada göster.
      // (TOTP'nin 401/403'leri yukarıda yakalandı — buraya düşmez.)
      if (status !== 401 && status !== 403) {
        const message = axios.isAxiosError(err)
          ? ((err.response?.data as { message?: string } | undefined)?.message ??
            (err.response ? "Giriş yapılamadı." : "Sunucuya ulaşılamıyor."))
          : "Giriş yapılamadı.";
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    form,
    submitting,
    conflict,
    setConflict,
    totp,
    setTotp,
    enrollmentNeeded,
    setEnrollmentNeeded,
    performLogin,
  };
}
