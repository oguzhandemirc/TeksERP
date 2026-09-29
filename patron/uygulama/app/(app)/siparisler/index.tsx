import { useRouter } from "expo-router";
import { can } from "../../../src/lib/access";
import { useSession } from "../../../src/state/session";
import { ProjectionList } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Button } from "../../../src/ui/kit";
import { openRecord } from "../../../src/ui/nav";

export default function Orders() {
  const { permissions, offline } = useSession();
  const router = useRouter();
  return (
    <Screen title="Siparişler" module="siparisler">
      {can(permissions, "bulut:siparis:yaz") ? (
        <Button label="Yeni sipariş" disabled={offline} onPress={() => router.push("/siparisler/yeni")} testID="yeni-siparis" />
      ) : null}
      <ProjectionList projection="siparis" empty="Sipariş yok" onOpen={(r) => openRecord(router, "siparis", r.id)} />
    </Screen>
  );
}
