import React, { useCallback, useEffect, useState } from 'react';
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
import ScannerRollStrip from '../../../components/ScannerRollStrip';
import CancelledRollSheet from '../../../components/CancelledRollSheet';
import { useCameraUnusable } from '../../../hooks/useCameraUnusable';
import { colors, spacing, radius } from '../../../theme';

interface NewWorkOrderViewProps {
  /** Aktif adım (0-tabanlı) — kabuk tutar ki Appbar geri tuşu adım geri gidebilsin. */
  step: number;
  onStepChange: (step: number) => void;
  /**
   * Başarı ekranı açıldı/kapandı. Kabuk buna göre iki şey yapar: (a) geri tuşu
   * sihirbaz adımlarına geri saymak yerine doğrudan listeye döner — iş bitmiş,
   * formuna geri dönmenin anlamı yok ve operatör üç kez geri basıyordu;
   * (b) listeye dönüşte tazeleme + başa sarma tetiklenir.
   */
  onResultChange?: (hasResult: boolean) => void;
}

/**
 * Hızlı İş Emri — 3 adımlı sihirbaz (① Toplar · ② Üretim · ③ Onay).
 *
 * 2026-08-02'de tek uzun formdan sihirbaza geçti. Kaldırılanlar: İş Emri Şablonu
 * (ProductRecipe), elle İş Emri No, hedef metraj/kg. Tüm durum + kurallar
 * `useQuickWorkOrder` hook'unda; burası yalnız gezinme ve iskelet.
 */
export default function NewWorkOrderView({
  step,
  onStepChange,
  onResultChange,
}: NewWorkOrderViewProps) {
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
  // Ayarlar → "Kamera arızalı" — listeden seçim kaçış yollarının tek kaynağı.
  const cameraUnusable = useCameraUnusable();

  // Başarı ekranı durumunu kabuğa bildir (geri tuşu + liste tazeleme için).
  const hasResult = !!wo.result;
  useEffect(() => {
    onResultChange?.(hasResult);
  }, [hasResult, onResultChange]);

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
          {/* Üretim özeti — operatör kartı basmadan/ekrandan ayrılmadan "ne
              açtım" sorusunu cevaplayabilmeli. Değerler `wo.result`te DONMUŞ;
              canlı formdan okunsaydı "Yeni İş Emri"ne basıldığı an boşalırdı. */}
          <View style={styles.specBox}>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>KUMAŞ</Text>
              <Text style={styles.specValue} numberOfLines={2}>
                {r.itemName ?? '—'}
              </Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>EN</Text>
              <Text style={styles.specValue}>{r.width != null ? `${r.width} cm` : '—'}</Text>
            </View>
            <View style={[styles.specRow, styles.specRowLast]}>
              <Text style={styles.specLabel}>TOP</Text>
              <Text style={styles.specValue}>
                {r.attached} top · {Math.round(r.totalQty)} m
              </Text>
            </View>
          </View>
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
          trigger="tap": kamera KENDİLİĞİNDEN okumaz (2026-08-05 saha bulgusu —
          operatör telefonu yığının üzerinde gezdirirken komşu topların barkodları
          da iş emrine giriyordu). bkz. BarcodeScannerView.trigger.
          onPickFromList (O15) artık "kamera arızalı" bayrağına bağlı: kameranın
          altındaki yeri son okutulanlar şeridi aldı ve buton her okutmada
          gözükmesi gereken bir şey değil — kaçış yolu operatörün Ayarlar'daki
          beyanıyla açılır (aynı bayrak Adım-1'deki "Listeden Ekle"yi de açar).
          counter: sipariş bağlıysa "okutulan / istenen" bandı — operatör
          "yeter mi" sorusunu OKUTURKEN cevaplamalı, üç adım sonra onay
          ekranında değil (pick-to-order). notice: farklı en uyarısı. */}
      <BarcodeScannerModal
        visible={scannerOpen}
        onDismiss={() => setScannerOpen(false)}
        onScan={(b) => void wo.handleScan(b)}
        title="Stok Topu Okut"
        continuous
        trigger="tap"
        captureHaptic={false}
        barcodeTypes={['qr', 'code128']}
        onPickFromList={cameraUnusable ? () => setPendingRollList(true) : undefined}
        counter={
          wo.orderTargetQty != null
            ? { scanned: wo.totalQty, expected: wo.orderTargetQty }
            : undefined
        }
        notice={wo.widthWarning ?? undefined}
        // Mükerrer/ret bildirimi kadrajın ORTASINDA: operatörün gözü kamerada,
        // alttaki şeridi görmüyor ve "okumadı" sanıp tekrar okutuyordu.
        flash={wo.scanFlash}
        footer={
          <ScannerRollStrip
            rolls={wo.scanned}
            totalQty={wo.totalQty}
            onRemove={wo.removeRoll}
            rejects={wo.rejects}
            onDismissReject={wo.dismissReject}
            duplicateBarcode={wo.duplicateBarcode}
            showWidth={wo.mixedWidths.length > 1}
          />
        }
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

      {/* Okutulan barkod İPTAL EDİLMİŞ — sebebi göster, kapsam uygunsa geri aldır.
          Sahada bu panel yoktu: ekran "stokta değil" deyip susuyordu ve operatör
          malı sevk edebilmek için ikinci bir kayıt/etiket üretiyordu. Geri alınan
          top DOĞRUDAN listeye girer — operatörü tekrar okutmaya göndermek, çözülen
          sürtünmeyi geri koymak olurdu. */}
      <CancelledRollSheet
        roll={wo.cancelledScan}
        onDismiss={wo.dismissCancelledScan}
        onRestored={(roll) => wo.addRolls([roll])}
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
  specBox: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.appBg,
    paddingHorizontal: spacing.md,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  specRowLast: { borderBottomWidth: 0 },
  specLabel: { width: 62, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: colors.textMuted },
  specValue: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text, textAlign: 'right' },
  successWarn: { fontSize: 13, color: colors.warningDark, fontWeight: '700' },
  successDispatch: { fontSize: 13, color: colors.brand, fontWeight: '700', marginTop: 2 },
  successBtn: { borderRadius: radius.md, alignSelf: 'stretch', marginTop: spacing.sm },
  btnContent: { height: 50 },
});
