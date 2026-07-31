import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, ActivityIndicator, Icon } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';

import type { KursunDistributionWaitingRow } from '../../../services/kursunBypass.service';
import { WorkOrderSummary, ReasonStrip, ListPlaceholder, cardStyles } from './dagitimUi';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// BEKLEYEN — kurşun adımında açık topu olan, henüz bir fiziksel kurşun
// MAKİNESİNE dağıtılmamış iş emirleri.
//
// Etkileşim TEK dokunuş: karta bas → makine seçici → DOĞRUDAN atama. Araya
// "detay ekranı" koymuyoruz; dağıtım bir planlama refleksidir, form değil.
// `eligible=false` satırlar dokunulamaz ama LİSTEDEN DÜŞMEZ — planlamacı neden
// dağıtamadığını (blockReason) görmeli, satır sessizce kaybolmamalı.
// =============================================================================

interface Props {
  rows: KursunDistributionWaitingRow[];
  /** `production.kursunBypassEnabled` — false ise YENİ atama yapılamaz. */
  flagEnabled: boolean;
  /** Kurşun (PROCESS_QC) istasyonuna bağlı hiç makine yok → dağıtım hedefi yok. */
  machinesEmpty: boolean;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Karta dokunma — parent makine seçiciyi açar. */
  onPickMachine: (row: KursunDistributionWaitingRow) => void;
  onToggleUrgent: (row: KursunDistributionWaitingRow) => void;
  /** Acil mutasyonu süren adım (spinner yalnız o kartta). */
  urgentBusyStepId: string | null;
}

export default function EligibleList({
  rows,
  flagEnabled,
  machinesEmpty,
  loading,
  refreshing,
  onRefresh,
  onPickMachine,
  onToggleUrgent,
  urgentBusyStepId,
}: Props) {
  // Dağıtımı topyekûn engelleyen iki durum — kart bazlı `eligible`'dan bağımsız.
  const globallyBlocked = machinesEmpty || !flagEnabled;

  const renderItem = useCallback(
    ({ item }: { item: KursunDistributionWaitingRow }) => {
      const disabled = !item.eligible || globallyBlocked;
      return (
        <View
          style={[
            cardStyles.card,
            item.isUrgent && cardStyles.cardUrgent,
            disabled && cardStyles.cardDisabled,
          ]}
        >
          <TouchableRipple
            onPress={disabled ? undefined : () => onPickMachine(item)}
            disabled={disabled}
            rippleColor="rgba(79,70,229,0.10)"
            accessibilityLabel={`${item.workOrderNumber} — kurşun makinesine dağıt`}
          >
            <View style={cardStyles.cardBody}>
              <WorkOrderSummary
                row={item}
                urgentBusy={urgentBusyStepId === item.workOrderStepId}
                onToggleUrgent={() => onToggleUrgent(item)}
              />

              {item.blockReason ? (
                <ReasonStrip tone="block" text={item.blockReason} />
              ) : (
                <View style={styles.hintRow}>
                  <Icon
                    source="arrow-right-bold-box"
                    size={16}
                    color={disabled ? colors.textMuted : colors.brand}
                  />
                  <Text style={[styles.hintText, disabled && styles.hintTextMuted]}>
                    {globallyBlocked
                      ? 'Şu an dağıtılamaz'
                      : 'Dokun → kurşun makinesi seç'}
                  </Text>
                </View>
              )}
            </View>
          </TouchableRipple>
        </View>
      );
    },
    [globallyBlocked, onPickMachine, onToggleUrgent, urgentBusyStepId]
  );

  return (
    <FlashList
      data={rows}
      keyExtractor={(r) => r.workOrderStepId}
      renderItem={renderItem}
      contentContainerStyle={styles.body}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={
        <>
          {machinesEmpty && (
            <Banner
              tone="danger"
              icon="factory"
              text="Kurşun istasyonuna bağlı MAKİNE tanımlı değil — yönetim panelinden ekleyin."
            />
          )}
          {!flagEnabled && (
            <Banner
              tone="warn"
              icon="toggle-switch-off-outline"
              text="Kurşun dağıtımı ayardan KAPALI — yeni atama yapılamaz. Dağıtılmış işler bitirilmeye devam eder."
            />
          )}
        </>
      }
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={styles.loading} color={colors.brand} />
        ) : (
          <ListPlaceholder text="Kurşun adımında bekleyen iş emri yok." />
        )
      }
    />
  );
}

function Banner({
  tone,
  icon,
  text,
}: {
  tone: 'danger' | 'warn';
  icon: string;
  text: string;
}) {
  const isDanger = tone === 'danger';
  return (
    <View style={[styles.banner, isDanger ? styles.bannerDanger : styles.bannerWarn]}>
      <Icon source={icon} size={20} color={isDanger ? colors.dangerDark : colors.warningDark} />
      <Text
        style={[
          styles.bannerText,
          { color: isDanger ? colors.dangerDark : colors.warningDark },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, paddingBottom: spacing.xxl },
  loading: { marginTop: spacing.xxl },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  hintText: { fontSize: 13, fontWeight: '700', color: colors.brand },
  hintTextMuted: { color: colors.textMuted },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  bannerDanger: { backgroundColor: colors.dangerContainer },
  bannerWarn: { backgroundColor: colors.warningContainer },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 18 },
});
