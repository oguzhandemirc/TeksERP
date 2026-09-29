// Pano: izinli özet kartları + son eşitleme damgası; telefonda bölüm kısayolları.
import { useRouter } from "expo-router";
import { View } from "react-native";
import { visibleCards, visibleModules } from "../../src/lib/access";
import { formatAgo } from "../../src/lib/format";
import { useSession } from "../../src/state/session";
import { FacilityName, Screen, useWide } from "../../src/ui/Frame";
import { Button, Card, Muted, Row } from "../../src/ui/kit";
import { SnapshotCard } from "../../src/ui/SnapshotCard";
import { space } from "../../src/ui/theme";

export default function Dashboard() {
  const { facility, permissions } = useSession();
  const router = useRouter();
  const wide = useWide();
  const cards = visibleCards(permissions);
  const last = facility?.esitleme?.sonEsitleme ?? null;
  return (
    <Screen title="Pano">
      {!wide ? <View style={{ marginBottom: space.m }}><FacilityName /></View> : null}
      <Muted>{last ? `Son eşitleme: ${formatAgo(last)}` : "Fabrikadan henüz eşitleme gelmedi"}</Muted>
      {facility?.esitleme?.sozlesmeUyarisi ? <Muted>{facility.esitleme.sozlesmeUyarisi}</Muted> : null}
      <View style={{ height: space.m }} />
      {!wide ? (
        <Card>
          <Row>
            {visibleModules(permissions)
              .filter((m) => m.key !== "pano")
              .map((m) => (
                <View key={m.key} style={{ flexBasis: "47%", flexGrow: 1 }}>
                  <Button label={m.title} tone="plain" onPress={() => router.push(m.route as never)} testID={`kisayol-${m.key}`} />
                </View>
              ))}
          </Row>
        </Card>
      ) : null}
      {cards.length === 0 ? <Muted>Özet görme izniniz yok; tesis yöneticinize başvurun.</Muted> : null}
      <View style={{ flexDirection: wide ? "row" : "column", flexWrap: "wrap", gap: space.m }}>
        {cards.map((c) => (
          <View key={c.projection} style={wide ? { flexBasis: "48%", flexGrow: 1 } : undefined}>
            <SnapshotCard projection={c.projection} title={c.title} />
          </View>
        ))}
      </View>
    </Screen>
  );
}
