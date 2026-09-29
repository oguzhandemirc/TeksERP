// Jenerik kayıt ayrıntısı: kök alanlar + izinliyse finans/kişisel alt satırı (sunucu süzer).
import { useLocalSearchParams } from "expo-router";
import { useSession } from "../../../../src/state/session";
import { useRemote } from "../../../../src/state/useRemote";
import { ErrorBox, Fields } from "../../../../src/ui/data";
import { Screen } from "../../../../src/ui/Frame";
import { Card, Loading, Title } from "../../../../src/ui/kit";
import { recordTitle } from "../../../../src/lib/present";

export default function RecordDetail() {
  const { projeksiyon, id } = useLocalSearchParams<{ projeksiyon: string; id: string }>();
  const { api } = useSession();
  const r = useRemote(projeksiyon && id ? `kayit:${projeksiyon}:${id}` : null, () => api.record(String(projeksiyon), String(id)));
  return (
    <Screen title={r.data ? recordTitle(r.data.kayit) : "Kayıt"} back>
      {r.loading && !r.data ? <Loading /> : null}
      {r.error && !r.data ? <ErrorBox text={r.error} onRetry={r.reload} /> : null}
      {r.data ? (
        <>
          <Card><Fields value={r.data.kayit} /></Card>
          {r.data.finans !== undefined ? <Card><Title>Tutarlar</Title><Fields value={r.data.finans} /></Card> : null}
          {r.data.kisisel !== undefined ? <Card><Title>İletişim</Title><Fields value={r.data.kisisel} /></Card> : null}
        </>
      ) : null}
    </Screen>
  );
}
