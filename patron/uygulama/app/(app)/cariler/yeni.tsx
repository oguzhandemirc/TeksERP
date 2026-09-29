// Yeni cari fabrikaya GELEN KUTUSU üzerinden gider; kod ve mükerrer denetimi fabrikada.
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { buildCustomer } from "../../../src/lib/forms";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { Banner, Button, Field, Muted, Row } from "../../../src/ui/kit";
import { useWrite } from "../../../src/ui/useWrite";

export default function NewCustomer() {
  const { api } = useSession();
  const router = useRouter();
  const [f, setF] = useState({ ad: "", musteri: true, tedarikci: false, il: "", vergiNo: "", telefon: "", eposta: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const built = buildCustomer(f);
  const send = useCallback((id: string) => (built.ok ? api.inboxCreate(id, "CARI", built.body) : Promise.reject(new Error(built.error))), [api, built]);
  const w = useWrite(send);
  const set = (patch: Partial<typeof f>) => setF((o) => ({ ...o, ...patch }));

  async function submit() {
    if (!built.ok) return setFormError(built.error);
    setFormError(null);
    const r = await w.run(JSON.stringify(built.body));
    if (r) router.replace({ pathname: "/gelen-kutusu/[mesajId]", params: { mesajId: r.mesajId } } as never);
  }
  const shown = formError ?? w.error;

  return (
    <Screen title="Yeni cari" module="cariler" back>
      <Muted>Cari fabrikaya gelen kutusundan iletilir; fabrika kaydı açınca durumu buradan izlersiniz.</Muted>
      <Field label="Ad / unvan" value={f.ad} onChangeText={(t) => set({ ad: t })} testID="cari-ad" />
      <Row>
        <Button label={f.musteri ? "✓ Müşteri" : "Müşteri"} tone={f.musteri ? "primary" : "plain"} onPress={() => set({ musteri: !f.musteri })} />
        <Button label={f.tedarikci ? "✓ Tedarikçi" : "Tedarikçi"} tone={f.tedarikci ? "primary" : "plain"} onPress={() => set({ tedarikci: !f.tedarikci })} />
      </Row>
      <Field label="İl (isteğe bağlı)" value={f.il} onChangeText={(t) => set({ il: t })} />
      <Field label="Vergi no (isteğe bağlı)" value={f.vergiNo} onChangeText={(t) => set({ vergiNo: t.replace(/\D/g, "") })} keyboardType="number-pad" />
      <Field label="Telefon (isteğe bağlı)" value={f.telefon} onChangeText={(t) => set({ telefon: t })} keyboardType="phone-pad" />
      <Field label="E-posta (isteğe bağlı)" value={f.eposta} onChangeText={(t) => set({ eposta: t })} autoCapitalize="none" keyboardType="email-address" />
      {shown ? <Banner tone="error" text={shown} /> : null}
      <Button label="Fabrikaya gönder" busy={w.busy} disabled={w.disabled} onPress={() => void submit()} testID="cari-gonder" />
    </Screen>
  );
}
