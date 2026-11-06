// Sevk Kapısı kartı + liste boş/sorun durumu (SevkiyatScreen'den ayrıldı, gece UX turu 2026-11-06).
// Yük özeti birim türünü bilir: dökme/araba sevkiyatı "N çuval" yazmaz ve çıkarılamayan birime "Çuval Çıkar" önermez.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Surface, Text, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../../../components/TruncatedText';
import type { SackStoreShipmentLite } from '../../../services/packing.service';
import { boardSackUnits, boardUnitText, loadKgText } from '../../../lib/loadUnit';
import { QUERY_PROBLEM_TEXT, queryProblem } from '../../../utils/queryState';
import { colors, palette, radius, spacing, typography } from '../../../theme/tokens';
import { CariHoldChip, holdChipText } from './CariHold';

export const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

function waitText(since: string | null): string | null {
  if (!since) return null;
  const mins = Math.trunc((Date.now() - new Date(since).getTime()) / 60_000);
  if (mins < 60) return 'az önce';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saattir`;
  return `${Math.floor(hours / 24)} gündür`;
}

interface CardProps {
  sh: SackStoreShipmentLite;
  busy: boolean;
  onContents: (sh: SackStoreShipmentLite) => void;
  onCancel: (sh: SackStoreShipmentLite) => void;
  onDispatch: (sh: SackStoreShipmentLite) => void;
  /** PLANLI sevkiyata okutarak yük ekle (9.2) — verilmezse düğme yok (eski kullanım). */
  onAdd?: (sh: SackStoreShipmentLite) => void;
}

export function ShipmentBoardCard({ sh, busy, onContents, onCancel, onDispatch, onAdd }: CardProps) {
  const wait = waitText(sh.createdAt);
  const holdChip = holdChipText(sh);
  const removable = boardSackUnits(sh) > 0;
  const exportDest = sh.destination === 'EXPORT';
  return (
    <Surface style={styles.card} elevation={1}>
      <View style={styles.cardHead}>
        <View style={styles.titleWrap}>
          <Text style={styles.shipNo}>{sh.shipmentNo}</Text>
          <View style={[styles.chip, styles.chipReady]}>
            <Text style={[styles.chipText, { color: palette.violet[700] }]}>Planlı</Text>
          </View>
          {/* Saha #22: yurtiçi/yurtdışı rozeti */}
          <View style={[styles.chip, exportDest ? styles.chipExport : styles.chipDomestic]}>
            <Text style={[styles.chipText, { color: exportDest ? palette.blue[700] : colors.textSecondary }]}>
              {exportDest ? 'Yurtdışı' : 'Yurtiçi'}
            </Text>
          </View>
        </View>
        <Text style={styles.meta} testID={`sevk-yuk-${sh.id}`}>
          {boardUnitText(sh)} · {fmtM(sh.totalQty)} m
          {/* Dökme/araba tartılmaz — "0 kg" yazmak tartılmış gibi okunur; karışıkta kg çuvallarındır. */}
          {loadKgText(sh) ? ` · ${loadKgText(sh)}` : ''}
        </Text>
      </View>
      <View style={styles.customerRow}>
        <TruncatedText style={styles.customer} testID={`sevk-musteri-${sh.id}`}>
          {sh.customer.name}
          {sh.branch ? ` · ${sh.branch.name}` : ''}
        </TruncatedText>
        {wait ? <Text style={styles.waitText}>⏳ {wait}</Text> : null}
      </View>
      {holdChip ? <CariHoldChip text={holdChip} testID={`sevk-cari-kilit-${sh.id}`} /> : null}

      {/* İçeriği gör — dökümü lazy getirir; çuval varsa çıkarma da oradan */}
      <TouchableRipple
        onPress={() => onContents(sh)}
        style={styles.contentsBtn}
        accessibilityRole="button"
        testID={`sevk-icerik-${sh.id}`}
      >
        <View style={styles.contentsRow}>
          <Icon source="format-list-bulleted" size={20} color={colors.brandDark} />
          <Text style={styles.contentsText}>
            {sh.rollCount} top · içeriği gör{removable ? ' / çuval çıkar' : ''}
          </Text>
          <Icon source="chevron-right" size={22} color={colors.textMuted} />
        </View>
      </TouchableRipple>

      <CardActions sh={sh} busy={busy} removable={removable} onContents={onContents} onCancel={onCancel} onDispatch={onDispatch} onAdd={onAdd} />
    </Surface>
  );
}

/** Kart eylemleri — "Çuval Çıkar" yalnız çıkarılabilir çuval varken (dökme/araba yolu iptaldir). */
function CardActions({ sh, busy, removable, onContents, onCancel, onDispatch, onAdd }: CardProps & { removable: boolean }) {
  return (
    <View style={styles.cardActions}>
      {onAdd && sh.cartCount !== undefined ? (
        <Button
          mode="outlined"
          icon="barcode-scan"
          onPress={() => onAdd(sh)}
          disabled={busy}
          style={styles.actBtn}
          contentStyle={styles.actBtnContent}
          testID={`sevk-yuk-ekle-${sh.id}`}
        >
          Yük Ekle
        </Button>
      ) : null}
      {removable ? (
        <Button
          mode="outlined"
          icon="sack-percent"
          textColor={colors.warningDark}
          onPress={() => onContents(sh)}
          disabled={busy}
          style={styles.actBtn}
          contentStyle={styles.actBtnContent}
          testID={`sevk-cuval-cikar-${sh.id}`}
        >
          Çuval Çıkar
        </Button>
      ) : null}
      <Button
        mode="outlined"
        icon="cancel"
        textColor={palette.red[600]}
        onPress={() => onCancel(sh)}
        disabled={busy}
        style={styles.actBtn}
        contentStyle={styles.actBtnContent}
        testID={`sevk-iptal-${sh.id}`}
      >
        İptal Et
      </Button>
      <Button
        mode="contained"
        icon="truck-check"
        buttonColor={colors.successDark}
        onPress={() => onDispatch(sh)}
        disabled={busy}
        style={styles.actBtn}
        contentStyle={styles.actBtnContent}
      >
        Sevk Et
      </Button>
    </View>
  );
}

interface EmptyProps {
  q: { isLoading: boolean; isError: boolean; isPaused: boolean };
  search: string;
}

/** Boş liste ile "listeyi alamadım" ayrımı (`queryProblem`); çevrimdışıyken "sevkiyat yok" demez. */
export function BoardEmpty({ q, search }: EmptyProps) {
  if (q.isLoading) return <ActivityIndicator style={styles.loading} />;
  const problem = queryProblem(q);
  const icon = problem === 'offline' ? 'wifi-off' : problem ? 'alert-circle-outline' : search ? 'magnify-close' : 'truck-outline';
  const title = problem ? QUERY_PROBLEM_TEXT[problem] : search ? `"${search}" ile eşleşen sevkiyat yok` : 'Bekleyen sevkiyat yok';
  const hint = problem
    ? null
    : search
      ? 'Çuval kodu, sevk no ya da müşteri adıyla yeniden deneyin.'
      : 'Paketlemede kurulan sevkiyatlar çıkışı beklerken burada görünür.';
  return (
    <View style={styles.empty} testID="sevk-bos">
      <Icon source={icon} size={48} color={problem ? colors.warningDark : colors.textMuted} />
      <Text style={[styles.emptyTitle, problem ? { color: colors.warningText } : null]}>{title}</Text>
      {hint ? <Text style={styles.emptySub}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface, marginBottom: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  shipNo: { fontSize: typography.size.lg, fontWeight: '700', color: colors.text, fontFamily: 'monospace' },
  chip: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipReady: { backgroundColor: palette.violet[100] },
  chipExport: { backgroundColor: palette.blue[100] },
  chipDomestic: { backgroundColor: colors.surfaceMuted },
  chipText: { fontSize: 12, fontWeight: '700' },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: '600' },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  customer: { flex: 1, fontSize: typography.size.base, color: palette.slate[700] },
  waitText: { fontSize: typography.size.sm, color: colors.warningDark, fontWeight: '600', flexShrink: 0 },
  contentsBtn: { borderRadius: radius.sm, marginTop: spacing.sm, backgroundColor: palette.slate[50], minHeight: 56, justifyContent: 'center' },
  contentsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  contentsText: { flex: 1, fontSize: typography.size.sm, color: colors.brandDark, fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actBtn: { flex: 1 },
  actBtnContent: { minHeight: 56 },
  loading: { marginTop: spacing.xxl },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxxl, paddingHorizontal: spacing.xxl },
  emptyTitle: { fontSize: typography.size.lg, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  emptySub: { fontSize: typography.size.sm, color: colors.textMuted, textAlign: 'center' },
});
