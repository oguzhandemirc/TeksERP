import { useRouter } from "expo-router";
import { can } from "../../../src/lib/access";
import { useSession } from "../../../src/state/session";
import { ProjectionList } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Button } from "../../../src/ui/kit";

export default function Customers() {
  const { permissions, offline } = useSession();
  const router = useRouter();
  return (
    <Screen title="Cariler" module="cariler">
      {can(permissions, "bulut:cari:yaz") ? <Button label="Yeni cari" disabled={offline} onPress={() => router.push("/cariler/yeni")} testID="yeni-cari" /> : null}
      <ProjectionList projection="cari-kart" empty="Cari yok" onOpen={(r) => router.push({ pathname: "/cariler/[id]", params: { id: r.id } } as never)} />
    </Screen>
  );
}
