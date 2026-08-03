// =============================================================================
// TAMBUR SAHA DÜZELTMESİ — "Topu Buraya Al"
// =============================================================================
// Operatör sahada tıkandığında (top fiziksel olarak Tambur'da ama ekranda yok)
// panel başındaki birini beklemesin diye: barkodu okut / listeden seç → SOMUT
// ÖNİZLEME → sebep yaz → uygula.
//
// ÖNİZLEMESİZ UYGULAMA YOK — bu bir kural, kolaylık değil. Taşıma geri-alınamaz
// yan etkiler üretebilir (aradaki adımlar SKIPPED olur, hedef-sonrası kalite
// kararı VOID edilir, yeni parti numarası doğar, tamamlanmış iş emri yeniden
// açılır). Operatör bunları BASMADAN ÖNCE görmeli. Önizlemeyi backend üretir
// (`POST /tambur/manual/bring-preview`) — ekran ayrı bir tahmin yürütmez, aksi
// halde iki mantık zamanla ayrışır ve ekran yalan söylemeye başlar.
//
// NEDEN AYRI DOSYA: `TamburScreen.tsx` ~6000 satır; yeni modal kodu oraya
// yazılmaz (emsal: `CutActionBar.tsx`). Ekran yalnız görünürlüğü ve tazelemeyi
// yönetir, akışın tamamı burada durur.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Icon,
  IconButton,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import AppModal from '../../../components/AppModal';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import RollPickerModal from '../../../components/RollPickerModal';
import { isWorkSessionLost } from '../../../services/api';
import { tamburService, type TamburBringPreview } from '../../../services/tambur.service';
import { colors, radius, spacing } from '../../../theme';

/** Sebep alanı — backend de aynı alt sınırı uygular (min 3 karakter). */
const MIN_REASON = 3;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Ekrandaki Tambur adımı (WorkOrderStep) — taşımanın hedefi. */
  targetStepId: string;
  /** Hedef istasyon adı — operatöre "nereye alıyorum" diye gösterilir. */
  stationName: string;
  /** Çevrimiçi mi — bu uçlar online-only (offline kuyruğuna GİRMEZ). */
  online: boolean;
  /** Başarıdan sonra çağrılır — ekran Tambur listesini tazeler. */
  onApplied: () => void;
}

