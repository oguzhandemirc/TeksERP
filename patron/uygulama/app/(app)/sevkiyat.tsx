// Sevkiyat — "ne gitti, zamanında mı": dönem segmenti (`ozet.sevkiyat` 4 dönemi, aynı anlıktan) · sevk metresi
// (BRÜT, fabrikanın verdiği gibi) · zamanında % · ortalama gecikme · son sevkler (no + müşteri + tarih / metre).
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { can } from "../../src/lib/access";
import { formatDate } from "../../src/lib/format";
import { PERIODS, PERIOD_LABEL, SHIPMENT_DESTINATION, SHIPMENT_STATUS, UNIT, recordStatus, type PeriodKey } from "../../src/lib/labels/uretim";
import { useSession } from "../../src/state/session";
import { Screen } from "../../src/ui/Frame";
import { openRecord } from "../../src/ui/nav";
import { KpiCard, KpiGrid } from "../../src/ui/KpiCard";
import { ListRow } from "../../src/ui/ListRow";
import { num, obj, period, pct, qty, str } from "../../src/ui/pano/read";
import { RecordStatusBadge } from "../../src/ui/pano/RecordStatusBadge";
import { RemoteList, useRecordPage } from "../../src/ui/pano/RemoteList";
import { FactoryStamp, SnapshotGate } from "../../src/ui/pano/SnapshotGate";
import { combine, useSnapshot } from "../../src/ui/pano/useSnapshot";
import { SectionHeader } from "../../src/ui/SectionHeader";
import { SegmentedControl } from "../../src/ui/SegmentedControl";
import { makeStyles } from "../../src/ui/theme-context";
import { space, typography } from "../../src/ui/tokens";

export default function Shipments() {
  const { permissions } = useSession();
  const router = useRouter();
  const s = useStyles();
  const [p, setP] = useState<PeriodKey>("bugun");
  const summary = useSnapshot("ozet.sevkiyat", can(permissions, "bulut:ozet:oku") && can(permissions, "bulut:sevkiyat:oku"));
  const list = useRecordPage("sevkiyat", can(permissions, "bulut:sevkiyat:oku"));
  const all = combine([summary, list]);
  return (
    <Screen module="sevkiyat" onRefresh={all.reload} refreshing={all.refreshing}>
      {can(permissions, "bulut:ozet:oku") ? (
        <>
          <View style={s.segment}>
            <SegmentedControl items={PERIODS} value={p} onChange={setP} testIDPrefix="donem-" accessibilityLabel="Dönem" />
          </View>
          <SnapshotGate remote={summary} domain="sevkiyat" rows={3} testID="sevk-ozet">
            {(veri, snap) => {
              const d = period(veri, p);
              const late = num(d.ortGecikmeGun);
              return (
                <>
                  <KpiGrid testID="sevk-kpi">
                    <KpiCard label="Sevk edilen" value={qty(d.sevkMiktari)} unit={UNIT.metre} caption={`${PERIOD_LABEL[p]} · ${qty(d.sevkTopSayisi)} ${UNIT.top} · brüt`} domain="sevkiyat" testID="kpi-sevk-metre" />
                    <KpiCard label="Zamanında teslim" value={pct(d.zamanindaYuzde)} caption={`${qty(d.tamamlananSiparis)} sipariş tamamlandı`} domain="sevkiyat" icon="checkmark-done-outline" testID="kpi-zamaninda" />
                    <KpiCard
                      label="Ortalama gecikme"
                      value={late === null ? "Yok" : qty(late)}
                      unit={late === null ? undefined : UNIT.gun}
                      caption={late === null ? "Geciken teslim yok" : "Termini kaçan siparişlerde"}
                      domain="sevkiyat"
                      icon="time-outline"
                      testID="kpi-gecikme"
                    />
                  </KpiGrid>
                  <FactoryStamp snap={snap} offline={summary.offline} note="brüt, iade düşülmez" />
                </>
              );
            }}
          </SnapshotGate>
        </>
      ) : null}

      <SectionHeader title="Son sevkler" domain="sevkiyat" testID="bolum-son-sevkler" />
      <RemoteList
        projection="sevkiyat"
        remote={list}
        empty="Henüz sevkiyat yok"
        domain="sevkiyat"
        testID="sevkler"
        renderRow={(r) => {
          const k = obj(r.kayit);
          const st = recordStatus(SHIPMENT_STATUS, k.durum);
          const when = str(k.cikisTarihi) ?? str(k.olusturulma);
          const dest = k.yon === "EXPORT" ? ` · ${SHIPMENT_DESTINATION.EXPORT}` : "";
          // Sevk edilmiş satır sağda metreyi taşır; onay bekleyen/iptal satırında sağda rozet, metre alt metne iner.
          const sent = k.durum === "DISPATCHED";
          const meters = `${qty(k.toplamMetre)} ${UNIT.metre}`;
          // Eski paketlerde müşteri adı yok: başlık "—" yerine sevk numarası olur.
          const customer = str(k.musteriAdi);
          const no = str(k.sevkNo) ?? "—";
          return (
            <ListRow
              title={customer ?? no}
              value={sent ? meters : undefined}
              accessory={sent ? undefined : <RecordStatusBadge entry={st} testID={`durum-${r.id}`} />}
              lines={[`${customer ? `${no} · ` : ""}${formatDate(when)}${dest}${sent ? "" : ` · ${meters}`}`]}
              domain="sevkiyat"
              onPress={() => openRecord(router, "sevkiyat", r.id)}
              testID={`kayit-${r.id}`}
            />
          );
        }}
      />
      <Text style={s.note}>Sevk rakamları brüttür; iadeler ayrı belgeyle izlenir.</Text>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  segment: { marginTop: space.s, marginBottom: space.m },
  note: { ...typography.footnote, color: t.textSecondary, marginTop: space.s },
}));
