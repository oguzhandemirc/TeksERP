// Fason · emanet kartları (genel fason PB1): fabrikanın `emanet-bakiye` · `fason-acik` · `hizmet-geliri` anlıklarını
// çizer. Rakamlar fabrikanın; görünüm `lib/fason-summary`. Anlık yoksa (eski fabrika, kapalı modül) 404 → boş durum.
import { useState } from "react";
import { Text, View } from "react-native";
import { consignedView, scorecardConsignedLines, serviceRevenueView, subcontractOpenView } from "../../lib/fason-summary";
import { PERIODS, type PeriodKey } from "../../lib/labels/uretim";
import { SegmentedControl } from "../SegmentedControl";
import { Card } from "../kit";
import { ListGroup, ListRow } from "../ListRow";
import { FactoryStamp, SnapshotGate } from "../pano/SnapshotGate";
import { useSnapshot } from "../pano/useSnapshot";
import { SectionHeader } from "../SectionHeader";
import { StatusBadge } from "../StatusBadge";
import { Empty } from "../StateViews";
import { EMPTY_ICON } from "../icons";
import { makeStyles } from "../theme-context";
import { space, typography } from "../tokens";

/**
 * Stok › Müşteri malı: karnenin emanet satırı (ham · yarı · bitmiş) + müşteri başına bakiye. Fabrika emanet
 * satırı da bakiye anlığı da göndermediyse (emanet kullanmayan fabrika) bölüm HİÇ çizilmez.
 */
