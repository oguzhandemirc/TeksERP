import { useCallback, useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { onApiBaseUrlApplied } from "@/lib/api-config";
import { forgetRememberedLogin, readRememberedLogin, type RememberedLogin } from "@/lib/remembered-login";
import type { LoginFormValues } from "./LoginForm";

const EMPTY: LoginFormValues = { username: "", password: "" };

/**
 * Giriş ekranının "hatırlanan hesap" durumu. Kayıt varsa ve kullanıcı "Başka hesapla
 * giriş yap" demediyse `remembered` dolu döner; kullanıcı adı forma yazılır, ekran yalnız
 * parola sorar. Sunucu adresi değişince kayıt yeniden okunur (sunucu başına kayıt).
 */
export function useRememberedLogin(form: UseFormReturn<LoginFormValues>) {
  const [stored, setStored] = useState<RememberedLogin | null>(null);
  const [otherAccount, setOtherAccount] = useState(false);
  const otherAccountRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void readRememberedLogin().then((r) => {
        if (!alive) return;
        // Kullanıcı adı görünümle AYNI anda forma yazılır: ayrı pasif efekt, görünüm çizildikten
        // sonra koşup erken gönderimi boş adla bırakıyor ya da "Başka hesap" sıfırlamasını eziyordu.
        if (r && !otherAccountRef.current) form.setValue("username", r.username);
        setStored(r);
      });
    };
    load();
    const off = onApiBaseUrlApplied(load);
    return () => {
      alive = false;
      off();
    };
  }, [form]);

  const remembered = stored && !otherAccount ? stored : null;

  const switchAccount = useCallback(() => {
    otherAccountRef.current = true;
    setOtherAccount(true);
    form.reset(EMPTY);
  }, [form]);

  const forget = useCallback(async () => {
    await forgetRememberedLogin();
    setStored(null);
    form.reset(EMPTY);
  }, [form]);

  return { remembered, switchAccount, forget };
}
