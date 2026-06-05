import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TextInput, IconButton, Surface, TouchableRipple, Chip, Icon, ActivityIndicator } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import { returnService, type ReturnLookupResult } from '../../../services/return.service';
import { qualityGradeService } from '../../../services/qualityGrade.service';
import { useReturnGradingEnabled } from '../../../hooks/useFeatureFlags';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { colors, spacing, radius } from '../../../theme';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../../navigation/types';

export default function IadeGirisiScreen() {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const manualMode = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const returnGradingEnabled = useReturnGradingEnabled();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();

  const [barcode, setBarcode] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState<ReturnLookupResult | null>(null);

  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [reasonPickerOpen, setReasonPickerOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [note, setNote] = useState('');
  const [qualityGradeId, setQualityGradeId] = useState<string | null>(null);
  const [qualityPickerOpen, setQualityPickerOpen] = useState(false);

  const reasonsQuery = useQuery({
    queryKey: ['return-reasons'],
    queryFn: () => returnService.listReasons(),
    staleTime: 10 * 60 * 1000,
  });
  const qualityQuery = useQuery({
    queryKey: ['quality-grades'],
    queryFn: () => qualityGradeService.list(),
    staleTime: 10 * 60 * 1000,
    enabled: returnGradingEnabled,
  });

  const reasonOptions: PickerOption[] = useMemo(
    () => (reasonsQuery.data?.data ?? []).map((r) => ({ value: r.id, label: r.name, sublabel: r.code })),
    [reasonsQuery.data],
  );
  const qualityOptions: PickerOption[] = useMemo(
    () => (qualityQuery.data?.data ?? []).map((q) => ({ value: q.id, label: q.name, sublabel: q.code })),
    [qualityQuery.data],
  );
  const orderOptions: PickerOption[] = useMemo(
    () =>
      (result?.candidateOrders ?? []).map((o) => ({
        value: o.id,
        label: o.orderNumber,
        sublabel: o.status,
      })),
    [result],
  );

  const resetForm = useCallback(() => {
    setResult(null);
    setBarcode('');
    setOrderId(null);
    setReasonId(null);
    setReasonText('');
    setNote('');
    setQualityGradeId(null);
  }, []);

  const lookup = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setResolving(true);
    try {
      const res = await returnService.lookup(trimmed);
      const data = res.data;
      setResult(data);
      setBarcode(trimmed);
      // Tek aday sipariş → otomatik seç.
      setOrderId(data.candidateOrders.length === 1 ? data.candidateOrders[0].id : null);
      setReasonId(null);
      setReasonText('');
      setNote('');
      setQualityGradeId(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'İade alınamaz', text2: (err as Error).message });
    } finally {
      setResolving(false);
    }
  }, []);

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await returnService.create({
          rollId: result!.roll.id,
          orderId,
          reasonId,
          reasonText: reasonText.trim() || null,
          note: note.trim() || null,
          qualityGradeId: returnGradingEnabled ? qualityGradeId : null,
        })
      ).data,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'İade alındı', text2: "Top Hazır Depo'ya eklendi" });
      resetForm();
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'İade başarısız', text2: (err as Error).message });
    },
  });

  const canSubmit = !!result && !createMutation.isPending;
  const roll = result?.roll;
  const selectedQualityName =
    qualityOptions.find((o) => o.value === qualityGradeId)?.label ?? roll?.qualityGrade ?? '—';

  return (
    <ScreenChrome title="İade Girişi">
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Barkod (manuel mod) — kamera alt bardaki "OKUT" ile */}
          {manualMode && (
            <Surface style={styles.card} elevation={1}>
              <Text variant="labelLarge" style={styles.cardTitle}>
                Top Barkodu
              </Text>
              <View style={styles.manualRow}>
                <TextInput
                  mode="outlined"
                  dense
                  style={{ flex: 1, backgroundColor: colors.surface }}
                  placeholder="Top barkodu gir…"
                  value={barcode}
                  onChangeText={setBarcode}
                  onSubmitEditing={() => lookup(barcode)}
                  returnKeyType="done"
                  autoCapitalize="characters"
                  left={<TextInput.Icon icon="barcode" />}
                />
                <IconButton
                  icon="magnify"
                  mode="contained"
                  onPress={() => lookup(barcode)}
                  disabled={!barcode.trim() || resolving}
                />
              </View>
            </Surface>
          )}

          {!roll ? (
            <Surface style={styles.card} elevation={1}>
              <Text variant="bodyMedium" style={styles.empty}>
                Sevk edilmiş bir top okutun. Top doğrudan Hazır Depoya iade alınır.
              </Text>
            </Surface>
          ) : (
            <>
              {/* Top bilgisi */}
              <Surface style={styles.card} elevation={1}>
                <View style={styles.rowBetween}>
                  <Text variant="titleMedium" style={styles.rollBarcode}>
                    {roll.barcode ?? roll.id.slice(0, 8)}
                  </Text>
                  <Chip compact style={styles.qtyChip} textStyle={styles.qtyChipText}>
                    {roll.currentQty.toFixed(1)} m
                  </Chip>
                </View>
                <Text variant="bodyMedium" style={styles.rollMeta}>
                  {roll.item?.name ?? '—'}
                  {roll.color ? ` · ${roll.color.name}` : ''}
                  {roll.width != null ? ` · ${roll.width} cm` : ''} · {roll.qualityGrade}
                </Text>
                {result?.customer && (
                  <Text variant="bodySmall" style={styles.rollSub}>
                    {result.customer.name}
                    {result.shipment ? ` · ${result.shipment.shipmentNo}` : ''}
                  </Text>
                )}
              </Surface>

              {/* Sipariş seçimi (aday siparişler) */}
              <Surface style={styles.card} elevation={1}>
                <Text variant="labelLarge" style={styles.cardTitle}>
                  Sipariş {orderOptions.length === 0 ? '(aday yok)' : ''}
                </Text>
                <TouchableRipple
                  style={styles.select}
                  onPress={() => orderOptions.length > 0 && setOrderPickerOpen(true)}
                  borderless
                  disabled={orderOptions.length === 0}
                >
                  <View style={styles.rowBetween}>
                    <Text variant="bodyLarge" style={{ color: orderId ? colors.text : colors.textMuted }}>
                      {orderId
                        ? orderOptions.find((o) => o.value === orderId)?.label
                        : orderOptions.length === 0
                          ? 'Bu sevkiyatta uyan sipariş yok'
                          : 'Sipariş seçin…'}
                    </Text>
                    {orderOptions.length > 0 && <IconButton icon="chevron-down" size={20} />}
                  </View>
                </TouchableRipple>
              </Surface>

              {/* İade nedeni (katalog) + serbest metin */}
              <Surface style={styles.card} elevation={1}>
                <Text variant="labelLarge" style={styles.cardTitle}>
                  İade Nedeni (opsiyonel)
                </Text>
                <TouchableRipple style={styles.select} onPress={() => setReasonPickerOpen(true)} borderless>
                  <View style={styles.rowBetween}>
                    <Text variant="bodyLarge" style={{ color: reasonId ? colors.text : colors.textMuted }}>
                      {reasonId ? reasonOptions.find((o) => o.value === reasonId)?.label : 'Neden seçin…'}
                    </Text>
                    <View style={styles.rowRight}>
                      {reasonId && (
                        <IconButton icon="close" size={16} onPress={() => setReasonId(null)} />
                      )}
                      <IconButton icon="chevron-down" size={20} />
                    </View>
                  </View>
                </TouchableRipple>
                <TextInput
                  mode="outlined"
                  label="Açıklama (serbest, opsiyonel)"
                  value={reasonText}
                  onChangeText={setReasonText}
                  dense
                  multiline
                />
              </Surface>

              {/* Teslim alan notu */}
              <Surface style={styles.card} elevation={1}>
                <Text variant="labelLarge" style={styles.cardTitle}>
                  Not (opsiyonel)
                </Text>
                <TextInput
                  mode="outlined"
                  label="Teslim alan notu"
                  value={note}
                  onChangeText={setNote}
                  dense
                  multiline
                />
              </Surface>

              {/* Kalite (yalnız returnGradingEnabled açıkken) */}
              {returnGradingEnabled && (
                <Surface style={styles.card} elevation={1}>
                  <Text variant="labelLarge" style={styles.cardTitle}>
                    Kalite (opsiyonel — seçilmezse çıktığı kaliteyle döner)
                  </Text>
                  <TouchableRipple style={styles.select} onPress={() => setQualityPickerOpen(true)} borderless>
                    <View style={styles.rowBetween}>
                      <Text variant="bodyLarge" style={{ color: qualityGradeId ? colors.text : colors.textMuted }}>
                        {qualityGradeId ? selectedQualityName : `Mevcut: ${roll.qualityGrade}`}
                      </Text>
                      <View style={styles.rowRight}>
                        {qualityGradeId && (
                          <IconButton icon="close" size={16} onPress={() => setQualityGradeId(null)} />
                        )}
                        <IconButton icon="chevron-down" size={20} />
                      </View>
                    </View>
                  </TouchableRipple>
                </Surface>
              )}
            </>
          )}
        </ScrollView>

        {/* Alt bar — FasonKabul deseni: Kamera ile Okut (orta, dolgulu yeşil
            hero) · İade Al (sağ, amber). Güvenli alanı doldurup ekran dibine
            uzar. */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom, marginBottom: -insets.bottom }]}>
          <View style={styles.barContent}>
            <View style={styles.barCellSide}>
              <TouchableRipple
                onPress={() => nav.navigate('IadeGecmisi')}
                style={styles.barBtn}
                rippleColor="rgba(100,116,139,0.12)"
                accessibilityLabel="İade geçmişi"
              >
                <View style={styles.barBtnInner}>
                  <Icon source="history" size={24} color={colors.textSecondary} />
                  <Text style={[styles.barBtnText, { color: colors.textSecondary }]}>Geçmiş</Text>
                </View>
              </TouchableRipple>
            </View>
            <View style={styles.barCellPrimary}>
              <TouchableRipple
                onPress={() => setScannerOpen(true)}
                style={[styles.barBtn, styles.barBtnPrimaryFill]}
                rippleColor="rgba(255,255,255,0.25)"
                accessibilityLabel="Kamera ile okut"
              >
                <View style={styles.barBtnInner}>
                  <Icon source="camera" size={30} color="#fff" />
                  <Text style={[styles.barBtnText, { color: '#fff' }]}>Kamera ile Okut</Text>
                </View>
              </TouchableRipple>
            </View>

            <View style={styles.barCellSide}>
              <TouchableRipple
                onPress={() => canSubmit && createMutation.mutate()}
                disabled={!canSubmit}
                style={styles.barBtn}
                rippleColor="rgba(217, 119, 6, 0.12)"
                accessibilityLabel="İade al"
              >
                <View style={styles.barBtnInner}>
                  {createMutation.isPending ? (
                    <ActivityIndicator size={20} color="#d97706" />
                  ) : (
                    <Icon source="undo-variant" size={24} color={canSubmit ? '#d97706' : colors.textMuted} />
                  )}
                  <Text style={[styles.barBtnText, { color: canSubmit ? '#d97706' : colors.textMuted }]}>
                    İade Al
                  </Text>
                </View>
              </TouchableRipple>
            </View>
          </View>
        </View>
      </View>

      <BarcodeScannerModal
        visible={scannerOpen}
        title="İade Edilecek Top QR Okut"
        onDismiss={() => setScannerOpen(false)}
        onScan={(code) => {
          setScannerOpen(false);
          void lookup(code);
        }}
      />

      <PickerModal
        visible={orderPickerOpen}
        title="Sipariş Seç"
        options={orderOptions}
        selectedValue={orderId ?? undefined}
        emptyText="Bu sevkiyatta uyan sipariş yok"
        onSelect={(v) => {
          setOrderId(v);
          setOrderPickerOpen(false);
        }}
        onDismiss={() => setOrderPickerOpen(false)}
      />

      <PickerModal
        visible={reasonPickerOpen}
        title="İade Nedeni Seç"
        options={reasonOptions}
        selectedValue={reasonId ?? undefined}
        loading={reasonsQuery.isLoading}
        emptyText="İade nedeni tanımlı değil"
        onSelect={(v) => {
          setReasonId(v);
          setReasonPickerOpen(false);
        }}
        onDismiss={() => setReasonPickerOpen(false)}
      />

      <PickerModal
        visible={qualityPickerOpen}
        title="Kalite Seç"
        options={qualityOptions}
        selectedValue={qualityGradeId ?? undefined}
        loading={qualityQuery.isLoading}
        emptyText="Kalite derecesi yok"
        onSelect={(v) => {
          setQualityGradeId(v);
          setQualityPickerOpen(false);
        }}
        onDismiss={() => setQualityPickerOpen(false)}
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },
  card: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  cardTitle: { color: colors.textSecondary },
  empty: { color: colors.textMuted, fontStyle: 'italic', paddingVertical: spacing.sm },
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  select: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowRight: { flexDirection: 'row', alignItems: 'center' },
  rollBarcode: { fontWeight: '700', color: colors.text },
  rollMeta: { color: colors.text, marginTop: 2 },
  rollSub: { color: colors.textMuted, marginTop: 2 },
  qtyChip: { backgroundColor: '#dbeafe', height: 26 },
  qtyChipText: { fontSize: 13, fontWeight: '700', color: '#1d4ed8', marginVertical: 0 },
  // Alt bar — FasonKabul deseni (dolgulu yeşil hero + amber yan). Tam genişlik
  // bg, içerik tablet için maks-genişlikle ortalanır; güvenli alana uzar.
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 6,
  },
  barContent: { height: 64, flexDirection: 'row', width: '100%', maxWidth: 520, alignSelf: 'center' },
  barCellPrimary: { flex: 4 },
  barCellSide: { flex: 3 },
  barBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  barBtnPrimaryFill: { backgroundColor: '#059669' },
  barBtnInner: { alignItems: 'center', gap: 2 },
  barBtnText: { fontSize: 12, fontWeight: '700', color: colors.text },
});
