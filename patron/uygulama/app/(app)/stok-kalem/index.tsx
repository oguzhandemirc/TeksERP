// Stok — kalem ve toplar: rafın kalem listesi (bitmiş: kumaş + en + renk + kat · ham: kumaş), satır o kalemin raf
// toplarına gider. Kaynak anlık `stok-kalem` (saatlik); sayılar ve sıra fabrikanın, görünüm `lib/stok-cuval`.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { STOK_BOLUMLERI, isStokBolum, stockKalemView, type StokBolum } from "../../../src/lib/stok-cuval";
import { Screen } from "../../../src/ui/Frame";
import { EMPTY_ICON } from "../../../src/ui/icons";
import { Card } from "../../../src/ui/kit";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { FactoryStamp, SnapshotGate } from "../../../src/ui/pano/SnapshotGate";
import { useSnapshot } from "../../../src/ui/pano/useSnapshot";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { Empty } from "../../../src/ui/StateViews";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

const EMPTY = "Fabrikadan kalem listesi henüz gelmedi";

export default function StockKalem() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bolum?: string }>();
  const s = useStyles();
  const [bolum, setBolum] = useState<StokBolum>(isStokBolum(params.bolum) ? params.bolum : "bitmis");
  const remote = useSnapshot("stok-kalem");
  return (
    <Screen title="Kalem ve toplar" module="stok" back onRefresh={remote.reload} refreshing={remote.refreshing}>
      <View style={s.segment}>
        <SegmentedControl items={STOK_BOLUMLERI} value={bolum} onChange={setBolum} testIDPrefix="stok-bolum-" accessibilityLabel="Stok bölümü" />
      </View>
      <SnapshotGate remote={remote} domain="stok" variant="list" rows={5} empty={EMPTY} testID="stok-kalem">
        {(veri, snap) => {
          const v = stockKalemView(veri, bolum);
          if (!v) return <Empty text={EMPTY} domain="stok" icon={EMPTY_ICON.bekliyor} testID="stok-kalem-bos" />;
          return (
            <>
              <FactoryStamp snap={snap} offline={remote.offline} note="saatlik güncellenir" />
              <Card domain="stok" testID="stok-kalem-ozet">
                <Text style={s.title}>{v.totalText}</Text>
                <Text style={s.line}>{bolum === "bitmis" ? "Raftaki bitmiş toplar; çuvaldakiler Çuval deposunda" : "Raftaki ham toplar (yarı mamul hariç)"}</Text>
                {v.emanetText ? <Text style={s.line}>{v.emanetText}</Text> : null}
              </Card>
              <SectionHeader title="Kalemler" domain="stok" count={v.rows.length} />
              {v.rows.length === 0 ? (
                <Empty text="Rafta top yok" domain="stok" icon={EMPTY_ICON.bekliyor} testID="stok-kalem-yok" />
              ) : (
                <ListGroup testID="stok-kalemler">
                  {v.rows.map((r) => (
                    <ListRow
                      key={r.key} title={r.title} value={r.value} lines={r.lines} domain="stok"
                      onPress={() => router.push({ pathname: "/stok-kalem/[anahtar]", params: { anahtar: r.key, bolum } } as never)}
                      testID={`stok-kalem-${r.key}`}
                    />
                  ))}
                </ListGroup>
              )}
              {v.sinirli ? <Text style={s.note}>Top listesi en eski toplarla sınırlı; kalem toplamları eksiksizdir.</Text> : null}
            </>
          );
        }}
      </SnapshotGate>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  segment: { marginTop: space.s, marginBottom: space.m },
  title: { ...typography.headline, color: t.text },
  line: { ...typography.body, color: t.textSecondary, marginTop: space.xs },
  note: { ...typography.footnote, color: t.textSecondary, marginTop: space.s },
}));
