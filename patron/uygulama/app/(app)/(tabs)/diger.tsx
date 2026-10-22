// "Diğer" sekmesi: sekmeye sığmayan bölümler gruplu liste olarak (İş · Eylem · Hesap). İzinsiz bölüm çizilmez.
import { useRouter } from "expo-router";
import { MODULES, moduleVisible } from "../../../src/lib/access";
import { useSession } from "../../../src/state/session";
import { FacilityName, Screen } from "../../../src/ui/Frame";
import { MODULE_ICON } from "../../../src/ui/icons";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { MORE_GROUPS } from "../../../src/ui/tabs";

export default function More() {
  const { permissions } = useSession();
  const router = useRouter();
  return (
    <Screen title="Diğer" back={false} subtitle={<FacilityName />}>
      {MORE_GROUPS.map((g) => {
        const mods = g.modules.filter((k) => moduleVisible(permissions, k)).map((k) => MODULES.find((m) => m.key === k)!);
        if (mods.length === 0) return null;
        return [
          <SectionHeader key={`${g.title}-h`} title={g.title} />,
          <ListGroup key={g.title} testID={`grup-${g.title}`}>
            {mods.map((m) => (
              <ListRow
                key={m.key}
                title={m.title}
                domain={MODULE_ICON[m.key].domain}
                icon={MODULE_ICON[m.key].icon}
                onPress={() => router.push(m.route as never)}
                testID={`menu-${m.key}`}
              />
            ))}
          </ListGroup>,
        ];
      })}
    </Screen>
  );
}
