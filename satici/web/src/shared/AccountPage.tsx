// Hesabım — kendi parolanı değiştir: mevcut parola + yeni parola + doğrulama kodu (açık kalmış bir
// oturum tek başına hesabı ele geçiremesin). Diğer oturumlar kapanır, bu oturum sürer.
import { useState, type FormEvent } from "react";
import { useApi, useUser } from "./session";
import { ROLE_LABEL, label } from "./labels";
import { Button, ErrorText, Field, KeyValues, PageTitle, Section } from "./ui";

export function AccountPage() {
  const api = useApi();
  const user = useUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const mismatch = next !== "" && again !== "" && next !== again;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setDone(false);
    try {
      await api.post("/oturum/parola", { mevcutParola: current, yeniParola: next, totp: totp.trim() });
      setDone(true);
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (err) {
      setError(err);
    } finally {
      setTotp("");
      setPending(false);
    }
  };

  return (
    <>
      <PageTitle title="Hesabım" />
      <Section title="Kimlik">
        <KeyValues
          items={[
            ["Kullanıcı adı", user.kullaniciAdi],
            ["Ad soyad", user.adSoyad],
            ["Rol", label(ROLE_LABEL, user.rol)],
          ]}
        />
      </Section>
      <Section title="Parola değiştir">
        <form className="form" onSubmit={submit}>
          <Field label="Mevcut parola">
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Yeni parola" hint="En az 12 karakter; sunucu zayıf parolayı reddeder.">
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Yeni parola (tekrar)">
            <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          <Field label="Doğrulama kodu">
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={totp} onChange={(e) => setTotp(e.target.value)} />
          </Field>
          {mismatch ? <p className="error">Yeni parolalar eşleşmiyor.</p> : null}
          <ErrorText error={error} />
          {done ? <p className="ok-box">Parola değişti; diğer oturumlarınız kapatıldı.</p> : null}
          <Button variant="primary" type="submit" disabled={pending || !current || !next || mismatch || !totp.trim()}>
            Parolayı değiştir
          </Button>
        </form>
      </Section>
    </>
  );
}
