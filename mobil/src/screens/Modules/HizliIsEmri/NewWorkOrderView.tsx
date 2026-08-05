import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Text, Button, TouchableRipple, Icon, Surface, ActivityIndicator } from 'react-native-paper';

import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import RollPickerModal from '../../../components/RollPickerModal';
import { printFasonCeki } from '../../../services/fasonCekiPrint';
import { printTravelerCardForWorkOrder } from '../../../services/travelerCardPrint';
import Toast from 'react-native-toast-message';

import { useQuickWorkOrder } from './useQuickWorkOrder';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus';
import WizardSteps, { STEP_TITLES } from './wizard/WizardSteps';
import StepRolls from './wizard/StepRolls';
import StepProduction from './wizard/StepProduction';
import StepConfirm from './wizard/StepConfirm';
import ScannedRollsModal from './wizard/ScannedRollsModal';
import { colors, spacing, radius } from '../../../theme';

interface NewWorkOrderViewProps {
  /** Aktif adım (0-tabanlı) — kabuk tutar ki Appbar geri tuşu adım geri gidebilsin. */
  step: number;
  onStepChange: (step: number) => void;
}

/**
 * Hızlı İş Emri — 3 adımlı sihirbaz (① Toplar · ② Üretim · ③ Onay).
 *
 * 2026-08-02'de tek uzun formdan sihirbaza geçti. Kaldırılanlar: İş Emri Şablonu
 * (ProductRecipe), elle İş Emri No, hedef metraj/kg. Tüm durum + kurallar
 * `useQuickWorkOrder` hook'unda; burası yalnız gezinme ve iskelet.
 */
