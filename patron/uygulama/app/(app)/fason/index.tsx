// Fason firmaları — `fason-acik` anlığının firma şeridi (sıra fabrikanın: geciken ↓, açık ↓, ad). Satır firma ayrıntısına
// gider. Rakamlar fabrikanın; görünüm `lib/fason-summary`. Anlık yoksa (eski fabrika) 404 → boş durum.
import { useRouter } from "expo-router";
import { Text } from "react-native";
import { subcontractOpenView, subcontractRollsText } from "../../../src/lib/fason-summary";
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

export default function SubcontractFirms() {
  const router = useRouter();
  const s = useStyles();
  const remote = useSnapshot("fason-acik");
  return (
    <Screen title="Fason firmaları" module="uretim" back onRefresh={remote.reload} refreshing={remote.refreshing}>
      <SnapshotGate remote={remote} domain="fason" variant="list" rows={4} empty="Fabrikadan fason bilgisi henüz gelmedi" testID="fason-firmalar">
        {(veri, snap) => {
          const v = subcontractOpenView(veri);
          if (!v) return <Empty text="Fabrikadan fason bilgisi henüz gelmedi" domain="fason" icon={EMPTY_ICON.bekliyor} testID="fason-firmalar-bos" />;
          const rolls = subcontractRollsText(veri);
          return (
            <>
              <FactoryStamp snap={snap} offline={remote.offline} note="saatlik güncellenir" />
              <Card domain="fason" testID="fason-firmalar-ozet">
                <Text style={s.title}>{v.remainingText}</Text>
                {rolls ? <Text style={s.line}>{rolls}</Text> : null}
                <Text style={s.line}>{v.openText}</Text>
              </Card>
              <SectionHeader title="Firmalar" domain="fason" count={v.firms.length} />
              {v.firms.length === 0 ? (
                <Empty text="Fasonda açık iş yok" domain="fason" icon={EMPTY_ICON.bekliyor} testID="fason-firmalar-yok" />
              ) : (
                <ListGroup testID="fason-firmalar-liste">
                  {v.firms.map((f) => (
                    <ListRow
                      key={f.key} title={f.title} value={f.value} valueTone={f.late ? "kritik" : undefined} lines={f.lines} domain="fason" icon="business-outline"
                      onPress={() => router.push({ pathname: "/fason/[firmaId]", params: { firmaId: f.key } } as never)}
                      testID={`fason-firma-${f.key}`}
                    />
                  ))}
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
