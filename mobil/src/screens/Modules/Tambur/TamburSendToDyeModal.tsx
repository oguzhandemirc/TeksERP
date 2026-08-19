// =============================================================================
// TAMBUR — "BOYAHANEYE GERİ GÖNDER" (2026-08-19)
// =============================================================================
// Plan-sapma onay modalının ÜÇÜNCÜ seçeneği. Operatörün önünde bugüne kadar iki
// cevap vardı ("yine de bitir" / "vazgeç"); gerçek karar çoğu zaman üçüncüsüdür:
// mal yanlış renkte, geri gitsin ve yeniden boyansın (SAP usage decision'ın
// rework kolu).
//
// `TamburBringRollModal` ile AYNI sözleşme — ÖNİZLEMESİZ UYGULAMA YOK: taşıma
// geri-alınamaz yan etkiler üretir (hedef sonrası kalite/kurşun kararı VOID,
// atlanmış adımlar yeniden açılır, yeni parti doğar) ve operatör bunları
// BASMADAN ÖNCE görmeli. Önizlemeyi backend üretir; ekran ayrı tahmin yürütmez.
//
// FARKI: burada TOP OKUTULMAZ — ekrandaki top zaten belli (plan kapısı onun için
// açıldı) ve HEDEF adım da istemcide seçilmez; sunucu rotadan çözer (kanonik
// `stepCanApplyColor`). Yani modal açılır açılmaz önizleme çekilir.
// =============================================================================

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator, Button, Icon, IconButton, Surface, Text, TextInput } from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import AppModal from '../../../components/AppModal';
import { isWorkSessionLost } from '../../../services/api';
import { tamburService, type TamburSendToDyePreview } from '../../../services/tambur.service';
import { colors, radius, spacing } from '../../../theme';

/** Sebep alanı — backend de aynı alt sınırı uygular (min 3 karakter). */
const MIN_REASON = 3;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Geri gönderilecek top — ekrandaki plan-sapma kapısından gelir. */
  rollId: string | null;
  /** Çevrimiçi mi — bu uçlar online-only (offline kuyruğuna GİRMEZ). */
  online: boolean;
  /** Başarıdan sonra çağrılır — ekran kart/liste tazeler (top listeden düşer). */
  onApplied: () => void;
}

