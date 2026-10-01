import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { authService } from "@/services/authService";
import { apiErrorMessage } from "@/services/apiClient";
import type { LoginFormValues } from "./useLoginFlow";

/**
 * ⑤ ZORUNLU PAROLA DEĞİŞİMİ — `useLoginFlow`un beşinci çıkışı (giriş 200 + `mustChangePassword`).
 *
 * Token YALNIZ bellekte durur, kalıcı depoya yazılmaz: sunucu ona yalnız me/logout/
 * change-password açar. Başarılı değişim kullanıcının bütün oturumlarını kapatır (bu
 * token da ölür) → akış yeni parolayla normal girişe (`relogin`) devam eder.
 */
export interface PendingPasswordChange {
  token: string;
  /** İlk girişin değerleri — `password` değişimin "mevcut parola"sıdır. */
  values: LoginFormValues;
  /** Son denemenin sunucu cevabı (mevcut parola yanlış · politika · kilit) — adımda gösterilir. */
  error: string | null;
}

interface Options {
  /** Yeni parolayla normal giriş (TOTP / oturum çakışması dalları dahil). */
  relogin: (values: LoginFormValues) => Promise<void>;
  /** Adım kapanınca (başarı ya da vazgeç) giriş formunun parola alanını temizler. */
  onClose: () => void;
}

/** Ağ yoksa açık cümle; yoksa sunucunun Türkçe mesajı (alan hataları dahil, tek okuyucu). */
function passwordChangeErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && !err.response) return "Sunucuya ulaşılamıyor.";
  return apiErrorMessage(err, "Parola değiştirilemedi.");
}

export function usePasswordChangeStep({ relogin, onClose }: Options) {
  const [pending, setPending] = useState<PendingPasswordChange | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const open = (token: string, values: LoginFormValues) => setPending({ token, values, error: null });

  const submit = async (newPassword: string) => {
    if (!pending) return;
    setSubmitting(true);
    try {
      await authService.changePassword(
        { currentPassword: pending.values.password, newPassword },
        pending.token,
        { suppressErrorToast: true },
      );
    } catch (err) {
      // Adımda KAL: kullanıcı yeni parolayı düzeltip yeniden dener.
      setPending({ ...pending, error: passwordChangeErrorMessage(err) });
      return;
    } finally {
      setSubmitting(false);
    }
    setPending(null);
    onClose();
    toast.success("Parolanız değiştirildi.");
    await relogin({ username: pending.values.username, password: newPassword });
  };

  const cancel = () => {
    // Bellekteki token'ın oturumu sunucuda da kapansın (best-effort, sessiz).
    if (pending) void authService.logout(pending.token).catch(() => undefined);
    setPending(null);
    onClose();
  };

  return { pending, submitting, open, submit, cancel };
}
