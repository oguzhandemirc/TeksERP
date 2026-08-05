import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, Icon, ActivityIndicator } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';

import AppModal from './AppModal';
import { rollService } from '../services/roll.service';
import type { Roll } from '../types/models';
import { colors, spacing, radius } from '../theme';

/**
 * OKUTULAN BARKOD İPTAL EDİLMİŞ — teşhis + tek dokunuş geri alma.
 *
 * NEDEN VAR (2026-08-05 saha vakası): operatör depoda bir top buldu, okuttu,
 * ekran yalnız "stokta değil" dedi ve SUSTU. Elinde fiziksel mal, önünde akan
 * bir vardiya olan insan için bu sessizlik doğaçlamaya davettir — o gün öyle
 * oldu: ikinci bir kayıt açıldı, ikinci bir etiket basıldı, topun üstünde iki
 * kimlik kaldı ve biri ölüydü.
 *
 * Panel iki soruyu birden yanıtlar: "neden kabul edilmedi" (kim, ne zaman,
 * hangi sebeple iptal etti) ve "şimdi ne yapayım" (geri al — ya da neden
 * alamayacağın). İkincisi olmadan birincisi yalnız daha kibar bir çıkmazdır.
 *
 * ⚠️ `canRestore` BACKEND'DEN gelir, burada hesaplanmaz. İstemci kendi kuralını
 * kurarsa buton çizilir ama uç 409 verir — operatör iki kez çıkmaza girer.
 */
export interface CancelledRollSheetProps {
  /** İptalli top (lookup yanıtı — teşhis alanlarını taşır). null = kapalı. */
  roll: Roll | null;
  onDismiss: () => void;
  /**
   * Geri alma başarılı → çağıran topu kendi akışına alır (ör. iş emrine ekler).
   * Yanıttaki GÜNCEL top geçilir; çağıran eski (iptalli) kopyayı kullanmamalı.
   */
  onRestored: (roll: Roll) => void;
}

export default function CancelledRollSheet({
  roll,
  onDismiss,
  onRestored,
}: CancelledRollSheetProps) {
  const [error, setError] = useState<string | null>(null);

  const restore = useMutation({
    // Online-only: geri alma sunucu durumuna bakan bir karardır (kapsam guard'ı
    // hareket/parti/çuval sorgular). Kuyruğa alınsaydı operatör "geri alındı"
    // görüp topu iş emrine eklerdi, sunucu ise saatler sonra reddederdi.
    networkMode: 'always',
    mutationFn: (id: string) => rollService.restoreCancel(id),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Toast.show({
        type: 'success',
        text1: 'İptal geri alındı',
        text2: res.message ?? undefined,
      });
      if (res.data) onRestored(res.data);
      onDismiss();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(e.message);
    },
  });

  const canRestore = roll?.canRestore === true;
  const blockReason = roll?.restoreBlockReason ?? null;
  const who = roll?.cancelledBy?.fullName ?? roll?.cancelledBy?.username ?? null;

  return (
    <AppModal
      visible={!!roll}
      onDismiss={restore.isPending ? () => {} : onDismiss}
      dismissable={!restore.isPending}
    >
      <View style={styles.sheet}>
        <View style={styles.head}>
          <Icon source="label-off-outline" size={30} color={colors.warningDark} />
          <Text style={styles.title}>Bu barkod iptal edilmiş</Text>
        </View>

        <View style={styles.infoBox}>
          <Row label="Barkod" value={roll?.barcode ?? '—'} mono />
          <Row
            label="Ürün"
            value={`${roll?.item?.name ?? '—'}${roll?.color?.name ? ` · ${roll.color.name}` : ''}`}
          />
          <Row label="Metraj" value={`${roll?.currentQty ?? '—'} m`} />
          <Row
            label="İptal"
            value={
              roll?.cancelledAt
                ? `${dayjs(roll.cancelledAt).format('DD.MM.YYYY HH:mm')}${who ? ` · ${who}` : ''}`
                : '—'
            }
          />
          {roll?.cancelReason ? <Row label="Sebep" value={roll.cancelReason} /> : null}
        </View>

        {/* Etiket hâlâ topun üstünde — asıl fiziksel iş bu. */}
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>
            Elindeki etiket bu kayda ait ve kayıt ölü. Topu yeniden GİRME — aynı mal için
            ikinci bir barkod doğar ve topun üstünde iki etiket kalır.
          </Text>
        </View>

        {error ? (
          <View style={styles.errBox}>
            <Icon source="alert-circle-outline" size={18} color={colors.danger} />
            <Text style={styles.errText}>{error}</Text>
          </View>
        ) : !canRestore && blockReason ? (
          <View style={styles.errBox}>
            <Icon source="information-outline" size={18} color={colors.danger} />
            <Text style={styles.errText}>{blockReason}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            mode="outlined"
            onPress={onDismiss}
            disabled={restore.isPending}
            style={styles.btn}
            contentStyle={styles.btnContent}
          >
            Kapat
          </Button>
          {canRestore && (
            <Button
              mode="contained"
              buttonColor={colors.brand}
              textColor="#fff"
              icon="undo-variant"
              onPress={() => {
                setError(null);
                if (roll) restore.mutate(roll.id);
              }}
              loading={restore.isPending}
              disabled={restore.isPending}
              style={styles.btn}
              contentStyle={styles.btnContent}
            >
              İptali Geri Al
            </Button>
          )}
        </View>

        {restore.isPending && (
          <View style={styles.pendingRow}>
            <ActivityIndicator size="small" color={colors.brand} />
            <Text style={styles.pendingText}>Geri alınıyor…</Text>
          </View>
        )}
      </View>
    </AppModal>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.rowValueMono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, flexShrink: 1 },
  infoBox: {
    backgroundColor: '#f8fafc',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowLabel: { width: 74, fontSize: 12.5, color: colors.textMuted, fontWeight: '600' },
  rowValue: { flex: 1, fontSize: 13.5, color: colors.text, fontWeight: '600' },
  rowValueMono: { fontFamily: 'monospace' },
  noteBox: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noteText: { fontSize: 12.5, color: '#92400e', lineHeight: 18 },
  errBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: '#fef2f2',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errText: { flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1, borderRadius: radius.md },
  btnContent: { minHeight: 56 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  pendingText: { fontSize: 12.5, color: colors.textMuted },
});