export default function TamburBringRollModal({
  visible,
  onDismiss,
  targetStepId,
  stationName,
  online,
  onApplied,
}: Props) {
  const { height } = useWindowDimensions();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [preview, setPreview] = useState<TamburBringPreview | null>(null);
  const [reason, setReason] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Kamera kapanma animasyonu bitmeden state değiştirmek görünmez overlay bırakıyor
  // (proje geneli desen: onScan → beklet, onModalHide → uygula).
  const pendingScanRef = useRef<string | null>(null);
  const pickFromListRef = useRef(false);

  // Modal kapandığında akış sıfırlanır — bir sonraki açılış bayat önizlemeyle
  // (başka bir topla!) başlamasın.
  useEffect(() => {
    if (visible) return;
    setBarcodeInput('');
    setPreview(null);
    setReason('');
    setScannerOpen(false);
    setPickerOpen(false);
    pendingScanRef.current = null;
    pickFromListRef.current = false;
  }, [visible]);

  const previewMutation = useMutation({
    mutationFn: (ref: { barcode?: string; rollId?: string }) =>
      tamburService.bringPreview({ targetStepId, ...ref }),
    onSuccess: (res) => {
      setPreview(res.data);
      if (!res.data.canApply) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return; // interceptor zaten bildirdi
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: err.message });
    },
  });

  const applyMutation = useMutation({
    mutationFn: (vars: { barcode?: string; rollId?: string; reason: string }) =>
      tamburService.bringRoll({ targetStepId, ...vars }),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Top adıma alındı',
        text2: res.message ?? undefined,
      });
      onApplied();
      onDismiss();
    },
    onError: (err: Error) => {
      if (isWorkSessionLost(err)) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Taşıma yapılamadı', text2: err.message });
    },
  });

  const busy = previewMutation.isPending || applyMutation.isPending;

  const resolveByBarcode = (raw?: string) => {
    const code = (raw ?? barcodeInput).trim();
    if (!code || busy) return;
    setPreview(null);
    setReason('');
    setBarcodeInput(code);
    previewMutation.mutate({ barcode: code });
  };

  const resolveByRollId = (rollId: string, label: string | null) => {
    if (busy) return;
    setPreview(null);
    setReason('');
    setBarcodeInput(label ?? '');
    previewMutation.mutate({ rollId });
  };

  const apply = () => {
    if (!preview || !preview.canApply) return;
    if (reason.trim().length < MIN_REASON) return;
    // Önizleme hangi TOP için alındıysa uygulama da onunla gider (barkod
    // yeniden yazılmış olabilir; barkodsuz açık kumaşta zaten barkod yoktur).
    applyMutation.mutate({ rollId: preview.roll.id, reason: reason.trim() });
  };

  const reasonTooShort = reason.trim().length < MIN_REASON;

  return (
    <>
      <AppModal
        // Kamera / liste açıkken ana sheet gizlenir: üst üste binen iki yüzeyde
        // hangi dokunmanın hangisine gittiği belirsizleşiyor (proje geçmişinde
        // "bir şey olmuyor" sınıfı hata). Bileşen mount kalır → form kaybolmaz.
        visible={visible && !scannerOpen && !pickerOpen}
        onDismiss={onDismiss}
        // İşlem uçuştayken perde/geri tuşu kapatmaz (AppModal dismissable=false
        // iken backdrop'u da devre dışı bırakır) — yarım kalmış bir taşımanın
        // üstüne modal kapanıp operatör "olmadı" sanmasın.
        dismissable={!busy}
        swipeToDismiss={!busy}
      >
        <Surface style={[styles.sheet, { maxHeight: height * 0.82 }]} elevation={4}>
          <View style={styles.header}>
            <Icon source="arrow-left-bold-box-outline" size={24} color={colors.brand} />
            <View style={styles.headerText}>
              <Text style={styles.title}>Topu Buraya Al</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                Hedef: {stationName}
              </Text>
            </View>
            <IconButton
              icon="close"
              size={20}
              disabled={busy}
              onPress={onDismiss}
              accessibilityLabel="Kapat"
            />
          </View>

          {!online && (
            <View style={styles.offlineBand}>
              <Icon source="wifi-off" size={16} color={colors.warningText} />
              <Text style={styles.offlineText}>
                Çevrimdışı — saha düzeltmesi kuyruğa alınmaz, bağlantı gelince tekrar deneyin.
              </Text>
            </View>
          )}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollBody}
          >
            {/* ── 1. Topu göster: okut / yaz / listeden seç ── */}
            <ScannerEntryBar
              manualMode
              tone="indigo"
              value={barcodeInput}
              // Barkod DEĞİŞİRSE önizleme düşer: ekranda yeni kod yazarken eski
              // topun önizlemesi durursa "Uygula" görünenden BAŞKA topu taşırdı.
              onChangeText={(v) => {
                setBarcodeInput(v);
                if (preview) {
                  setPreview(null);
                  setReason('');
                }
              }}
              placeholder="Top barkodu okut/yaz..."
              onResolve={() => resolveByBarcode()}
              resolving={previewMutation.isPending}
              inputDisabled={busy}
              inputLeftIcon="barcode-scan"
              onScan={() => setScannerOpen(true)}
              onList={() => setPickerOpen(true)}
            />

            {previewMutation.isPending && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size={18} color={colors.brand} />
                <Text style={styles.loadingText}>Top aranıyor…</Text>
              </View>
            )}

            {!preview && !previewMutation.isPending && (
              <Text style={styles.hint}>
                Elindeki topun barkodunu okut. Ne olacağını göstereceğim; onaylamadan
                hiçbir şey değişmez.
              </Text>
            )}

            {/* ── 2. Önizleme ── */}
            {preview && (
              <>
                <View style={styles.rollCard}>
                  <Text style={styles.rollBarcode}>{preview.roll.barcode ?? 'Barkodsuz açık kumaş'}</Text>
                  <Text style={styles.rollLine}>
                    {preview.roll.itemName}
                    {preview.roll.colorName ? ` · ${preview.roll.colorName}` : ' · Renksiz'}
                  </Text>
                  <Text style={styles.rollLine}>
                    {preview.roll.currentQty} m · Şu an: {preview.roll.currentLocation}
                    {preview.roll.workOrderNumber ? ` · ${preview.roll.workOrderNumber}` : ''}
                  </Text>
                  {preview.roll.batchNumber ? (
                    <Text style={styles.rollLineMuted}>Parti: {preview.roll.batchNumber}</Text>
                  ) : null}
                </View>

                {preview.canApply && preview.effects ? (
                  <View style={styles.effectsBox}>
                    <Text style={styles.effectsTitle}>Ne olacak?</Text>
                    <EffectRow
                      icon={
                        preview.effects.direction === 'backward'
                          ? 'arrow-u-left-top'
                          : 'arrow-right-bold'
                      }
                      text={
                        preview.effects.direction === 'backward'
                          ? `Top geri çekilecek: ${preview.effects.fromStepName ?? preview.roll.currentLocation} → ${preview.targetStep.stationName}`
                          : `Top ileri alınacak: ${preview.effects.fromStepName ?? preview.roll.currentLocation} → ${preview.targetStep.stationName}`
                      }
                    />
                    <EffectRow
                      icon="clipboard-text-outline"
                      text={`İş emri: ${preview.targetStep.workOrderNumber}`}
                    />
                    {preview.effects.skippedStepNames.length > 0 && (
                      <EffectRow
                        icon="debug-step-over"
                        text={`Atlanacak adımlar: ${preview.effects.skippedStepNames.join(', ')}`}
                      />
                    )}
                    {preview.effects.colorWillApply && (
                      <EffectRow
                        icon="palette"
                        text="İş emrinin hedef rengi bu topa uygulanacak."
                      />
                    )}
                    {preview.effects.qualityStaysUnknown && (
                      <EffectRow icon="help-circle-outline" text="Topun kalitesi Belirsiz kalacak." />
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
                      {preview.blockReason ?? 'Bu top Tambur adımına alınamaz.'}
                    </Text>
                  </View>
                )}

                {/* ── 3. Sebep (zorunlu) ── */}
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
                      placeholder="Örn: Top kurşundan atlandı, fiziksel olarak tamburda"
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
            {preview && !preview.canApply ? (
              <Button
                mode="contained"
                icon="barcode-scan"
                onPress={() => {
                  setPreview(null);
                  setBarcodeInput('');
                }}
                style={styles.actionBtn}
              >
                Başka Top
              </Button>
            ) : (
              <Button
                mode="contained"
                icon="check"
                onPress={apply}
                loading={applyMutation.isPending}
                disabled={!preview || !preview.canApply || reasonTooShort || busy || !online}
                style={styles.actionBtn}
              >
                Uygula
              </Button>
            )}
          </View>
        </Surface>
      </AppModal>

      {/* Kamera — okutma sonucu modal TAM kapandıktan sonra işlenir. */}
      <BarcodeScannerModal
        visible={scannerOpen}
        title="Topu Buraya Al — Barkod Okut"
        onDismiss={() => setScannerOpen(false)}
        onScan={(code) => {
          pendingScanRef.current = code;
          setScannerOpen(false);
        }}
        onModalHide={() => {
          const code = pendingScanRef.current;
          pendingScanRef.current = null;
          if (code) {
            resolveByBarcode(code);
          } else if (pickFromListRef.current) {
            pickFromListRef.current = false;
            setPickerOpen(true);
          }
        }}
        onPickFromList={() => {
          pickFromListRef.current = true;
        }}
      />

      {/* Listeden seç — kamera çalışmasa / etiket okunmasa da akış kilitlenmesin.
          Aday küme backend'in taşınabilir statü kümesiyle hizalı (IN_PRODUCTION /
          STOCK / WAREHOUSE); gerisini önizleme net gerekçeyle reddeder. */}
      <RollPickerModal
        visible={pickerOpen}
        onDismiss={() => setPickerOpen(false)}
        title="Topu Buraya Al — Listeden Seç"
        filters={{ status: 'IN_PRODUCTION,STOCK,WAREHOUSE' }}
        onSelect={(roll) => {
          setPickerOpen(false);
          resolveByRollId(roll.id, roll.barcode);
        }}
      />
    </>
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
    // AppModal'ın center sarmalayıcısı alignItems:'center' verir → width'siz bir
    // sheet içeriğine büzülürdü (dar/asimetrik form). stretch, sarmalayıcının
    // min(ekran-32, 560) genişliğini doldurur.
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
  hint: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  hintSmall: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  rollCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  rollBarcode: { fontSize: 16, fontWeight: '800', color: colors.text },
  rollLine: { fontSize: 13, color: colors.textSecondary },
  rollLineMuted: { fontSize: 12, color: colors.textMuted },

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
