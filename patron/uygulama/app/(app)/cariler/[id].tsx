// Cari ayrıntısı: kart + (izinliyse) bakiye hesapları; ekstre fabrikadan rapor isteğiyle gelir.
import { useLocalSearchParams, useRouter } from "expo-router";
import { can } from "../../../src/lib/access";
import { recordTitle } from "../../../src/lib/present";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { ErrorBox, Fields, ProjectionList } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Button, Card, Loading, Muted, Title } from "../../../src/ui/kit";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, permissions } = useSession();
  const router = useRouter();
  const r = useRemote(id ? `kayit:cari-kart:${id}` : null, () => api.record("cari-kart", String(id)));
  const balance = can(permissions, "bulut:cari-bakiye:oku");
  const statement = balance && can(permissions, "bulut:rapor:oku");
  return (
    <Screen title={r.data ? recordTitle(r.data.kayit) : "Cari"} module="cariler" back>
      {r.loading && !r.data ? <Loading /> : null}
      {r.error && !r.data ? <ErrorBox text={r.error} onRetry={r.reload} /> : null}
      {r.data ? (
        <>
          <Card><Fields value={r.data.kayit} /></Card>
          {r.data.kisisel !== undefined ? <Card><Title>İletişim</Title><Fields value={r.data.kisisel} /></Card> : null}
          {balance ? (
            <>
              <Title>Bakiye</Title>
              <ProjectionList projection="cari-hesap" filter={{ cariKartId: String(id) }} empty="Cari hesap yok" />
            </>
          ) : null}
          {statement ? (
            <Button label="Ekstre iste" tone="plain" testID="ekstre-iste"
              onPress={() => router.push({ pathname: "/raporlar/yeni", params: { anahtar: "finance/statement", cariKartId: String(id) } } as never)} />
          ) : null}
          {!balance ? <Muted>Bakiye görme izniniz yok.</Muted> : null}
        </>
      ) : null}
    </Screen>
  );
}
