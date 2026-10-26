// Stok — "ne var, kaç gündür duruyor": ham · yarı mamul · bitmiş (metre + top) · ölü stok uyarısı · yaş dağılımı ·
// kumaş bazında ilk satırlar. Tek kaynak `stok-karnesi` (saatlik anlık; "Fabrika verisi HH:MM" ile söylenir).
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { DEAD_STOCK_STATUS, STOCK_AGE_TONE, UNIT } from "../../src/lib/labels/uretim";
import { AgingBar } from "../../src/ui/charts";
import { Screen } from "../../src/ui/Frame";
import { KpiCard, KpiGrid } from "../../src/ui/KpiCard";
import { ListGroup, ListRow } from "../../src/ui/ListRow";
import { arr, num, obj, pct, qty, str } from "../../src/ui/pano/read";
import { FactoryStamp, SnapshotGate } from "../../src/ui/pano/SnapshotGate";
import { useSnapshot } from "../../src/ui/pano/useSnapshot";
import { SectionHeader } from "../../src/ui/SectionHeader";
import { StatusBadge } from "../../src/ui/StatusBadge";
import { makeStyles } from "../../src/ui/theme-context";
import { STRIPE, radius, space, typography } from "../../src/ui/tokens";

const TOP_ITEMS = 8;

export default function Stock() {
  const card = useSnapshot("stok-karnesi");
  return (
    <Screen module="stok" onRefresh={card.reload} refreshing={card.refreshing}>
      <SnapshotGate remote={card} domain="stok" rows={3} empty="Fabrikadan stok karnesi henüz gelmedi" testID="stok-karnesi">
        {(veri, snap) => <StockBody data={veri} stamp={<FactoryStamp snap={snap} offline={card.offline} note="saatlik güncellenir" testID="fabrika-verisi" />} />}
      </SnapshotGate>
    </Screen>
  );
}

function StockBody({ data, stamp }: { readonly data: unknown; readonly stamp: ReactNode }) {
  const s = useStyles();
  const o = obj(obj(data).ozet);
  const dead = (num(o.oluMiktar) ?? 0) > 0;
  const deadSt = DEAD_STOCK_STATUS[dead ? "var" : "yok"];
  const ages = arr(obj(data).yasKovalari);
  const items = arr(obj(data).urunler).slice(0, TOP_ITEMS);
  return (
    <View>
      {stamp}
      <KpiGrid testID="stok-kpi">
        <KpiCard label="Ham" value={qty(o.hamMiktar)} unit={UNIT.metre} caption={`${qty(o.hamAdet)} ${UNIT.top}`} domain="stok" icon="layers-outline" testID="kpi-ham" />
        <KpiCard label="Yarı mamul" value={qty(o.yariMamulMiktar)} unit={UNIT.metre} caption={`${qty(o.yariMamulAdet)} ${UNIT.top}`} domain="stok" icon="sync-outline" testID="kpi-yari" />
        <KpiCard label="Bitmiş" value={qty(o.bitmisMiktar)} unit={UNIT.metre} caption={`${qty(o.bitmisAdet)} ${UNIT.top}`} domain="stok" icon="cube-outline" testID="kpi-bitmis" />
      </KpiGrid>

      <View style={[s.dead, dead ? s.deadOn : null]} testID="olu-stok" accessible accessibilityLabel={`Ölü stok: ${qty(o.oluMiktar)} ${UNIT.metre}`}>
        <View style={s.deadHead}>
          <Text style={s.deadTitle}>Ölü stok</Text>
          <StatusBadge kind={deadSt.tone} label={deadSt.label} size="sm" testID="olu-stok-rozet" />
        </View>
        <Text style={s.deadValue}>{`${qty(o.oluMiktar)} ${UNIT.metre}`}</Text>
        <Text style={s.deadNote}>{`${qty(o.oluStokGun)} günden uzun duran ve siparişi olmayan bitmiş stok · yaşlı ${qty(o.yasliMiktar)} ${UNIT.metre}`}</Text>
      </View>

      {ages.length > 0 ? (
        <>
          <SectionHeader title="Yaş dağılımı" domain="stok" testID="bolum-yas" />
          <View style={s.card}>
            <AgingBar
              testID="yas-kovalari"
              segments={ages.map((a) => ({
                label: str(a.etiket) ?? String(a.anahtar),
                value: num(a.miktar) ?? 0,
                tone: STOCK_AGE_TONE[String(a.anahtar)] ?? "bilgi",
                valueText: `${qty(a.miktar)} ${UNIT.metre} · ${pct(a.yuzde)}`,
              }))}
            />
            {(num(o.yassizAdet) ?? 0) > 0 ? <Text style={s.footnote}>{`Yaşı bilinmeyen: ${qty(o.yassizAdet)} ${UNIT.top} · ${qty(o.yassizMiktar)} ${UNIT.metre}`}</Text> : null}
          </View>
        </>
      ) : null}

      {items.length > 0 ? (
        <>
          <SectionHeader title="Kumaş bazında" domain="stok" testID="bolum-kumas" />
          <ListGroup testID="stok-kumaslar">
            {items.map((i) => {
              const open = (num(i.siparissizMiktar) ?? 0) > 0;
              const oldest = num(i.enEskiGun);
              return (
                <ListRow
                  key={String(i.anahtar)}
                  title={str(i.etiket) ?? "—"}
                  subtitle={`${qty(i.adet)} ${UNIT.top}${oldest === null ? "" : ` · en eski ${qty(oldest)} ${UNIT.gun}`}${open ? ` · siparişsiz ${qty(i.siparissizMiktar)} ${UNIT.metre}` : ""}`}
                  value={`${qty(i.miktar)} ${UNIT.metre}`}
                  domain="stok"
                />
              );
            })}
          </ListGroup>
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, marginBottom: space.m, ...t.cardShadow },
  dead: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, borderLeftWidth: STRIPE, borderLeftColor: t.status.iyi.fill, marginBottom: space.m, ...t.cardShadow },
  deadOn: { borderLeftColor: t.status.uyari.fill },
  deadHead: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  deadTitle: { ...typography.headline, color: t.text },
  deadValue: { ...typography.kpi, color: t.text, marginTop: space.s },
  deadNote: { ...typography.footnote, color: t.textSecondary, marginTop: space.xs },
  footnote: { ...typography.footnote, color: t.textSecondary, marginTop: space.m },
}));
