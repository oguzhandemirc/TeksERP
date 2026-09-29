import { can } from "../../src/lib/access";
import { useSession } from "../../src/state/session";
import { Screen } from "../../src/ui/Frame";
import { SnapshotCard } from "../../src/ui/SnapshotCard";

export default function Stock() {
  const { permissions } = useSession();
  return (
    <Screen title="Stok" module="stok">
      {can(permissions, "bulut:ozet:oku") ? <SnapshotCard projection="ozet.stok" title="Özet" /> : null}
      <SnapshotCard projection="stok-karnesi" title="Stok karnesi" />
    </Screen>
  );
}
