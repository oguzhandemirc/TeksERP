import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';
import dayjs from 'dayjs';

import type { KursunDistributionRowBase } from '../../../services/kursunBypass.service';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// Kurşun Dağıtım — "Bekleyen" ve "Dağıtılmış" listelerinin PAYLAŞTIĞI kart
// gövdesi + biçimlendiriciler.
//
// Neden ayrı dosya: iki liste de aynı iş emri özetini gösterir (iş emri no,
// parti no'lar, ürün/renk, "N top · M m", en eski giriş, ACİL rozeti). Aynı
// gövdeyi iki yerde ayrı yazmak, sahada iki listenin BİRBİRİNDEN farklı okunması
// demek olurdu. Ekran dosyası bu iki listeyi import ettiği için ortak parçalar
// burada yaşar (döngüsel import olmasın).
// =============================================================================

/** Metraj — Türkçe binlik ayracı, en fazla 2 ondalık. */
export function fmtMeters(m: number): string {
  return m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}

/** "Ne zamandır bekliyor" — en eski topun adıma giriş anından türetilir. */
export function waitText(since: string | null): string | null {
  if (!since) return null;
  const mins = dayjs().diff(dayjs(since), 'minute');
  if (mins < 60) return 'az önce girdi';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saattir bekliyor`;
  return `${Math.floor(hours / 24)} gündür bekliyor`;
}

/** Atama anı — bugünse saat, değilse gün + saat. */
export function fmtAssignedAt(iso: string): string {
  const d = dayjs(iso);
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.format('DD.MM HH:mm');
}

/**
 * ACİL rozeti — hem gösterge hem toggle. Kart TouchableRipple'ının İÇİNDE
 * yaşar; RN'de iç dokunma hedefi dıştakine sızmaz, bu yüzden acil işaretlemek
 * yanlışlıkla "istasyon seç" akışını AÇMAZ.
 */
export function UrgentToggle({
  isUrgent,
  busy,
  onPress,
}: {
  isUrgent: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      onPress={busy ? undefined : onPress}
      disabled={busy}
      style={[styles.urgentBtn, isUrgent && styles.urgentBtnOn, busy && styles.urgentBtnBusy]}
      rippleColor="rgba(220,38,38,0.15)"
      accessibilityLabel={isUrgent ? 'Acil işaretini kaldır' : 'Acil olarak işaretle'}
    >
      <View style={styles.urgentInner}>
        <Icon
          source={isUrgent ? 'flash' : 'flash-outline'}
          size={16}
          color={isUrgent ? '#fff' : colors.textMuted}
        />
        <Text style={[styles.urgentText, isUrgent && styles.urgentTextOn]}>ACİL</Text>
      </View>
    </TouchableRipple>
  );
}

/**
 * Kart gövdesi — iki listenin ortak üst bloğu. Aksiyonlar (istasyon seç / atamayı
 * kaldır / işi bitir) kartı saran listenin işidir; burada YALNIZ iş emrinin kimliği
 * ve hacmi vardır.
 */
export function WorkOrderSummary({
  row,
  urgentBusy,
  onToggleUrgent,
}: {
  row: KursunDistributionRowBase;
  urgentBusy: boolean;
  onToggleUrgent: () => void;
}) {
  const wait = waitText(row.oldestEnteredAt);
  return (
    <View style={styles.summary}>
      <View style={styles.headRow}>
        <Text style={styles.woNo} numberOfLines={1}>
          {row.workOrderNumber}
        </Text>
        {row.isLastStep && (
          <View style={styles.lastStepChip}>
            <Text style={styles.lastStepChipText}>SON ADIM</Text>
          </View>
        )}
        <UrgentToggle isUrgent={row.isUrgent} busy={urgentBusy} onPress={onToggleUrgent} />
      </View>

      {/* Parti no'lar — planlamacının "hangi iş emri, hangi partiler" sorusu. */}
      <Text style={styles.batchLine} numberOfLines={2}>
        {row.batchNumbers.length > 0
          ? `Parti: ${row.batchNumbers.join(' · ')}`
          : 'Parti: — (partisiz top)'}
      </Text>

      <View style={styles.productRow}>
        {row.colorHex ? (
          <View style={[styles.colorDot, { backgroundColor: row.colorHex }]} />
        ) : null}
        <Text style={styles.productText} numberOfLines={1}>
          {row.itemName ?? 'Kumaş —'}
          {row.colorName ? ` · ${row.colorName}` : ''}
        </Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.volumeText}>
          {row.openRollCount} top · {fmtMeters(row.totalMeters)} m
        </Text>
        {wait ? <Text style={styles.waitText}>⏳ {wait}</Text> : null}
      </View>
    </View>
  );
}

/** Kart içi uyarı/blok şeridi — somut Türkçe sebebi gizlemeden gösterir. */
export function ReasonStrip({ tone, text }: { tone: 'block' | 'warn'; text: string }) {
  return (
    <View style={[styles.reason, tone === 'block' ? styles.reasonBlock : styles.reasonWarn]}>
      <Icon
        source={tone === 'block' ? 'cancel' : 'alert-outline'}
        size={15}
        color={tone === 'block' ? colors.dangerDark : colors.warningDark}
      />
      <Text
        style={[
          styles.reasonText,
          { color: tone === 'block' ? colors.dangerDark : colors.warningDark },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

/** Liste boşken / yüklenirken gösterilen ortak metin bloğu. */
export function ListPlaceholder({ text }: { text: string }) {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderText}>{text}</Text>
    </View>
  );
}

export const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  cardUrgent: { borderColor: colors.danger, borderWidth: 2 },
  cardDisabled: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  cardBody: { padding: spacing.md },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  actionBtn: { flex: 1, minHeight: 48, justifyContent: 'center' },
});

const styles = StyleSheet.create({
  summary: { gap: 4 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  woNo: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  lastStepChip: {
    backgroundColor: colors.infoContainer,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  lastStepChipText: { fontSize: 10, fontWeight: '800', color: colors.infoText },
  // 56dp'ye yakın dokunma hedefi (48 yükseklik + kart padding'i) — saha eldivenle basar.
  urgentBtn: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    minHeight: 40,
    justifyContent: 'center',
  },
  urgentBtnOn: { backgroundColor: colors.dangerDark, borderColor: colors.dangerDark },
  urgentBtnBusy: { opacity: 0.5 },
  urgentInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  urgentText: { fontSize: 12, fontWeight: '800', color: colors.textMuted },
  urgentTextOn: { color: '#fff' },
  batchLine: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  productText: { flex: 1, fontSize: 14, color: colors.textSecondary },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 2,
  },
  volumeText: { fontSize: 16, fontWeight: '800', color: colors.text },
  waitText: { fontSize: 12, color: colors.warningDark, fontWeight: '600' },
  reason: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  reasonBlock: { backgroundColor: colors.dangerContainer },
  reasonWarn: { backgroundColor: colors.warningContainer },
  reasonText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  placeholder: { padding: spacing.xxl, alignItems: 'center' },
  placeholderText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