export function ConsignedSection({ scorecardOzet }: { readonly scorecardOzet: unknown }) {
  const s = useStyles();
  const remote = useSnapshot("emanet-bakiye");
  const lines = scorecardConsignedLines(scorecardOzet);
  const view = remote.data ? consignedView(remote.data.veri) : null;
  if (!lines && !view && !remote.loading) return null;
  return (
    <View testID="emanet-bolumu">
      <SectionHeader title="Müşteri malı (emanet)" domain="stok" testID="bolum-emanet" />
      <Text style={s.note}>Yukarıdaki rakamlar bizim stoğumuz; müşterinin bize bıraktığı mal burada ayrı.</Text>
      {lines ? (
        <Card domain="stok" testID="emanet-karne">
          {lines.map((l) => (
            <View key={l.label} style={s.kv}>
              <Text style={s.k}>{l.label}</Text>
              <Text style={s.v}>{l.value}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      {view ? (
        <>
          <FactoryStamp snap={remote.data} offline={remote.offline} note="saatlik güncellenir" />
          {view.rows.length === 0 ? (
            <Empty text="İçeride müşteri malı yok" domain="stok" icon={EMPTY_ICON.bekliyor} testID="emanet-bos" />
          ) : (
            <ListGroup testID="emanet-cariler">
              {view.rows.map((r) => <ListRow key={r.key} title={r.title} value={r.value} lines={r.lines} domain="stok" icon="person-outline" testID={`emanet-cari-${r.key}`} />)}
            </ListGroup>
          )}
        </>
      ) : null}
    </View>
  );
}

/** Üretim › Fasondaki işler: açık sevk, geciken dönüş, firma başına kalan. */
export function SubcontractOpenSection() {
  const s = useStyles();
  const remote = useSnapshot("fason-acik");
  return (
    <View>
      <SectionHeader title="Fasondaki işler" domain="fason" testID="bolum-fason-acik" />
      <SnapshotGate remote={remote} domain="fason" variant="list" rows={2} empty="Fabrikadan fason bilgisi henüz gelmedi" testID="fason-acik">
        {(veri, snap) => {
          const v = subcontractOpenView(veri);
          if (!v) return <Empty text="Fabrikadan fason bilgisi henüz gelmedi" domain="fason" icon={EMPTY_ICON.bekliyor} testID="fason-acik-bos" />;
          return (
            <>
              <FactoryStamp snap={snap} offline={remote.offline} note="saatlik güncellenir" />
              <Card domain="fason" testID="fason-acik-ozet">
                <View style={s.row}>
                  <Text style={s.title}>{v.openText}</Text>
                  <StatusBadge kind={v.late ? "kritik" : "iyi"} label={v.late ? "Gecikme var" : "Zamanında"} size="sm" testID="fason-acik-rozet" />
                </View>
                <Text style={s.line} testID="fason-acik-geciken">{v.lateText}</Text>
                {v.soonText ? <Text style={s.line} testID="fason-acik-yaklasan">{v.soonText}</Text> : null}
                <Text style={s.line} testID="fason-acik-kalan">{v.remainingText}</Text>
                {v.clipped ? <Text style={s.note}>Çok sayıda açık sevk var; firma listesi ilk sevklerden hazırlandı.</Text> : null}
              </Card>
              {v.firms.length > 0 ? (
                <ListGroup testID="fason-acik-firmalar">
                  {v.firms.map((f) => <ListRow key={f.key} title={f.title} value={f.value} valueTone={f.late ? "kritik" : undefined} lines={f.lines} domain="fason" icon="business-outline" testID={`fason-firma-${f.key}`} />)}
                </ListGroup>
              ) : null}
            </>
          );
        }}
      </SnapshotGate>
    </View>
  );
}

/** Finans › Fatura üstü: seçili dönemde hangi hizmetten ne kadar kazandık (onaylı faturalar); dönem segmenti kendinde. */
export function ServiceRevenueSection() {
  const s = useStyles();
  const [period, setPeriod] = useState<PeriodKey>("buAy");
  const remote = useSnapshot("hizmet-geliri");
  return (
    <View testID="hizmet-geliri-bolumu">
      <SectionHeader title="Hizmet geliri" domain="finans" testID="bolum-hizmet-geliri" />
      <View style={s.segment}>
        <SegmentedControl items={PERIODS} value={period} onChange={setPeriod} testIDPrefix="gelir-donem-" accessibilityLabel="Gelir dönemi" />
      </View>
      <SnapshotGate remote={remote} domain="finans" variant="list" rows={3} empty="Fabrikadan hizmet geliri henüz gelmedi" testID="hizmet-geliri">
      {(veri, snap) => {
        const v = serviceRevenueView(veri, period);
        if (!v) return <Empty text="Fabrikadan hizmet geliri henüz gelmedi" domain="finans" icon={EMPTY_ICON.bekliyor} testID="hizmet-geliri-bos" />;
        return (
          <>
            <FactoryStamp snap={snap} offline={remote.offline} note="saatlik güncellenir" />
            <Card domain="finans" testID="hizmet-geliri-toplam">
              <Text style={s.caption}>Hizmet geliri (onaylı faturalar, KDV hariç)</Text>
              <Text style={s.big} testID="hizmet-geliri-tutar">{v.totalText}</Text>
            </Card>
            {v.rows.length === 0 ? (
              <Empty text="Bu dönemde hizmet faturası yok" domain="finans" icon={EMPTY_ICON.bekliyor} testID="hizmet-geliri-yok" />
            ) : (
              <ListGroup testID="hizmet-geliri-kalemler">
                {v.rows.map((r) => <ListRow key={r.key} title={r.title} value={r.value} lines={r.lines} domain="finans" icon="construct-outline" testID={`hizmet-${r.key}`} />)}
              </ListGroup>
            )}
          </>
        );
      }}
      </SnapshotGate>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  note: { ...typography.footnote, color: t.textSecondary, marginBottom: space.s },
  kv: { flexDirection: "row" as const, justifyContent: "space-between" as const, paddingVertical: space.xs },
  k: { ...typography.body, color: t.textSecondary },
  v: { ...typography.body, color: t.text },
  row: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  title: { ...typography.headline, color: t.text },
  line: { ...typography.body, color: t.text, marginTop: space.xs },
  caption: { ...typography.footnote, color: t.textSecondary },
  big: { ...typography.display, color: t.text, marginTop: space.s },
  segment: { marginBottom: space.m },
}));
