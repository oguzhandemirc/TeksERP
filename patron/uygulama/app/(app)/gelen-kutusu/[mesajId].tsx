// Mesaj ayrıntısı + iptal (yalnız yazar, yalnız BEKLIYOR; iki adımlı onay). Fabrika işlemeye
// başladıysa sunucu 409 döner ve ekran taze durumu gösterir.
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { errorMessage } from "../../../src/api/client";
import { formatDateTime } from "../../../src/lib/format";
import { canCancel, INBOX_KIND_LABEL, resultText } from "../../../src/lib/inbox";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { ErrorBox, Fields } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Badge, Banner, Body, Card, ConfirmButton, Loading, Muted, Title } from "../../../src/ui/kit";

export default function InboxDetail() {
  const { mesajId } = useLocalSearchParams<{ mesajId: string }>();
  const { api, facility, permissions, offline } = useSession();
  const r = useRemote(mesajId ? `mesaj:${mesajId}` : null, () => api.inboxGet(String(mesajId)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = r.data;
  const me = { ad: facility?.hesap.ad ?? "", admin: permissions.includes("bulut:hesap:yonet") };

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.inboxCancel(String(mesajId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      r.reload();
    }
  }

  return (
    <Screen title="Mesaj" module="gelen-kutusu" back>
      {r.loading && !m ? <Loading /> : null}
      {r.error && !m ? <ErrorBox text={r.error} onRetry={r.reload} /> : null}
      {m ? (
        <>
          <Card>
            <Title>{INBOX_KIND_LABEL[m.tur] ?? m.tur}</Title>
            <Badge status={m.durum} />
            <Muted>{`${m.hesapAdi} · ${formatDateTime(m.olusturulma)}`}</Muted>
            {m.islenme ? <Muted>{`İşlenme: ${formatDateTime(m.islenme)}`}</Muted> : null}
            {m.iptal ? <Muted>{`İptal: ${formatDateTime(m.iptal)}`}</Muted> : null}
            {resultText(m.sonuc) ? <Body>{resultText(m.sonuc)}</Body> : null}
          </Card>
          <Card><Title>İçerik</Title><Fields value={m.govde} /></Card>
          {error ? <Banner tone="error" text={error} /> : null}
          {canCancel(m, me) ? (
            <ConfirmButton label="İsteği iptal et" question="Bu istek fabrikaya iletilmeden iptal edilsin mi?" busy={busy} disabled={offline} onConfirm={() => void cancel()} testID="mesaj-iptal" />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
