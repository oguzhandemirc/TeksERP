// Çuval ayrıntısı — çuvaldaki toplar (hayalet hariç, fabrika sırası). Kaynak aynı `cuval-deposu` anlığı; çuval artık
// listede yoksa (sevk edildi) boş durum.
import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { sackDetailView } from "../../../src/lib/stok-cuval";
import { Screen } from "../../../src/ui/Frame";
import { EMPTY_ICON } from "../../../src/ui/icons";
import { Card } from "../../../src/ui/kit";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { FactoryStamp, SnapshotGate } from "../../../src/ui/pano/SnapshotGate";
import { useSnapshot } from "../../../src/ui/pano/useSnapshot";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { Empty } from "../../../src/ui/StateViews";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

export default function SackDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStyles();
  const remote = useSnapshot("cuval-deposu");
  return (
    <Screen title="Çuval" module="sevkiyat" back onRefresh={remote.reload} refreshing={remote.refreshing}>
      <SnapshotGate remote={remote} domain="sevkiyat" variant="list" rows={4} empty="Fabrikadan çuval bilgisi henüz gelmedi" testID="cuval-ayrinti">
        {(veri, snap) => {
          const v = sackDetailView(veri, String(id ?? ""));
          if (!v) return <Empty text="Bu çuval artık depoda değil" domain="sevkiyat" icon={EMPTY_ICON.bulunamadi} testID="cuval-bulunamadi" />;
          return (
            <>
              <FactoryStamp snap={snap} offline={remote.offline} note="saatlik güncellenir" />
              <Card domain="sevkiyat" testID="cuval-kart">
                <Text style={s.title}>{v.title}</Text>
                <Text style={s.line}>{v.summary}</Text>
                <Text style={s.line}>{v.info}</Text>
              </Card>
              <SectionHeader title="Toplar" domain="sevkiyat" count={v.rolls.length} />
              {v.rolls.length === 0 ? (
                <Empty text="Çuval boş" domain="sevkiyat" icon={EMPTY_ICON.bekliyor} testID="cuval-bos" />
              ) : (
                <ListGroup testID="cuval-toplari">
                  {v.rolls.map((r) => <ListRow key={r.key} title={r.title} value={r.value} lines={r.lines} domain="sevkiyat" testID={`cuval-top-${r.key}`} />)}
                </ListGroup>
              )}
            </>
          );
        }}
      </SnapshotGate>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  title: { ...typography.headline, color: t.text },
  line: { ...typography.body, color: t.textSecondary, marginTop: space.xs },
}));
