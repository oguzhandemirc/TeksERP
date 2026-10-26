// Üretim — "akış nerede tıkanıyor": dönem segmenti (fabrikanın 4 dönemi; fason sayıları aynı anlıktan seçilir,
// yeniden çekilmez) · 3 KPI · akış şeridi + istasyon dağılımı (`uretim-akisi`) · terbiye iş emirleri.
// `ozet.uretim`ten yalnız "bugün tamamlanan" okunur; kolon/istasyon `uretim-akisi`nden (aynı sayılar iki kez basılmaz).
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { can } from "../../../src/lib/access";
import { formatDate, formatNumber } from "../../../src/lib/format";
import { lookup } from "../../../src/lib/labels";
import { PERIODS, PERIOD_LABEL, UNIT, WORK_ORDER_STATUS, WORK_ORDER_TYPE, recordStatus, type PeriodKey } from "../../../src/lib/labels/uretim";
import { TERIM } from "../../../src/lib/terim";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { openRecord } from "../../../src/ui/nav";
import { KpiCard, KpiGrid } from "../../../src/ui/KpiCard";
import { ListRow } from "../../../src/ui/ListRow";
import { FlowStrip, StationBars } from "../../../src/ui/pano/production";
import { obj, period, pct, qty, str } from "../../../src/ui/pano/read";
import { RecordStatusBadge } from "../../../src/ui/pano/RecordStatusBadge";
import { RemoteList, useRecordPage } from "../../../src/ui/pano/RemoteList";
import { FactoryStamp, SnapshotGate } from "../../../src/ui/pano/SnapshotGate";
import { combine, useSnapshot } from "../../../src/ui/pano/useSnapshot";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";
import { EMPTY_ICON } from "../../../src/ui/icons";

export default function Production() {
  const { permissions } = useSession();
  const router = useRouter();
  const s = useStyles();
  const [p, setP] = useState<PeriodKey>("buAy");
  const summary = can(permissions, "bulut:ozet:oku") && can(permissions, "bulut:uretim:oku");
  const read = can(permissions, "bulut:uretim:oku");
  const today = useSnapshot("ozet.uretim", summary);
  const fason = useSnapshot("ozet.fason", summary);
  const flow = useSnapshot("uretim-akisi", read);
  const orders = useRecordPage("is-emri", read);
  const all = combine([today, fason, flow, orders]);
  const f = period(fason.data?.veri, p);

  return (
    <Screen module="uretim" back={false} onRefresh={all.reload} refreshing={all.refreshing}>
      {summary ? (
        <>
          <Text style={s.caption}>Dönem</Text>
          <View style={s.segment}>
            <SegmentedControl items={PERIODS} value={p} onChange={setP} testIDPrefix="donem-" accessibilityLabel="Dönem" />
          </View>
          <KpiGrid testID="uretim-kpi">
            {today.data ? (
              <KpiCard
                label="Bugün tamamlanan"
                value={qty(obj(today.data.veri).bugunTamamlananToplam)}
                unit={UNIT.top}
                caption="Bugün · dönemden bağımsız"
                domain="uretim"
                icon="today-outline"
                testID="kpi-bugun-tamamlanan"
              />
            ) : null}
            {fason.data ? (
              <KpiCard
                label="Fasonda bekleyen"
                value={qty(f.acikMiktar)}
                unit={UNIT.metre}
                caption={`${PERIOD_LABEL[p]} · ${qty(f.acikKalem)} açık kalem`}
                domain="fason"
                lines={[{ label: "En eski açık", value: f.enEskiAcikGun === null || f.enEskiAcikGun === undefined ? "—" : `${qty(f.enEskiAcikGun)} ${UNIT.gun}` }]}
                testID="kpi-fasonda"
              />
            ) : null}
            {fason.data ? (
              <KpiCard
                label="Fason fire"
                value={pct(f.fireYuzde)}
                caption={`${PERIOD_LABEL[p]} · çekme dahil`}
                domain="fason"
                icon="cut-outline"
                lines={[{ label: "Ort. dönüş", value: f.ortDonusGun === null || f.ortDonusGun === undefined ? "—" : `${qty(f.ortDonusGun)} ${UNIT.gun}` }]}
                testID="kpi-fason-fire"
              />
            ) : null}
          </KpiGrid>
          {!today.data && !fason.data ? <SnapshotGate remote={today} domain="uretim">{() => null}</SnapshotGate> : null}
        </>
      ) : null}

      <SectionHeader title="Üretim akışı" domain="uretim" testID="bolum-akis" />
      <SnapshotGate remote={flow} domain="uretim" variant="list" rows={2} empty="Fabrikadan akış verisi henüz gelmedi" testID="uretim-akisi">
        {(veri, snap) => (
          <>
            <FactoryStamp snap={snap} offline={flow.offline} />
            <FlowStrip data={veri} />
            <SectionHeader title="İstasyonlar" domain="uretim" testID="bolum-istasyonlar" />
            <StationBars data={veri} />
          </>
        )}
      </SnapshotGate>

      <SectionHeader title={TERIM.terbiyeIsEmri.cogul} domain="uretim" testID="bolum-is-emirleri" />
      <RemoteList
        projection="is-emri"
        remote={orders}
        empty={`${TERIM.terbiyeIsEmri.tekil} yok`}
        domain="uretim"
        emptyIcon={EMPTY_ICON.isEmri}
        testID="is-emirleri"
        renderRow={(r) => {
          const k = obj(r.kayit);
          const st = recordStatus(WORK_ORDER_STATUS, k.durum);
          const end = str(k.planBitis);
          return (
            <ListRow
              title={str(k.isEmriNo) ?? "—"}
              accessory={<RecordStatusBadge entry={st} testID={`durum-${r.id}`} />}
              lines={[`${lookup(WORK_ORDER_TYPE, k.tur)}${end ? ` · plan ${formatDate(end)}` : ""}`, `${formatNumber(k.uretilenMetre, 0)} / ${formatNumber(k.hedefMiktar, 0)} ${UNIT.metre} üretildi`]}
              domain="uretim"
              icon="clipboard-outline"
              onPress={() => openRecord(router, "is-emri", r.id)}
              testID={`kayit-${r.id}`}
            />
          );
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  caption: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary, marginTop: space.s, marginBottom: space.xs },
  segment: { marginBottom: space.m },
}));
