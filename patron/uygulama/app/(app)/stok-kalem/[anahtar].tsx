// Kalemin raf topları — top no · metre · depo · parti · rafta gün (en yaşlı önce, fabrika sırası). Kaynak aynı
// `stok-kalem` anlığı (önbellekten); kalem artık rafta yoksa boş durum.
import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { isStokBolum, kalemRollsView } from "../../../src/lib/stok-cuval";
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

export default function KalemRolls() {
  const { anahtar, bolum } = useLocalSearchParams<{ anahtar: string; bolum?: string }>();
  const s = useStyles();
  const remote = useSnapshot("stok-kalem");
  const section = isStokBolum(bolum) ? bolum : "bitmis";
  return (
    <Screen title="Kalemin topları" module="stok" back onRefresh={remote.reload} refreshing={remote.refreshing}>
      <SnapshotGate remote={remote} domain="stok" variant="list" rows={5} empty="Fabrikadan kalem listesi henüz gelmedi" testID="kalem-toplari">
        {(veri, snap) => {
          const v = kalemRollsView(veri, section, String(anahtar ?? ""));
          if (!v) return <Empty text="Bu kalem artık rafta yok" domain="stok" icon={EMPTY_ICON.bulunamadi} testID="kalem-yok" />;
          return (
            <>
              <FactoryStamp snap={snap} offline={remote.offline} note="saatlik güncellenir" />
              <Card domain="stok" testID="kalem-ozet">
                <Text style={s.title}>{v.title}</Text>
                <Text style={s.line}>{v.summary}</Text>
              </Card>
              <SectionHeader title="Toplar" domain="stok" count={v.rows.length} />
              <ListGroup testID="kalem-toplar">
                {v.rows.map((r) => <ListRow key={r.key} title={r.title} value={r.value} lines={r.lines} domain="stok" testID={`top-${r.key}`} />)}
              </ListGroup>
              {v.eksik ? <Text style={s.note}>Liste fabrikanın en eski toplarıyla sınırlı; bu kalemin bazı topları görünmüyor.</Text> : null}
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
  note: { ...typography.footnote, color: t.textSecondary, marginTop: space.s },
}));
