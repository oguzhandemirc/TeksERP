// Dokuma iş emri ayrıntısı (salt okuma): ilerleme · şu an tezgahta (koşum, duruş, operatör, takılı levent) · leventler ·
// son indirmeler · son koşumlar. Kaynak `GET /weaving-orders/:id/overview` (panelin `WeavingOrderDetailSheet`iyle aynı uç).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import TruncatedText from '../../../../components/TruncatedText';
import { formatFactory } from '../../../../lib/factory-time';
import { TERIM } from '../../../../lib/terim';
import { WORK_ORDER_STATUS_LABEL, trLabel } from '../../../../utils/labels';
import { queryProblem } from '../../../../utils/queryState';
import type { WeavingOrderOverview } from '../../../../services/weavingOrder.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { kumasMetni } from './dokumaListe';
import { useDokumaGenelBakis } from './useDokumaListesi';

const metre = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('tr-TR')} m`);
const saat = (iso: string | null | undefined) => formatFactory(iso ?? null, 'dd.MM HH:mm');

interface Props {
  id: string | null;
  baslik: string;
  onClose: () => void;
}

export default function DokumaIsEmriDetaySheet({ id, baslik, onClose }: Props) {
  const q = useDokumaGenelBakis(id);
  const d = q.data;
  const problem = d ? null : queryProblem(q);
  return (
    <ModuleSheet
      visible={!!id}
      onDismiss={onClose}
      title={baslik}
      subtitle={d ? `${kumasMetni(d.order).ana} · ${trLabel(WORK_ORDER_STATUS_LABEL, d.order.status)}` : TERIM.dokumaIsEmri.tekil}
      footer={
        <View style={styles.footer}>
          <Button mode="outlined" icon="refresh" onPress={() => void q.refetch()} contentStyle={styles.btn} disabled={!id}>Yenile</Button>
          <Button mode="contained" onPress={onClose} contentStyle={styles.btn} testID="dokuma-detay-kapat">Kapat</Button>
        </View>
      }
    >
      {!d && !problem && <ActivityIndicator style={styles.pad} color={colors.brand} />}
      {problem && <Text style={styles.muted} testID="dokuma-detay-hata">{problem === 'offline' ? 'Çevrimdışısınız — ayrıntı alınamıyor. Bağlantı gelince Yenile’ye dokunun.' : 'Ayrıntı alınamadı — sunucuya ulaşılamıyor. Bağlantıyı kontrol edip Yenile’ye dokunun.'}</Text>}
      {d && <OverviewBody d={d} />}
    </ModuleSheet>
  );
}

function OverviewBody({ d }: { d: WeavingOrderOverview }) {
  const p = d.progress;
  const k = kumasMetni(d.order);
  const fason = d.executionKind === 'SUBCONTRACTED';
  return (
    <View style={styles.body} testID="dokuma-detay-govde">
      <View style={styles.kpis}>
        <Kpi label="Hedef" value={p.plannedM == null ? 'Açık uçlu' : metre(p.plannedM)} />
        {fason ? <Kpi label="Fason kabul" value={metre(p.fasonReceivedM)} /> : <Kpi label="Üretilen top" value={metre(p.rollMeters)} sub={`${p.rollCount} top · ${p.doffCount} indirme`} />}
        <Kpi label="Koşum metresi" value={metre(p.runMeters)} sub={p.unmeasuredRunCount > 0 ? `${p.unmeasuredRunCount} koşum ölçülmedi` : `${p.closedRunCount} kapanmış koşum`} />
      </View>
      {k.alt ? <InfoLine etiket="Desen · renk" deger={k.alt} /> : null}
      {d.order.subcontractor ? <InfoLine etiket="Fasoncu" deger={d.order.subcontractor.name} /> : null}

      <Section baslik="Şu an tezgahta" toplam={d.liveRuns.total} kirpik={d.liveRuns.truncated}>
        {d.liveRuns.items.length === 0 ? <Text style={styles.muted}>Açık koşum yok.</Text> : d.liveRuns.items.map((r) => (
          <View key={r.id} style={styles.card}>
            <TruncatedText style={styles.cardTitle}>{`${r.machine.name} · Hat ${r.productionLineNo}`}</TruncatedText>
            <TruncatedText style={styles.cardSub}>{`Başladı ${saat(r.startedAt)} · ${r.doffCount} indirme${r.operator ? ` · ${r.operator.name}` : ''}`}</TruncatedText>
            {r.openStop && <Text style={styles.stop}>{`Duruşta: ${r.openStop.reasonLabel ?? r.openStop.reasonCode ?? 'sebep girilmedi'} (${saat(r.openStop.startedAt)})`}</Text>}
            {r.beams && r.beams.length > 0 && <Text style={styles.cardSub}>{`Levent: ${r.beams.map((b) => `${b.beamNo} (kalan ${metre(b.remainingM)})`).join(', ')}`}</Text>}
          </View>
        ))}
      </Section>

      {d.beams && (
        <Section baslik="Leventler" toplam={d.beams.total} kirpik={d.beams.truncated}>
          {d.beams.items.length === 0 ? <Text style={styles.muted}>Bu işe bağlı levent yok.</Text> : d.beams.items.map((b) => (
            <InfoLine key={b.id} etiket={b.beamNo} deger={`kalan ${metre(b.remainingM)} / ${metre(b.plannedLengthM)}${b.currentMachine ? ` · ${b.currentMachine.code}` : ''}`} />
          ))}
        </Section>
      )}

      <Section baslik="Son indirmeler" toplam={d.recentDoffs.total} kirpik={d.recentDoffs.truncated}>
        {d.recentDoffs.items.length === 0 ? <Text style={styles.muted}>Henüz indirme yok.</Text> : d.recentDoffs.items.map((x) => (
          <InfoLine key={x.id} etiket={`${saat(x.doffedAt)} · ${x.machine.name}`} deger={`${x.pieceCount} top · ${metre(x.rolls.reduce((s, r) => s + r.initialQty, 0))}`} />
        ))}
      </Section>

      <Section baslik="Son koşumlar" toplam={d.recentRuns.total} kirpik={d.recentRuns.truncated}>
        {d.recentRuns.items.length === 0 ? <Text style={styles.muted}>Kapanmış koşum yok.</Text> : d.recentRuns.items.map((r) => (
          <InfoLine key={r.id} etiket={`${r.machine.name} · Hat ${r.productionLineNo}`} deger={r.revokedAt ? 'Geri alındı' : `${saat(r.startedAt)} → ${saat(r.endedAt)} · ${metre(r.producedM)}`} />
        ))}
      </Section>
    </View>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
    </View>
  );
}

function Section({ baslik, toplam, kirpik, children }: { baslik: string; toplam: number; kirpik: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{kirpik ? `${baslik} (son ${toplam} içinden)` : baslik}</Text>
      {children}
    </View>
  );
}

function InfoLine({ etiket, deger }: { etiket: string; deger: string }) {
  return (
    <View style={styles.line}>
      <TruncatedText style={styles.lineLabel}>{etiket}</TruncatedText>
      <Text style={styles.lineValue}>{deger}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  btn: { minHeight: 56, paddingHorizontal: spacing.lg },
  pad: { marginVertical: spacing.xl },
  body: { gap: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  kpi: { flexGrow: 1, minWidth: 150, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  kpiLabel: { fontSize: typography.size.sm, color: colors.textMuted },
  kpiValue: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  section: { gap: spacing.xs },
  sectionTitle: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text, marginTop: spacing.sm },
  card: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 2 },
  cardTitle: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  cardSub: { fontSize: typography.size.sm, color: colors.textSecondary },
  stop: { fontSize: typography.size.sm, color: colors.warningText, fontWeight: typography.weight.semibold },
  line: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  lineLabel: { flex: 1, fontSize: typography.size.sm, color: colors.textSecondary },
  lineValue: { fontSize: typography.size.sm, color: colors.text, fontWeight: typography.weight.medium },
  muted: { fontSize: typography.size.sm, color: colors.textMuted },
});
