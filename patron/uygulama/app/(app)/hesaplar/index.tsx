// Hesaplar (yalnız tesis yöneticisi): tesisin bulut hesapları.
import { useRouter } from "expo-router";
import { formatDateTime } from "../../../src/lib/format";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { ErrorBox } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Badge, Body, Button, Card, Loading, Muted } from "../../../src/ui/kit";

export default function Accounts() {
  const { api, offline } = useSession();
  const router = useRouter();
  const r = useRemote("hesaplar", () => api.accountList());
  return (
    <Screen title="Hesaplar" module="hesaplar">
      <Button label="Hesap davet et" disabled={offline} onPress={() => router.push("/hesaplar/yeni")} testID="hesap-davet" />
      {r.loading && !r.data ? <Loading /> : null}
      {r.error && !r.data ? <ErrorBox text={r.error} onRetry={r.reload} /> : null}
      {r.data?.map((a) => (
        <Card key={a.id} testID={`hesap-${a.id}`} onPress={() => router.push({ pathname: "/hesaplar/[id]", params: { id: a.id } } as never)}>
          <Body>{a.ad}</Body>
          <Muted>{a.eposta}</Muted>
          <Badge status={a.durum} />
          <Muted>{a.sonGiris ? `Son giriş: ${formatDateTime(a.sonGiris)}` : "Henüz giriş yapmadı"}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
