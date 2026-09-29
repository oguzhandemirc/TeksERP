// GİRİŞ — kullanıcı adı + parola + doğrulama kodu (TOTP) TEK adımda; TOTP'siz giriş yoktur.
// Hata iletisi sunucudan tek biçimde gelir (hangi faktörün tutmadığı söylenmez). Kod her denemede
// tek kullanımlıktır: başarısız denemeden sonra kod alanı temizlenir, parola alanı da.
// İlk giriş: TOTP kurulumunu hesabı açan yönetici yapar (sır yalnız onun ekranında bir kez görünür).
import { useState, type FormEvent } from "react";
import { ApiError } from "./api";
import { useSession } from "./session";
import { Button, ErrorText, Field } from "./ui";

/** Giriş ucunun hız sınırı kodu (protokolün ortak kodu; ayna bekçisi sunucuda ölçer). */
export const LOGIN_RATE_LIMIT_CODE = "HIZ_SINIRI";

export function LoginPage({ product, expired }: { product: string; expired?: boolean }) {
  const { login } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login({ kullaniciAdi: username.trim(), parola: password, totp: totp.replace(/\s+/g, "") });
    } catch (err) {
      setError(err);
      setTotp("");
      // Hız sınırı kullanıcının hatası değil: parola korunur. Kilitli hesap sunucuda hatalı girişle AYNI yanıtı alır
      // (hesabın varlığı sızmasın) — ayrı dalı yoktur.
      if (!(err instanceof ApiError) || err.code !== LOGIN_RATE_LIMIT_CODE) setPassword("");
    } finally {
      setPending(false);
    }
  };

  const ready = username.trim() !== "" && password !== "" && /^\d{6,8}$/.test(totp.replace(/\s+/g, ""));

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit} aria-label="Giriş">
        <h1>{product}</h1>
        {expired ? <p className="warn-box">Oturumunuz sona erdi; yeniden giriş yapın.</p> : null}
        <Field label="Kullanıcı adı">
          <input value={username} autoComplete="username" autoCapitalize="none" spellCheck={false} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Parola">
          <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Doğrulama kodu" hint="Doğrulayıcı uygulamadaki 6 haneli kod (30 saniyede bir değişir).">
          <input value={totp} inputMode="numeric" autoComplete="one-time-code" maxLength={8} onChange={(e) => setTotp(e.target.value)} />
        </Field>
        <ErrorText error={error} />
        <Button variant="primary" type="submit" disabled={!ready || pending}>
          {pending ? "Giriş yapılıyor…" : "Giriş yap"}
        </Button>
        <p className="muted small">
          İlk girişte: hesabınızı açan yöneticinin ekranında bir kez gösterilen QR kodunu doğrulayıcı uygulamanıza (Google Authenticator, Microsoft
          Authenticator vb.) okutun. Telefonunuzu kaybettiyseniz yöneticiniz doğrulama kodunuzu sıfırlar; kurtarma kodu yoktur.
        </p>
      </form>
    </div>
  );
}