export default function NewWorkOrderView({ step, onStepChange }: NewWorkOrderViewProps) {
  const wo = useQuickWorkOrder();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [rollListOpen, setRollListOpen] = useState(false);
  // Tarayıcıdan "Listeden Seç"e geçiş: RollPicker'ı tarayıcı modalı TAMAMEN
  // kapandıktan sonra aç. İkisi bir arada mount edilirse kapanmakta olan modalın
  // görünmez overlay'i dokunuşları yutar (bkz. BarcodeScannerModal.onModalHide).
  const [pendingRollList, setPendingRollList] = useState(false);
  const [scannedListOpen, setScannedListOpen] = useState(false);
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printingCeki, setPrintingCeki] = useState(false);
  const online = useOnlineStatus();

  const goTo = useCallback(
    (i: number) => onStepChange(Math.max(0, Math.min(STEP_TITLES.length - 1, i))),
    [onStepChange],
  );

  // Adım geçiş engeli — o adımda karar verilmesi gereken şey eksikse ileri gidilmez.
  const stepBlock =
    step === 0
      ? wo.scanned.length === 0
        ? 'En az bir top okutun veya listeden seçin.'
        : null
      : step === 1
        ? !wo.routeTemplateId
          ? 'Bir rota seçmelisiniz.'
          : !wo.foldType
            ? 'Kat tipi seçmelisiniz.'
            : wo.applyMissing
              ? `Seçili rota ${wo.applyMissing} uygulayacak bir fason adımı içermiyor.`
              : null
        : wo.blockingReason;

  const printResult = async () => {
    if (!wo.result) return;
    setPrinting(true);
    try {
      await printTravelerCardForWorkOrder(wo.result.woId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!/cancel|dismiss/i.test(msg)) {
        Toast.show({ type: 'error', text1: 'Çıktı alınamadı', text2: msg });
      }
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintCeki = async () => {
    if (!wo.result?.dispatch) return;
    setPrintingCeki(true);
    try {
      await printFasonCeki(wo.result.dispatch.id);
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Çeki listesi alınamadı',
        text2: e instanceof Error ? e.message : '',
      });
    } finally {
      setPrintingCeki(false);
    }
  };

  // ── Başarı ekranı ──────────────────────────────────────────────────────────
  if (wo.result) {
    const r = wo.result;
    return (
      <View style={styles.successWrap}>
        <Surface style={styles.successCard} elevation={2}>
          <View style={styles.successIcon}>
            <Icon source="check-circle" size={56} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>İş Emri Başlatıldı</Text>
          {/* İki numara AYRI kavram, bu yüzden ETİKETLİ basılır: üstteki büyük
              numara eskiden etiketsizdi ve "parti" sanılıyordu (alan adı da
              `batchNumber`'dı ama içinde iş emri no vardı). */}
          <Text style={styles.successLabel}>İŞ EMRİ NO</Text>
          <Text style={styles.successBatch}>{r.workOrderNumber}</Text>
          {r.batchNumber ? (
            <>
              <Text style={[styles.successLabel, styles.successLabelSpaced]}>PARTİ NO</Text>
              <Text style={styles.successParti}>{r.batchNumber}</Text>
            </>
          ) : null}
          <Text style={styles.successMeta}>{r.attached} top bağlandı</Text>
          {r.errors.length > 0 ? (
            <Text style={styles.successWarn}>{r.errors.length} top bağlanamadı</Text>
          ) : null}
          {r.dispatch ? (
            <Text style={styles.successDispatch}>
              Fasona sevk edildi · İrsaliye {r.dispatch.dispatchNo}
            </Text>
          ) : null}
          <Button
            mode="contained"
            icon="printer"
            onPress={printResult}
            loading={printing}
            disabled={printing}
            style={styles.successBtn}
            contentStyle={styles.btnContent}
          >
            Çıktı Al (Refakat Kartı)
          </Button>
          {/* Fason çeki listesi — yalnız sevk yapıldıysa; otomatik açılmaz, isteğe bağlı. */}
          {r.dispatch ? (
            <Button
              mode="contained-tonal"
              icon="file-document-outline"
              onPress={handlePrintCeki}
              loading={printingCeki}
              disabled={printingCeki}
              style={styles.successBtn}
              contentStyle={styles.btnContent}
            >
              Fason Çeki Listesi
            </Button>
          ) : null}
          <Button
            mode="outlined"
            icon="plus"
            onPress={() => {
              wo.resetAll();
              goTo(0);
            }}
            style={styles.successBtn}
            contentStyle={styles.btnContent}
          >
            Yeni İş Emri
          </Button>
        </Surface>
      </View>
    );
  }

  const isLast = step === STEP_TITLES.length - 1;

  return (
    <View style={styles.root}>
      <WizardSteps current={step} onGoTo={goTo} />

      {/* Çevrimdışı bandı — eskiden bağlantı yalnız Başlat'a basınca kontrol
          ediliyordu, yani operatör 15 top okuttuktan SONRA öğreniyordu. */}
      {!online ? (
        <View style={styles.offlineBanner}>
          <Icon source="wifi-off" size={16} color={colors.dangerDark} />
          <Text style={styles.offlineText}>
            Çevrimdışı — iş emri başlatmak için bağlantı gerekli.
          </Text>
        </View>
      ) : null}

      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        {step === 0 ? (
          <StepRolls
            wo={wo}
            onOpenScanner={() => setScannerOpen(true)}
            onOpenRollList={() => setRollListOpen(true)}
            onOpenScannedList={() => setScannedListOpen(true)}
            orderPickerOpen={orderPickerOpen}
            onOrderPickerOpenChange={setOrderPickerOpen}
          />
        ) : step === 1 ? (
          <StepProduction wo={wo} />
        ) : (
          <StepConfirm wo={wo} onGoTo={goTo} />
        )}
        <View style={{ height: 140 }} />
      </KeyboardAwareScrollView>

      {/* Alt gezinme */}
      <View style={styles.footer}>
        {wo.submitError ? (
          <View style={styles.errorBanner}>
            <Icon source="alert-circle" size={18} color={colors.dangerDark} />
            <Text style={styles.errorBannerText}>{wo.submitError}</Text>
          </View>
        ) : stepBlock ? (
          <Text style={styles.hint} numberOfLines={2}>
            {stepBlock}
          </Text>
        ) : null}

        <View style={styles.navRow}>
          {step > 0 ? (
            <TouchableRipple
              onPress={() => goTo(step - 1)}
              style={[styles.navBtn, styles.navBtnSide]}
              rippleColor="rgba(79,70,229,0.12)"
              accessibilityLabel="Önceki adım"
            >
              <View style={styles.navBtnInner}>
                <Icon source="chevron-left" size={22} color={colors.brand} />
                <Text style={styles.navBtnSideText}>Geri</Text>
              </View>
            </TouchableRipple>
          ) : null}

          <TouchableRipple
            onPress={() => (isLast ? wo.submit() : goTo(step + 1))}
            disabled={!!stepBlock || (isLast && (!wo.canSubmit || !online))}
            style={[
              styles.navBtn,
              styles.navBtnPrimary,
              (!!stepBlock || (isLast && (!wo.canSubmit || !online))) && styles.navBtnDisabled,
            ]}
            rippleColor="rgba(255,255,255,0.25)"
            accessibilityLabel={isLast ? 'İş emrini başlat' : 'Sonraki adım'}
          >
            <View style={styles.navBtnInner}>
              {isLast && wo.isPending ? (
                <ActivityIndicator size={20} color="#fff" />
              ) : (
                <Icon source={isLast ? 'rocket-launch' : 'chevron-right'} size={24} color="#fff" />
              )}
              <Text style={styles.navBtnPrimaryText}>
                {isLast ? 'İŞ EMRİNİ BAŞLAT' : 'İLERİ'}
              </Text>
            </View>
          </TouchableRipple>
        </View>
      </View>

      {/* Sürekli tarayıcı — kendi kabul/ret titreşimimiz var, yakalama haptiği kapalı.
          onPickFromList (O15): kamera çalışmasa/etiket okunmasa da akış kilitlenmesin —
          "Listeden Seç" tam da sorunun fark edildiği yerde durur. */}
      <BarcodeScannerModal
        visible={scannerOpen}
        onDismiss={() => setScannerOpen(false)}
        onScan={(b) => void wo.handleScan(b)}
        title="Stok Topu Okut"
        continuous
        captureHaptic={false}
        barcodeTypes={['qr', 'code128']}
        onPickFromList={() => setPendingRollList(true)}
        onModalHide={() => {
          if (!pendingRollList) return;
          setPendingRollList(false);
          setRollListOpen(true);
        }}
      />

      {/* Listeden çoklu top seç */}
      <RollPickerModal
        visible={rollListOpen}
        onDismiss={() => setRollListOpen(false)}
        multiSelect
        confirmLabel="Ekle"
        onConfirm={(rolls) => {
          wo.addRolls(rolls);
          setRollListOpen(false);
        }}
        filters={{
          rollScope: 'RAW_STOCK',
          rollKind: 'WOUND_ROLL',
          ...(wo.lockedItemId ? { itemId: wo.lockedItemId } : {}),
        }}
        excludeIds={wo.scanned.map((s) => s.id)}
        title="Stok Topu Seç"
        subtitle={wo.lockedItemName ? `${wo.lockedItemName} — serbest stok` : 'Serbest stok topları'}
        emptyText="Uygun serbest stok topu yok"
      />

      {/* Okutulanların tam listesi + tekil silme */}
      <ScannedRollsModal
        visible={scannedListOpen}
        onDismiss={() => setScannedListOpen(false)}
        rolls={wo.scanned}
        totalQty={wo.totalQty}
        onRemove={wo.removeRoll}
        onClearAll={() => {
          wo.clearScanned();
          setScannedListOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  scroll: { paddingBottom: spacing.md },

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  offlineText: { flex: 1, color: colors.dangerText, fontSize: 12, fontWeight: '700' },

  footer: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerContainer,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  errorBannerText: { flex: 1, color: colors.dangerText, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  hint: { fontSize: 12, color: colors.textMuted, fontWeight: '600', textAlign: 'center' },

  navRow: { flexDirection: 'row', gap: spacing.sm },
  navBtn: {
    minHeight: 62,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 1,
  },
  navBtnSide: { flex: 3, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  navBtnPrimary: { flex: 7, backgroundColor: colors.brand, borderColor: colors.brand },
  navBtnDisabled: { opacity: 0.45 },
  navBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
  navBtnSideText: { color: colors.brand, fontSize: 15, fontWeight: '700' },
  navBtnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  successWrap: { flex: 1, backgroundColor: colors.appBg, justifyContent: 'center', padding: spacing.lg },
  successCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  successIcon: { marginBottom: spacing.xs },
  successTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  successLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.textMuted,
    marginTop: 6,
  },
  successLabelSpaced: { marginTop: 10 },
  successBatch: { fontSize: 24, fontWeight: '800', color: colors.brand, marginTop: 2 },
  // Parti, iş emrinden görsel olarak ayrışsın diye farklı ton — aynı renkte iki
  // büyük numara "hangisi hangisi" karışıklığı üretiyordu.
  successParti: { fontSize: 22, fontWeight: '800', color: colors.successDark, marginTop: 2 },
  successMeta: { fontSize: 14, color: colors.textSecondary, marginTop: 8 },
  successWarn: { fontSize: 13, color: colors.warningDark, fontWeight: '700' },
  successDispatch: { fontSize: 13, color: colors.brand, fontWeight: '700', marginTop: 2 },
  successBtn: { borderRadius: radius.md, alignSelf: 'stretch', marginTop: spacing.sm },
  btnContent: { height: 50 },
});
