import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple, Icon, TextInput, Surface } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import OrderLinkPicker from '../OrderLinkPicker';
import type { useQuickWorkOrder } from '../useQuickWorkOrder';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import { useCameraUnusable } from '../../../../hooks/useCameraUnusable';
import { colors, spacing, radius } from '../../../../theme';
import { ITEM_LIFECYCLE_LABEL } from '../../../../lib/item-lifecycle';
import { batchService } from '../../../../services/batch.service';

interface Props {
  wo: ReturnType<typeof useQuickWorkOrder>;
  onOpenScanner: () => void;
  onOpenRollList: () => void;
  onOpenScannedList: () => void;
  orderPickerOpen: boolean;
  onOrderPickerOpenChange: (v: boolean) => void;
}

/**
 * Adım ① — hangi toplar (+ opsiyonel sipariş bağı).
 *
 * Sipariş bilerek BURADA: bağlanınca hedef renk/en'i doldurur ve ürünü kilitler.
 * Adım ③'e konsaydı operatörün adım ②'de girdiği değerleri geriye dönük ezerdi.
 *
 * "Listeden Ekle" birincil buton DEĞİL — kamera birincil yoldur. Liste kurtarma
 * yoludur ve iki yüzeyde de AYNI koşulla çıkar (2026-08-05): Ayarlar → Barkod ve
 * Kamera → "Kamera arızalı" bayrağı açıkken burada buton olarak, tarayıcının
 * içinde de "Listeden Seç" olarak. Tek kaynak `useCameraUnusable`; ayrışırlarsa
 * operatör kaçış yolunu bir ekranda bulup diğerinde bulamaz.
 */
export default function StepRolls({
  wo,
  onOpenScanner,
  onOpenRollList,
  onOpenScannedList,
  orderPickerOpen,
  onOrderPickerOpenChange,
}: Props) {
  const manualMode = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const [manualBarcode, setManualBarcode] = useState('');

  // Kamera bu cihazda kullanılamıyor mu? Tek kaynak: Ayarlar → "Kamera arızalı"
  // (+ kalıcı izin reddi). bkz. hooks/useCameraUnusable — aynı sinyal tarayıcı
  // içindeki "Listeden Seç" butonunu da açar, ikisi ayrışamasın.
  const cameraUnusable = useCameraUnusable();

  const hasRolls = wo.scanned.length > 0;

  return (
    <View style={styles.root}>
      <LastBatchHint />
      <Surface style={styles.summary} elevation={1}>
        {hasRolls ? (
          <>
            <Text style={styles.count}>{wo.scanned.length} top</Text>
            <Text style={styles.meters}>{Math.round(wo.totalQty)} m</Text>
            {wo.lockedItemName ? (
              <View style={styles.itemLock}>
                <Icon source="cube-outline" size={16} color={colors.brand} />
                <Text style={styles.itemLockText} numberOfLines={1}>
                  {wo.lockedItemName}
                </Text>
                {wo.lockedItemPhaseOut ? <Text style={styles.phaseOutText}>{ITEM_LIFECYCLE_LABEL.PHASE_OUT}</Text> : null}
              </View>
            ) : null}
            <Text style={styles.lastScan} numberOfLines={1}>
              son: {wo.scanned[wo.scanned.length - 1].barcode}
            </Text>
            {/* YENİDEN ÜRETİM — ham + bitmiş aynı iş emrinde SERBEST (2026-08-25
                kullanıcı kararı), ayrım yalnız görünürlük. Operatör depodan mal
                çektiğini fark etmeden devam etmesin. */}
            {wo.reworkRolls.length > 0 ? (
              <View style={styles.reworkNote}>
                <Icon source="recycle" size={15} color={colors.warningDark} />
                <Text style={styles.reworkNoteText} numberOfLines={2}>
                  {`${wo.reworkRolls.length} top bitmiş depodan alınıyor — yeniden üretim`}
                </Text>
              </View>
            ) : null}
            <TouchableRipple onPress={onOpenScannedList} style={styles.seeAll} borderless>
              <View style={styles.seeAllInner}>
                <Text style={styles.seeAllText}>Tümünü gör</Text>
                <Icon source="chevron-right" size={18} color={colors.brand} />
              </View>
            </TouchableRipple>
          </>
        ) : (
          <>
            <Icon source="barcode-scan" size={44} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Henüz top eklenmedi</Text>
            <Text style={styles.emptyHint}>
              Aynı üründen stok toplarını okutun. Tek iş emri tek kumaş içindir.
            </Text>
          </>
        )}
      </Surface>

      {/* Parti homojenliği — UYARI, engel değil. Ürün kilitli ama en değil;
          farklı enli topların tek partiye karışması meşru olabilir, sessizce
          olması olamaz (bkz. useQuickWorkOrder.widthWarning). */}
      {wo.widthWarning ? (
        <View style={styles.warnBanner}>
          <Icon source="alert-outline" size={18} color={colors.warningDark} />
          <Text style={styles.warnText}>
            {wo.widthWarning} — aynı iş emrinde farklı enler var. Bilerek yapıyorsanız
            devam edin.
          </Text>
        </View>
      ) : null}

      {manualMode ? (
        <TextInput
          mode="outlined"
          dense
          placeholder="Barkod elle gir"
          value={manualBarcode}
          onChangeText={setManualBarcode}
          onSubmitEditing={() => {
            void wo.handleScan(manualBarcode);
            setManualBarcode('');
          }}
          returnKeyType="done"
          autoCapitalize="characters"
          style={styles.manualInput}
        />
      ) : null}

      <TouchableRipple
        onPress={onOpenScanner}
        style={styles.scanBtn}
        rippleColor="rgba(255,255,255,0.25)"
        accessibilityLabel="Top okut"
      >
        <View style={styles.scanBtnInner}>
          <Icon source="barcode-scan" size={28} color="#fff" />
          <Text style={styles.scanBtnText}>OKUT</Text>
        </View>
      </TouchableRipple>

      {cameraUnusable ? (
        <TouchableRipple
          onPress={onOpenRollList}
          style={styles.listBtn}
          rippleColor="rgba(79,70,229,0.12)"
          accessibilityLabel="Listeden top seç"
        >
          <View style={styles.listBtnInner}>
            <Icon source="format-list-bulleted" size={22} color={colors.brand} />
            <Text style={styles.listBtnText}>Listeden Ekle</Text>
          </View>
        </TouchableRipple>
      ) : null}

      <View style={styles.divider} />

      <OrderLinkPicker
        itemId={wo.lockedItemId}
        value={wo.orderLineIds}
        onChange={wo.changeOrderLines}
        open={orderPickerOpen}
        onOpenChange={onOrderPickerOpenChange}
        onLinePicked={wo.applyOrderLine}
      />
    </View>
  );
}

