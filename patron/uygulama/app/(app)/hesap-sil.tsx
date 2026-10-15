// Hesabımı sil (Google Play hesap silme politikası): açıklama → parola + güncel doğrulama kodu → iki adımlı onay.
// Başarıda sunucu bütün oturumları kapatmıştır; "Tamam" bu cihazdaki oturumu ve önbelleği de siler.
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import type { AccountDeletion } from "../../src/api/wire";
import { DELETION_EFFECTS, LAST_ADMIN_HINT, deletionDoneText } from "../../src/lib/account-deletion";
import { useSession } from "../../src/state/session";
import { Screen } from "../../src/ui/Frame";
import { Banner, Body, Button, Card, ConfirmButton, Field, Muted, Title } from "../../src/ui/kit";
import { useWrite } from "../../src/ui/useWrite";

export default function DeleteAccount() {
  const { api, logout } = useSession();
  const router = useRouter();
  const [parola, setParola] = useState("");
  const [totp, setTotp] = useState("");
  const [done, setDone] = useState<AccountDeletion | null>(null);
  const del = useWrite(useCallback(() => api.deleteOwnAccount({ parola, totp }), [api, parola, totp]));
  if (done) {
    return (
      <Screen title="Hesabımı sil" module="profil">
        <Banner tone="off" text={deletionDoneText(done)} testID="hesap-silindi" />
        <Button label="Tamam" onPress={() => void logout()} testID="hesap-silindi-tamam" />
      </Screen>
    );
  }
  return (
    <Screen title="Hesabımı sil" module="profil">
      <Card>
        <Title>Hesabınızı silerseniz</Title>
        {DELETION_EFFECTS.map((t) => <Body key={t}>{`• ${t}`}</Body>)}
        <Muted>{LAST_ADMIN_HINT}</Muted>
      </Card>
      <Field label="Parola" value={parola} onChangeText={setParola} secureTextEntry testID="hesap-sil-parola" />
      <Field label="Doğrulama kodu" value={totp} onChangeText={(t) => setTotp(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" testID="hesap-sil-totp" />
      {del.error ? <Banner tone="error" text={del.error} testID="hesap-sil-hata" /> : null}
      <ConfirmButton
        label="Hesabımı kalıcı olarak sil"
        question="Hesabınız ve bütün fabrika üyelikleriniz hemen kapanacak. Emin misiniz?"
        busy={del.busy}
        disabled={del.disabled || parola === "" || totp.length !== 6}
        onConfirm={() => void del.run(totp).then((r) => { if (r) setDone(r); })}
        testID="hesap-sil"
      />
      <Button label="Vazgeç" tone="plain" onPress={() => router.back()} />
    </Screen>
  );
}
