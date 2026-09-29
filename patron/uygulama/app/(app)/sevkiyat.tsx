import { useRouter } from "expo-router";
import { can } from "../../src/lib/access";
import { useSession } from "../../src/state/session";
import { ProjectionList } from "../../src/ui/data";
import { Screen } from "../../src/ui/Frame";
import { SnapshotCard } from "../../src/ui/SnapshotCard";
import { openRecord } from "../../src/ui/nav";

export default function Shipments() {
  const { permissions } = useSession();
  const router = useRouter();
  return (
    <Screen title="Sevkiyat" module="sevkiyat">
      {can(permissions, "bulut:ozet:oku") ? <SnapshotCard projection="ozet.sevkiyat" title="Özet" /> : null}
      <ProjectionList projection="sevkiyat" empty="Sevkiyat yok" onOpen={(r) => openRecord(router, "sevkiyat", r.id)} />
    </Screen>
  );
}
