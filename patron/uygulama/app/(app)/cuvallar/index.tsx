// Çuval deposu — sevk edilmemiş çuvallar (depoda + onay bekleyen sevkiyata atanmış): özet, müşteri kovaları, çuval
// listesi; satır çuval ayrıntısına gider. Kaynak anlık `cuval-deposu` (saatlik); sayılar fabrikanın, SALT İZLEME.
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { sackDepotView } from "../../../src/lib/stok-cuval";
import { Screen } from "../../../src/ui/Frame";
import { EMPTY_ICON } from "../../../src/ui/icons";
import { Card } from "../../../src/ui/kit";
import { ListGroup, ListRow } from "../../../src/ui/ListRow";
import { FactoryStamp, SnapshotGate } from "../../../src/ui/pano/SnapshotGate";
import { useSnapshot } from "../../../src/ui/pano/useSnapshot";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { Empty } from "../../../src/ui/StateViews";
import { StatusBadge } from "../../../src/ui/StatusBadge";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

const EMPTY = "Fabrikadan çuval bilgisi henüz gelmedi";

export default function SackDepot() {
  const router = useRouter();
  const s = useStyles();
  const remote = useSnapshot("cuval-deposu");
  // Müşteri kovasına dokunmak listeyi o müşteriye süzer (undefined = hepsi; null = müşterisiz).
  const [cari, setCari] = useState<string | null | undefined>(undefined);
  return (
    <Screen title="Çuval deposu" module="sevkiyat" back onRefresh={remote.reload} refreshing={remote.refreshing}>
      <SnapshotGate remote={remote} domain="sevkiyat" variant="list" rows={5} empty={EMPTY} testID="cuval-deposu">
        {(veri, snap) => {
          const v = sackDepotView(veri, cari);
          if (!v) return <Empty text={EMPTY} domain="sevkiyat" icon={EMPTY_ICON.bekliyor} testID="cuval-deposu-bos" />;
          const picked = cari === undefined ? null : v.customers.find((c) => c.key === (cari ?? "none"));
          return (
            <>
              <FactoryStamp snap={snap} offline={remote.offline} note="saatlik güncellenir" />
              <Card domain="sevkiyat" testID="cuval-ozet">
                <Text style={s.title}>{v.summary}</Text>
                <Text style={s.line}>{v.detail}</Text>
              </Card>
              {v.customers.length > 1 ? (
                <>
                  <SectionHeader title="Müşteriler" domain="sevkiyat" count={v.customers.length} />
                  <ListGroup testID="cuval-cariler">
                    {v.customers.map((c) => (
                      <ListRow
                        key={c.key} title={c.title} value={c.value} lines={c.lines} domain="sevkiyat" icon="people-outline"
                        onPress={() => setCari(c.key === "none" ? null : c.key)}
                        testID={`cuval-cari-${c.key}`}
                      />
                    ))}
                  </ListGroup>
                </>
              ) : null}
              <SectionHeader
                title={picked ? `Çuvallar · ${picked.title}` : "Çuvallar"} domain="sevkiyat" count={v.sacks.length}
                {...(picked ? { actionLabel: "Tümü", onAction: () => setCari(undefined) } : {})}
                testID="bolum-cuvallar"
              />
              {v.sacks.length === 0 ? (
                <Empty text="Depoda çuval yok" domain="sevkiyat" icon={EMPTY_ICON.bekliyor} testID="cuval-yok" />
              ) : (
                <ListGroup testID="cuval-listesi">
                  {v.sacks.map((c) => (
                    <ListRow
                      key={c.key} title={c.title} value={c.value} lines={c.lines} domain="sevkiyat" icon="cube-outline"
                      accessory={c.assigned ? <StatusBadge kind="bilgi" label="Sevkiyatta" size="sm" /> : undefined}
                      onPress={() => router.push({ pathname: "/cuvallar/[id]", params: { id: c.key } } as never)}
                      testID={`cuval-${c.key}`}
                    />
                  ))}
                </ListGroup>
              )}
              {v.sinirli ? <Text style={s.note}>Liste en yeni çuvallarla sınırlı; özet eksiksizdir.</Text> : null}
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
