import { useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { authService } from "@/services/authService";
import { tokenStore } from "@/lib/secure-token";
import { trustedDeviceStore } from "@/lib/trusted-device-store";
import { getActiveApiBaseUrl } from "@/lib/api-config";
import { decodeJwt } from "@/lib/jwt";
import { readSessionConflict } from "@/lib/session-auth";
import { pinServerIdentityAfterLogin } from "@/lib/server-identity";
import {
  isTotpEnrollmentRequired,
  isTotpInvalid,
  isTotpRequired,
  readTrustDeviceDays,
} from "@/lib/totp-auth";
import { useAuthStore } from "@/store/auth";
import { canEnterApp, type ExistingSessionInfo, type JwtPayload, type LoginResponse } from "@/types/auth";
import { usePasswordChangeStep } from "./usePasswordChangeStep";
import { syncRememberedLoginAfterLogin } from "./syncRememberedLogin";

/**
 * GİRİŞ AKIŞI — `LoginPage`ten AYRILDI (sayfa 200 satır kuralını aşıyordu).
 *
 * Sayfa yalnız SUNUM yapar; hangi ekranın çizileceğine dair tüm karar burada.
 * Beş çıkış yolu var ve dördü hata değil AKIŞ ADIMI:
 *   ① başarı           → token + yönlendirme
 *   ② 409 SESSION_EXISTS → "hesap başka yerde açık" onayı
 *   ③ 409/401 TOTP     → ikinci faktör adımı (hesabında 2FA açık kullanıcıda)
 *   ④ 403 TOTP_ENROLLMENT → "yöneticinden kurulum iste" ekranı
 *   ⑤ 200 + mustChangePassword → zorunlu parola değişimi adımı (`usePasswordChangeStep`);
 *      token kalıcı depoya YAZILMAZ, değişimden sonra yeni parolayla ① yeniden denenir
 */
const schema = z.object({
  username: z.string().min(1, "Kullanıcı adı gerekli"),
  password: z.string().min(1, "Şifre gerekli"),
});

export type LoginFormValues = z.infer<typeof schema>;
const EMPTY_LOGIN: LoginFormValues = { username: "", password: "" };

/** 401 ve login-403 interceptor'da toast'landı (TOTP'ninkiler akış adımı); kalanları göster. */
function toastUnhandledLoginError(err: unknown): void {
  const status = axios.isAxiosError(err) ? err.response?.status : undefined;
  if (status === 401 || status === 403) return;
  const message = axios.isAxiosError(err)
    ? ((err.response?.data as { message?: string } | undefined)?.message ??
      (err.response ? "Giriş yapılamadı." : "Sunucuya ulaşılamıyor."))
    : "Giriş yapılamadı.";
  toast.error(message);
}

/**
 * Başarılı girişin kimliğini benimser. Çerez kipinde (bulut web paneli) token YOK: kimlik
 * sunucunun httpOnly çerezinde, kullanıcı cevaptaki `user`dan. Token gelirse (Electron ya da
 * panel kipi kapalı backend) eski yol: token depoya (webde yalnız bellek) ve JWT çözümü.
 */
async function adoptLoginSession(data: LoginResponse["data"]): Promise<JwtPayload> {
  if (data.cookieSession === true || !data.token) return data.user;
  await tokenStore.set(data.token);
  return decodeJwt(data.token) ?? data.user;
}

/** Girişe izin verilmeyen oturumu bırakır: token yolunda yerel silme, çerez yolunda sunucu çıkışı. */
async function dropLoginSession(data: LoginResponse["data"]): Promise<void> {
  if (data.cookieSession === true || !data.token) {
    await authService.logout().catch(() => undefined);
    return;
  }
  await tokenStore.clear();
}

/**
 * Barındırılan sunucu "bu cihazı hatırla" belirteci — yuva sunucu + kullanıcı (başka hesabın belirteci
 * gönderilmez/silinmez). LAN/eski sunucu alanı yok sayar.
 */
async function loadRememberedDevice(username: string): Promise<{ slot: string; token: string | null }> {
  const slot = `${getActiveApiBaseUrl()}\n${username.trim().toLowerCase()}`;
  return { slot, token: await trustedDeviceStore.get(slot).catch(() => null) };
}

export function useLoginFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useAuthStore((s) => s.setUser);
  const [submitting, setSubmitting] = useState(false);
  // 409 SESSION_EXISTS ('notify' politikası) — onay bekleyen çakışma bilgisi.
  const [conflict, setConflict] = useState<{ values: LoginFormValues; existing: ExistingSessionInfo } | null>(null);
  // İkinci faktör — yalnız sunucu isterse (hesapta 2FA açık) doldurulur; `trustDeviceDays` > 0 "hatırla" kutusu. `pending` kod
  // adımını açar; `invalid` son denemenin yanlış olduğunu söyler; `enrollment`
  // hiç kurulmamış hesabın ekranını açar.
  const [totp, setTotp] = useState<{ values: LoginFormValues; invalid: boolean; trustDeviceDays: number } | null>(null);
  const [enrollmentNeeded, setEnrollmentNeeded] = useState(false);

  const form = useForm<LoginFormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY_LOGIN });
  // `performLogin` aşağıda tanımlı; kapanış yalnız gönderimde çağrılır (render anında değil).
  const passwordChange = usePasswordChangeStep({
    relogin: (v) => performLogin(v, false),
    onClose: () => form.resetField("password"),
  });

  /**
   * Girişi dener. `confirmKick=true` → 'notify' politikasında kullanıcı "iki
   * oturum da açık kalsın" onayı verince tekrar çağrılır. Hata UX'ini bu fonksiyon
   * yönetir (`suppressErrorToast`): 401 (yanlış şifre) interceptor'ın özel dalında
   * zaten toast'lanır; 409 SESSION_EXISTS onay diyaloğunu açar; diğerleri burada.
   */
  const performLogin = async (values: LoginFormValues, confirmKick: boolean, totpCode?: string, rememberDevice?: boolean) => {
    setSubmitting(true);
    const device = await loadRememberedDevice(values.username);
    try {
      const res = await authService.login(
        { ...values, confirmKick: confirmKick || undefined, totpCode, rememberDevice: rememberDevice || undefined, trustedDeviceToken: device.token ?? undefined },
        { suppressErrorToast: true },
      );
      if (res.data.trustedDeviceToken) await trustedDeviceStore.set(device.slot, res.data.trustedDeviceToken).catch(() => undefined);
      if (res.data.mustChangePassword === true) {
        // ⑤ Token yalnız bellekte: yeni parola belirlenmeden uygulamaya girilmez.
        setConflict(null);
        setTotp(null);
        passwordChange.open(res.data.token ?? null, values);
        return;
      }
      const decoded = await adoptLoginSession(res.data);
      if (!canEnterApp(decoded.permissions)) {
        await dropLoginSession(res.data);
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
      // Son kullanıcı kaydı ayara göre yazılır/silinir; sistem hesabı hiç yazılmaz (arka planda).
      void syncRememberedLoginAfterLogin(decoded.username);
      const dest = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? "/";
      navigate(dest, { replace: true });
    } catch (err) {
      // ── İkinci faktör dalları ────────────────────────────────────────────
      // ⚠️ SIRA: TOTP kontrolleri oturum-çakışması kontrolünden ÖNCE gelmeli.
      // İkisi de 409 taşıyor; `readSessionConflict` koda bakıyor ama sıralamayı
      // koda bağlı bırakmak, ileride biri kodu unutursa sessizce yanlış ekranı
      // açardı.
      if (isTotpRequired(err)) {
        // Sunucu kod istedi — parola DOĞRU. Gönderilen belirteç geçmediyse (süre/iptal) bırak; kod adımını aç.
        if (device.token && !totpCode) await trustedDeviceStore.clear(device.slot).catch(() => undefined);
        setTotp({ values, invalid: false, trustDeviceDays: readTrustDeviceDays(err) });
        return;
      }
      if (isTotpInvalid(err)) {
        // Kod yanlış: adımda KAL, alanı kırmızıya çek. Kullanıcıyı parola
        // ekranına geri atmak, doğru bildiği şeyi yeniden yazdırmak olurdu.
        setTotp((prev) => ({ values, invalid: true, trustDeviceDays: prev?.trustDeviceDays ?? 0 }));
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
      toastUnhandledLoginError(err);
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
    passwordChange,
    performLogin,
  };
}