/**
 * "SON PARTİ: P47" — planlamacıya fikir verir (2026-08-17 saha talebi).
 *
 * Bilerek SON kullanılan yazılır, sıradaki DEĞİL: numara parti doğduğu anda
 * atanıyor ve arada açılan her parti sırayı kaydırıyor. "Sıradaki P48" yazmak
 * tutulmayacak bir söz olurdu; "son P47" ise fabrikadaki fiziksel plaka setiyle
 * karşılaştırılabilen bir GÖZLEMdir.
 *
 * Rejim kapalıysa (kısa numara bayrağı) ya da uç hata verirse hiçbir şey
 * çizilmez — sihirbazın ilk adımı bir gösterge yüzünden kırmızıya boyanmaz.
 */
function LastBatchHint() {
  const q = useQuery({
    queryKey: ['batch-number-state'],
    queryFn: batchService.getNumberState,
    staleTime: 30_000,
    retry: false,
  });
  const s = q.data?.data;
  if (!s?.enabled || !s.lastCode) return null;
  return (
    <View style={styles.lastBatch}>
      <Icon source="tag-outline" size={14} color={colors.textMuted} />
      <Text style={styles.lastBatchText}>
        SON PARTİ: <Text style={styles.lastBatchCode}>{s.lastCode}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lastBatch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  lastBatchText: { fontSize: 12, color: colors.textMuted, letterSpacing: 0.3 },
  lastBatchCode: { fontSize: 13, fontWeight: '800', color: colors.text },
  root: { padding: spacing.md, gap: spacing.md },
  summary: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: 2,
  },
  count: { fontSize: 34, fontWeight: '800', color: colors.text, lineHeight: 40 },
  meters: { fontSize: 22, fontWeight: '800', color: colors.brand },
  itemLock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  itemLockText: { color: colors.brand, fontWeight: '700', fontSize: 13, flexShrink: 1 },
  phaseOutText: { color: colors.warningText, fontWeight: '700', fontSize: 12, marginLeft: 6 },
  reworkNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.warningContainer,
  },
  reworkNoteText: { fontSize: 12, fontWeight: '700', color: colors.warningDark, flexShrink: 1 },
  lastScan: { marginTop: spacing.xs, fontSize: 12, color: colors.textMuted, fontFamily: 'monospace' },
  seeAll: { marginTop: spacing.sm, borderRadius: radius.sm },
  seeAllInner: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: spacing.md },
  seeAllText: { color: colors.brand, fontWeight: '800', fontSize: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.textSecondary, marginTop: spacing.sm },
  emptyHint: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
    maxWidth: 300,
  },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningContainer,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  warnText: { flex: 1, color: colors.warningDark, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  manualInput: { backgroundColor: colors.surface },
  scanBtn: {
    minHeight: 68,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  scanBtnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  scanBtnText: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  listBtn: {
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  listBtnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  listBtnText: { color: colors.brand, fontSize: 16, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
});
