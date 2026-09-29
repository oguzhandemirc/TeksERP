// İstek ayrıntısı: durum + (HAZIR ise) sonuç; BEKLIYOR'da iptal (iki adımlı onay).
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { errorMessage } from "../../../src/api/client";
import { formatDateTime } from "../../../src/lib/format";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { ErrorBox, Fields, SnapshotView } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Badge, Banner, Button, Card, ConfirmButton, Loading, Muted, Title } from "../../../src/ui/kit";

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, offline } = useSession();
  const r = useRemote(id ? `rapor:${id}` : null, () => api.reportGet(String(id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = r.data;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.reportCancel(String(id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      r.reload();
    }
  }

  return (
    <Screen title="Rapor" module="raporlar" back>
      {r.loading && !d ? <Loading /> : null}
      {r.error && !d ? <ErrorBox text={r.error} onRetry={r.reload} /> : null}
      {d ? (
        <>
          <Card>
            <Title>{d.raporAnahtari}</Title>
            <Badge status={d.durum} />
            <Muted>{`İstendi: ${formatDateTime(d.olusturulma)}`}</Muted>
            {d.hataKodu ? <Muted>{`Hata: ${d.hataKodu}`}</Muted> : null}
            <Fields value={d.parametreler} />
          </Card>
          {d.durum === "BEKLIYOR" || d.durum === "HESAPLANIYOR" ? <Button label="Yenile" tone="plain" onPress={r.reload} /> : null}
          {d.sonuc ? (
            <Card>
              <Muted>{`Hesaplandı: ${formatDateTime(d.sonuc.hesaplandi)}`}</Muted>
              <SnapshotView value={d.sonuc.veri} />
            </Card>
          ) : null}
          {error ? <Banner tone="error" text={error} /> : null}
          {d.durum === "BEKLIYOR" ? <ConfirmButton label="İsteği iptal et" question="Rapor isteği iptal edilsin mi?" busy={busy} disabled={offline} onConfirm={() => void cancel()} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
