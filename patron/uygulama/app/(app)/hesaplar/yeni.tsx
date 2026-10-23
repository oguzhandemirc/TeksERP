// Hesap davet et: e-posta + ad + yetki şablonu (Türkçe; sonra hesap ayrıntısından değişir). Davet kodu YALNIZ ilk
// yanıtta gelir ve bir kez gösterilir (depoya yazılmaz).
import { useCallback, useState } from "react";
import { View } from "react-native";
import type { AccountInviteResult } from "../../../src/api/wire";
import { ACCOUNT_TEMPLATE, ACCOUNT_TEMPLATES, type AccountTemplate } from "../../../src/lib/labels/diger";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { CheckRow, GroupCaption, GroupNote } from "../../../src/ui/diger/parts";
import { Screen } from "../../../src/ui/Frame";
import { InviteShown } from "../../../src/ui/InviteShown";
import { Banner, Button, Field } from "../../../src/ui/kit";
import { ListGroup } from "../../../src/ui/ListRow";
import { space } from "../../../src/ui/tokens";
import { useWrite } from "../../../src/ui/useWrite";

export default function NewAccount() {
  const { api } = useSession();
  const catalog = useRemote("izinler", () => api.permissions());
  const [eposta, setEposta] = useState("");
  const [ad, setAd] = useState("");
  const [sablon, setSablon] = useState<AccountTemplate>("SATIS");
  const [done, setDone] = useState<AccountInviteResult | null>(null);
  const body = { eposta: eposta.trim(), ad: ad.trim(), sablon };
  const send = useCallback((clientToken: string) => api.accountCreate({ clientToken, ...body }), [api, body.eposta, body.ad, body.sablon]);
  const w = useWrite(send);
  if (done) {
    return (
      <Screen title="Davet hazır" module="hesaplar" back>
        <Banner tone="off" icon="checkmark-circle" text={`${done.hesap.ad} için davet oluşturuldu.`} />
        <InviteShown r={done} />
      </Screen>
    );
  }
  return (
    <Screen title="Hesap davet et" module="hesaplar" back>
      <GroupCaption>Kişi</GroupCaption>
      <ListGroup>
        <View style={{ paddingHorizontal: space.l, paddingTop: space.l }}>
          <Field label="E-posta" value={eposta} onChangeText={setEposta} autoCapitalize="none" keyboardType="email-address" autoComplete="email" testID="hesap-eposta" />
          <Field label="Ad soyad" value={ad} onChangeText={setAd} testID="hesap-ad" />
        </View>
      </ListGroup>
      <GroupCaption>Yetki şablonu</GroupCaption>
      <ListGroup testID="sablonlar" iconSize={32}>
        {ACCOUNT_TEMPLATES.map((k) => {
          const n = catalog.data?.sablonlar[k]?.length;
          return (
            <CheckRow key={k} kind="radio" checked={sablon === k} onPress={() => setSablon(k)} testID={`sablon-${k}`}
              title={ACCOUNT_TEMPLATE[k].ad} subtitle={n ? `${ACCOUNT_TEMPLATE[k].aciklama} · ${n} izin` : ACCOUNT_TEMPLATE[k].aciklama}
              icon={ACCOUNT_TEMPLATE[k].icon} domain={k === "PATRON" ? "genel" : k === "MUHASEBE" ? "finans" : "siparisler"} />
          );
        })}
      </ListGroup>
      <GroupNote>İzinler sonra hesap ayrıntısından tek tek değiştirilebilir.</GroupNote>
      {w.error ? <Banner tone="error" text={w.error} /> : null}
      <Button label="Davet oluştur" icon="paper-plane-outline" busy={w.busy} disabled={w.disabled || body.eposta === "" || body.ad === ""}
        onPress={() => void w.run(JSON.stringify(body)).then((r) => r && setDone(r))} testID="hesap-olustur" />
    </Screen>
  );
}
