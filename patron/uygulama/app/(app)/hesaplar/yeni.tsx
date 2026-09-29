import { useCallback, useState } from "react";
import type { AccountInviteResult } from "../../../src/api/wire";
import { Screen } from "../../../src/ui/Frame";
import { useSession } from "../../../src/state/session";
import { Banner, Button, Field, Muted, Tabs } from "../../../src/ui/kit";
import { InviteShown } from "../../../src/ui/InviteShown";
import { useWrite } from "../../../src/ui/useWrite";

type Template = "PATRON" | "MUHASEBE" | "SATIS";
const TEMPLATES: readonly { key: Template; label: string }[] = [{ key: "PATRON", label: "Patron" }, { key: "MUHASEBE", label: "Muhasebe" }, { key: "SATIS", label: "Satış" }];

export default function NewAccount() {
  const { api } = useSession();
  const [eposta, setEposta] = useState("");
  const [ad, setAd] = useState("");
  const [sablon, setSablon] = useState<Template>("SATIS");
  const [done, setDone] = useState<AccountInviteResult | null>(null);
  const body = { eposta: eposta.trim(), ad: ad.trim(), sablon };
  const send = useCallback((clientToken: string) => api.accountCreate({ clientToken, ...body }), [api, body.eposta, body.ad, body.sablon]);
  const w = useWrite(send);
  if (done) return <Screen title="Davet hazır" module="hesaplar" back><InviteShown r={done} /></Screen>;
  return (
    <Screen title="Hesap davet et" module="hesaplar" back>
      <Field label="E-posta" value={eposta} onChangeText={setEposta} autoCapitalize="none" keyboardType="email-address" testID="hesap-eposta" />
      <Field label="Ad soyad" value={ad} onChangeText={setAd} testID="hesap-ad" />
      <Muted>Yetki şablonu (sonra hesap ayrıntısından değiştirilebilir)</Muted>
      <Tabs items={TEMPLATES} value={sablon} onChange={setSablon} />
      {w.error ? <Banner tone="error" text={w.error} /> : null}
      <Button label="Davet oluştur" busy={w.busy} disabled={w.disabled || body.eposta === "" || body.ad === ""}
        onPress={() => void w.run(JSON.stringify(body)).then((r) => r && setDone(r))} testID="hesap-olustur" />
    </Screen>
  );
}