export default function TamburSendToDyeModal({ visible, onDismiss, rollId, online, onApplied }: Props) {
  const { height } = useWindowDimensions();
  const [preview, setPreview] = useState<TamburSendToDyePreview | null>(null);
  const [reason, setReason] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: (id: string) => tamburService.sendToDyePreview({ rollId: id }),
    onSuccess: (res) => {
      setPreview(res.data);
      if (!res.data.canApply) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor zaten bildirdi
      // ⚠️ Hata TOAST'la geçiştirilmez, modal İÇİNDE gösterilir: "rotada boya
      // adımı yok" gibi cevaplar operatörün okuyup anlaması gereken bilgidir ve
      // toast birkaç saniyede kaybolur.
      setLoadError(err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const applyMutation = useMutation({
    mutationFn: (vars: { rollId: string; reason: string }) => tamburService.sendToDye(vars),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Top geri gönderildi',
        // ⚠️ Mesaj backend'den gelir ve HEDEF İSTASYON ADINI taşır: top Tambur
        // listesinden düşer, operatör nereye gittiğini görmezse "kayboldu" der.
        text2: res.message ?? undefined,
      });
      onApplied();
      onDismiss();
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Geri gönderilemedi', text2: err.message });
    },
  });

  // Açılışta önizleme; kapanışta akış sıfırlanır (bayat önizleme başka topla
  // açılmasın — bring modalıyla aynı gerekçe).
  useEffect(() => {
    if (!visible) {
      setPreview(null);
      setReason('');
      setLoadError(null);
      return;
    }
    if (!rollId) return;
    setPreview(null);
    setReason('');
    setLoadError(null);
    previewMutation.mutate(rollId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rollId]);

  const busy = previewMutation.isPending || applyMutation.isPending;
  const reasonTooShort = reason.trim().length < MIN_REASON;

  const apply = () => {
    if (!preview?.canApply || reasonTooShort || !rollId) return;
    applyMutation.mutate({ rollId, reason: reason.trim() });
  };

  return (
    <AppModal visible={visible} onDismiss={onDismiss} dismissable={!busy} swipeToDismiss={!busy}>
      <Surface style={[styles.sheet, { maxHeight: height * 0.82 }]} elevation={4}>
        <View style={styles.header}>
          <Icon source="palette-swatch-outline" size={24} color={colors.brand} />
          <View style={styles.headerText}>
            <Text style={styles.title}>Boyahaneye Geri Gönder</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {preview?.targetStep.stationName
                ? `Hedef: ${preview.targetStep.stationName}`
                : 'Hedef adım çözülüyor…'}
            </Text>
          </View>
          <IconButton icon="close" size={20} disabled={busy} onPress={onDismiss} accessibilityLabel="Kapat" />
        </View>

        {!online && (
          <View style={styles.offlineBand}>
            <Icon source="wifi-off" size={16} color={colors.warningText} />
            <Text style={styles.offlineText}>
              Çevrimdışı — geri gönderme kuyruğa alınmaz, bağlantı gelince tekrar deneyin.
            </Text>
          </View>
        )}

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollBody}>
          {previewMutation.isPending && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size={18} color={colors.brand} />
              <Text style={styles.loadingText}>Rotadaki boya adımı bulunuyor…</Text>
            </View>
          )}

          {loadError && (
            <View style={styles.blockBox}>
              <Icon source="cancel" size={18} color={colors.dangerDark} />
              <Text style={styles.blockText}>{loadError}</Text>
            </View>
          )}

          {preview && (
            <>
              <View style={styles.rollCard}>
                <Text style={styles.rollBarcode}>
                  {preview.roll.barcode ?? 'Barkodsuz açık kumaş'}
                </Text>
                <Text style={styles.rollLine}>
                  {preview.roll.itemName}
                  {preview.roll.colorName ? ` · ${preview.roll.colorName}` : ' · Renksiz'}
                </Text>
                <Text style={styles.rollLine}>
                  {preview.roll.currentQty} m · Şu an: {preview.roll.currentLocation}
                </Text>
              </View>

              {preview.canApply && preview.effects ? (
                <View style={styles.effectsBox}>
                  <Text style={styles.effectsTitle}>Ne olacak?</Text>
                  <EffectRow
                    icon="arrow-u-left-top"
                    text={`Top geri çekilecek: ${preview.fromStepName ?? preview.roll.currentLocation} → ${preview.targetStep.stationName}`}
                  />
                  <EffectRow
                    icon="clipboard-text-outline"
                    text={`İş emri: ${preview.targetStep.workOrderNumber}`}
                  />
                  {preview.effects.reopenedStepNames.length > 0 && (
                    <EffectRow
                      icon="restore"
                      text={`Yeniden açılacak adımlar: ${preview.effects.reopenedStepNames.join(', ')}`}
                    />
                  )}
                  {preview.effects.qualityWillVoid && (
                    <EffectRow
                      icon="help-circle-outline"
                      text="Kalite/kurşun kararı geri alınacak — topun kalitesi Belirsiz olur."
                    />
                  )}
                  {preview.targetStep.isExternal ? (
                    <EffectRow
                      icon="truck-outline"
                      text="Mal adımda ÜRETİMDE bekler; boyahaneye çıkışı Fason Sevk ekranından yapılır."
                    />
                  ) : (
                    <EffectRow icon="factory" text="Mal bu istasyonun kuyruğuna alınır." />
                  )}
                </View>
              ) : null}

              {preview.warnings.length > 0 && (
                <View style={styles.warnBox}>
                  {preview.warnings.map((w, i) => (
                    <View key={`${i}-${w}`} style={styles.warnRow}>
                      <Icon source="alert-outline" size={16} color={colors.warningText} />
                      <Text style={styles.warnText}>{w}</Text>
                    </View>
                  ))}
                </View>
              )}

              {!preview.canApply && (
                <View style={styles.blockBox}>
                  <Icon source="cancel" size={18} color={colors.dangerDark} />
                  <Text style={styles.blockText}>
                    {preview.blockReason ?? 'Bu top geri gönderilemez.'}
                  </Text>
                </View>
              )}

              {preview.canApply && (
                <View style={styles.reasonWrap}>
                  <Text style={styles.label}>
                    İşlem nedeni <Text style={styles.req}>*</Text>
                  </Text>
                  <TextInput
                    mode="outlined"
                    multiline
                    numberOfLines={2}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Örn: mal mavi geldi, iş emri gri istiyor"
                    maxLength={500}
                    disabled={busy}
                    style={styles.reasonInput}
                  />
                  <Text style={styles.hintSmall}>
                    Sebep kalıcı olarak kaydedilir (en az {MIN_REASON} karakter).
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>

        <View style={styles.actions}>
          <Button mode="outlined" onPress={onDismiss} disabled={busy} style={styles.actionBtn}>
            Vazgeç
          </Button>
          <Button
            mode="contained"
            icon="palette-swatch-outline"
            onPress={apply}
            loading={applyMutation.isPending}
            disabled={!preview?.canApply || reasonTooShort || busy || !online}
            style={styles.actionBtn}
          >
            Geri Gönder
          </Button>
        </View>
      </Surface>
    </AppModal>
  );
}

function EffectRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.effectRow}>
      <Icon source={icon} size={16} color={colors.textSecondary} />
      <Text style={styles.effectText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textSecondary },

  offlineBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningContainer,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  offlineText: { flex: 1, fontSize: 12, color: colors.warningText },

  scrollBody: { gap: spacing.sm, paddingBottom: spacing.xs },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  loadingText: { fontSize: 13, color: colors.textSecondary },
  hintSmall: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  rollCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  rollBarcode: { fontSize: 16, fontWeight: '800', color: colors.text },
  rollLine: { fontSize: 13, color: colors.textSecondary },

  effectsBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  effectsTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 2 },
  effectRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  effectText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  warnBox: {
    backgroundColor: colors.warningContainer,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  warnText: { flex: 1, fontSize: 13, color: colors.warningText, lineHeight: 18 },

  blockBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerContainer,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  blockText: { flex: 1, fontSize: 13, color: colors.dangerText, lineHeight: 18 },

  reasonWrap: { gap: 2 },
  label: { fontSize: 13, fontWeight: '700', color: colors.text },
  req: { color: colors.danger },
  reasonInput: { backgroundColor: colors.surface, fontSize: 15 },

  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1 },
});
