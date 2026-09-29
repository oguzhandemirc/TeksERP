// Raporlar: hazır görünümler (fabrikanın hesapladığı anlık) + istenebilir raporlar + isteklerim.
import { useRouter } from "expo-router";
import { can } from "../../../src/lib/access";
import { formatDateTime } from "../../../src/lib/format";
import { catalogEntries, requestable } from "../../../src/lib/reports";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { useOpenRefresh } from "../../../src/state/useOpenRefresh";
import { ErrorBox } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Badge, Body, Card, Loading, Muted, Title } from "../../../src/ui/kit";
import { SnapshotCard } from "../../../src/ui/SnapshotCard";

export default function Reports() {
  const { api, permissions } = useSession();
  const router = useRouter();
  const catalog = useRemote("anlik:rapor-katalogu", () => api.snapshot("rapor-katalogu"));
  const mine = useRemote("raporlar:benim", () => api.reportList({ limit: 50 }));
  useOpenRefresh();
  const entries = catalogEntries(catalog.data?.veri).filter((e) => requestable(e.anahtar, permissions));
  return (
    <Screen title="Raporlar" module="raporlar">
      <Title>Hazır görünümler</Title>
      {can(permissions, "bulut:siparis:oku") ? <SnapshotCard projection="acik-siparis-karsilama" title="Açık sipariş karşılama" /> : null}
      {can(permissions, "bulut:stok:oku") ? <SnapshotCard projection="stok-karnesi" title="Stok karnesi" /> : null}
      <Title>İsteklerim</Title>
      {mine.loading && !mine.data ? <Loading /> : null}
      {mine.error && !mine.data ? <ErrorBox text={mine.error} onRetry={mine.reload} /> : null}
      {mine.data?.kayitlar.length === 0 ? <Muted>Henüz rapor istemediniz</Muted> : null}
      {mine.data?.kayitlar.map((r) => (
        <Card key={r.id} testID={`rapor-${r.id}`} onPress={() => router.push({ pathname: "/raporlar/[id]", params: { id: r.id } } as never)}>
          <Body>{entries.find((e) => e.anahtar === r.raporAnahtari)?.baslik ?? r.raporAnahtari}</Body>
          <Muted>{formatDateTime(r.olusturulma)}</Muted>
          <Badge status={r.durum} />
        </Card>
      ))}
      <Title>Rapor iste (özel aralık)</Title>
      {catalog.loading && !catalog.data ? <Loading /> : null}
      {catalog.error && !catalog.data ? <Muted>Rapor kataloğu henüz fabrikadan gelmedi</Muted> : null}
      {entries.map((e) => (
        <Card key={e.anahtar} testID={`katalog-${e.anahtar}`} onPress={() => router.push({ pathname: "/raporlar/yeni", params: { anahtar: e.anahtar } } as never)}>
          <Body>{e.baslik}</Body>
        </Card>
      ))}
    </Screen>
  );
}
