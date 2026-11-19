// Üretim — "akış nerede tıkanıyor": dönem segmenti (fabrikanın 4 dönemi; fason sayıları aynı anlıktan seçilir,
// yeniden çekilmez) · 3 KPI · fasondaki işler (`fason-acik`, PB1) · akış şeridi + istasyon dağılımı (`uretim-akisi`) · "Makineler neden durdu?" · terbiye iş emirleri.
// `ozet.uretim`ten yalnız "bugün tamamlanan" okunur; kolon/istasyon `uretim-akisi`nden (aynı sayılar iki kez basılmaz).
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { can } from "../../../src/lib/access";
import { formatDate, formatNumber } from "../../../src/lib/format";
import { lookup } from "../../../src/lib/labels";
import { shipReadinessView } from "../../../src/lib/ship-readiness";
import { PERIODS, PERIOD_LABEL, UNIT, WORK_ORDER_STATUS, WORK_ORDER_TYPE, recordStatus, type PeriodKey } from "../../../src/lib/labels/uretim";
import { TERIM } from "../../../src/lib/terim";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { openRecord } from "../../../src/ui/nav";
import { KpiCard, KpiGrid } from "../../../src/ui/KpiCard";
import { ListRow } from "../../../src/ui/ListRow";
import { FlowStrip, StationBars } from "../../../src/ui/pano/production";
import { column, obj, period, pct, qty, str } from "../../../src/ui/pano/read";
import { RecordStatusBadge } from "../../../src/ui/pano/RecordStatusBadge";
import { MachineStopsCard } from "../../../src/ui/pano/MachineStopsCard";
import { SubcontractOpenSection } from "../../../src/ui/fason/FasonCards";
import { RemoteList, useRecordPage } from "../../../src/ui/pano/RemoteList";
import { FactoryStamp, SnapshotGate } from "../../../src/ui/pano/SnapshotGate";
import { combine, useSnapshot } from "../../../src/ui/pano/useSnapshot";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { StatusBadge } from "../../../src/ui/StatusBadge";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";
import { EMPTY_ICON } from "../../../src/ui/icons";
import { ListGroup } from "../../../src/ui/ListRow";
import { useListCapability } from "../../../src/ui/siparis/capabilities";
import { STAGE_LABEL } from "../../../src/lib/is-emri";

/** "Toplar nerede?" satırları: akış kolonu (fabrikanın top sayısı) → o aşamadaki iş emirleri. */
const WHERE_ROWS = [
  { key: "kursun", column: "kursun", icon: "scan-outline" },
  { key: "tambur", column: "tambur", icon: "disc-outline" },
  { key: "fason", column: "fason", icon: "color-fill-outline" },
  { key: "depo", column: "depo", icon: "cube-outline" },
] as const;

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
  const stageFilter = useListCapability().memberFilter("is-emri", "asama");

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

      {read ? <SubcontractOpenSection /> : null}

      <SectionHeader title="Üretim akışı" domain="uretim" testID="bolum-akis" />
      <SnapshotGate remote={flow} domain="uretim" variant="list" rows={2} empty="Fabrikadan akış verisi henüz gelmedi" testID="uretim-akisi">
        {(veri, snap) => (
          <>
            <FactoryStamp snap={snap} offline={flow.offline} />
            <FlowStrip data={veri} />
            {stageFilter ? (
              <>
                <SectionHeader title="Toplar nerede?" domain="uretim" testID="bolum-nerede" onAction={() => router.push("/is-emirleri" as never)} actionLabel="İş emirleri" />
                <ListGroup testID="toplar-nerede">
                  {WHERE_ROWS.map((w) => {
                    const c = column(veri, w.column);
                    return c ? (
                      <ListRow
                        key={w.key} title={STAGE_LABEL[w.key]!} value={`${qty(c.count)} ${UNIT.top}`} icon={w.icon} domain="uretim"
                        onPress={() => router.push({ pathname: "/is-emirleri", params: { asama: w.key } } as never)}
                        testID={`nerede-${w.key}`}
                      />
                    ) : null;
                  })}
                </ListGroup>
              </>
            ) : null}
            <SectionHeader title="İstasyonlar" domain="uretim" testID="bolum-istasyonlar" />
            <StationBars data={veri} />
          </>
        )}
      </SnapshotGate>

      <MachineStopsCard />

      <SectionHeader title={TERIM.terbiyeIsEmri.cogul} domain="uretim" testID="bolum-is-emirleri" onAction={() => router.push("/is-emirleri" as never)} />
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
          const ready = shipReadinessView(k);
          const lines = [`${lookup(WORK_ORDER_TYPE, k.tur)}${end ? ` · plan ${formatDate(end)}` : ""}`, `${formatNumber(k.uretilenMetre, 0)} / ${formatNumber(k.hedefMiktar, 0)} ${UNIT.metre} üretildi`];
          return (
            <ListRow
              title={str(k.isEmriNo) ?? "—"}
              accessory={
                <View style={s.badges}>
                  <RecordStatusBadge entry={st} testID={`durum-${r.id}`} />
                  {ready ? <StatusBadge kind={ready.kind} label={ready.label} size="sm" testID={`sevke-hazir-${r.id}`} /> : null}
                </View>
              }
              lines={ready ? [...lines, ready.text] : lines}
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
  badges: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.xs, justifyContent: "flex-end" as const },
}));
