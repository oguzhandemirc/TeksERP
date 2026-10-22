import { useRouter } from "expo-router";
import { can } from "../../../src/lib/access";
import { useSession } from "../../../src/state/session";
import { ProjectionList } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Muted } from "../../../src/ui/kit";
import { SnapshotCard } from "../../../src/ui/SnapshotCard";
import { openRecord } from "../../../src/ui/nav";
import { TERIM } from "../../../src/lib/terim";

export default function Production() {
  const { permissions } = useSession();
  const router = useRouter();
  return (
    <Screen title="Üretim" module="uretim" back={false}>
      {can(permissions, "bulut:ozet:oku") ? <SnapshotCard projection="ozet.uretim" title="Özet" /> : null}
      <SnapshotCard projection="uretim-akisi" title="Üretim akışı" />
      <Muted>{TERIM.terbiyeIsEmri.cogul}</Muted>
      <ProjectionList projection="is-emri" empty="Terbiye iş emri yok" onOpen={(r) => openRecord(router, "is-emri", r.id)} />
    </Screen>
  );
}
