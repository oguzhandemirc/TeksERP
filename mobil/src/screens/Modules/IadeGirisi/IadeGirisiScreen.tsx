import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TextInput, IconButton, Surface, TouchableRipple, Icon, ActivityIndicator } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import dayjs from 'dayjs';

import ScreenChrome from '../../../components/ScreenChrome';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import { returnService, type ReturnLookupResult } from '../../../services/return.service';
import { qualityGradeService } from '../../../services/qualityGrade.service';
import { useReturnGradingEnabled } from '../../../hooks/useFeatureFlags';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL, trLabel } from '../../../utils/labels';
import { colors, spacing, radius } from '../../../theme';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../../navigation/types';

// İade modülü vurgu rengi (amber) — alt bardaki "İade Al" ve geçmiş ekranındaki
// "İade" rozetiyle aynı kimlik.
const ACCENT = '#d97706';
const ACCENT_BG = '#fef3c7';

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
        sublabel: o.deadline ? `Termin: ${dayjs(o.deadline).format('DD.MM.YYYY')}` : undefined,
        badge: {
          text: trLabel(ORDER_STATUS_LABEL, o.status),
          color: ORDER_STATUS_COLOR[o.status] ?? colors.textMuted,
        },
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
  const selectedOrderLabel = orderOptions.find((o) => o.value === orderId)?.label ?? null;

  return (
    <ScreenChrome title="İade Girişi">
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Barkod (manuel mod) — kamera alt bardaki "OKUT" ile */}
          {manualMode && (
            <View style={styles.field}>
              <FieldLabel>Top Barkodu</FieldLabel>
              <View style={styles.manualRow}>
                <TextInput
                  mode="outlined"
                  style={styles.flex}
                  outlineColor={colors.border}
                  activeOutlineColor={ACCENT}
                  outlineStyle={styles.inputOutline}
                  placeholder="Top barkodu gir…"
                  value={barcode}
                  onChangeText={setBarcode}
                  onSubmitEditing={() => lookup(barcode)}
                  returnKeyType="search"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  left={<TextInput.Icon icon="barcode" />}
                />
                <IconButton
                  icon={resolving ? 'timer-sand' : 'magnify'}
                  mode="contained"
                  containerColor={ACCENT}
                  iconColor="#fff"
                  size={24}
                  style={styles.manualBtn}
                  onPress={() => lookup(barcode)}
                  disabled={!barcode.trim() || resolving}
                />
              </View>
            </View>
          )}

          {!roll ? (
            <Surface style={styles.emptyCard} elevation={0}>
              <View style={styles.emptyIconBox}>
                <Icon source="barcode-scan" size={32} color={ACCENT} />
              </View>
              <Text style={styles.emptyTitle}>Top Okutun</Text>
              <Text style={styles.emptyText}>
                Sevk edilmiş bir topun barkodunu okutun. Top doğrudan Hazır Depo'ya iade alınır.
              </Text>
            </Surface>
          ) : (
            <>
              {/* Top bilgisi — okutulan topun kimlik kartı */}
              <Surface style={styles.rollCard} elevation={1}>
                <View style={styles.rollHead}>
                  <View style={styles.rollIconBox}>
                    <Icon source="cube-outline" size={20} color={ACCENT} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.rollCaption}>İADE EDİLECEK TOP</Text>
                    <Text style={styles.rollBarcode} numberOfLines={1}>
                      {roll.barcode ?? roll.id.slice(0, 8)}
                    </Text>
                  </View>
                  <View style={styles.qtyChip}>
                    <Text style={styles.qtyChipText}>{roll.currentQty.toFixed(1)} m</Text>
                  </View>
                </View>
                <Text style={styles.rollMeta} numberOfLines={2}>
                  {roll.item?.name ?? '—'}
                  {roll.color ? ` · ${roll.color.name}` : ''}
                  {roll.width != null ? ` · ${roll.width} cm` : ''}
                  {roll.qualityGrade ? ` · ${roll.qualityGrade}` : ''}
                </Text>
                {result?.customer && (
                  <View style={styles.rollSubRow}>
                    <Icon source="account-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.rollSub} numberOfLines={1}>
                      {result.customer.name}
                      {result.shipment ? ` · ${result.shipment.shipmentNo}` : ''}
                    </Text>
                  </View>
                )}
              </Surface>

              {/* Sipariş seçimi (aday siparişler) */}
              <View style={styles.field}>
                <FieldLabel hint={orderOptions.length === 0 ? 'aday yok' : undefined}>Sipariş</FieldLabel>
                <SelectField
                  icon="file-document-outline"
                  value={selectedOrderLabel}
                  placeholder={
                    orderOptions.length === 0 ? 'Bu sevkiyatta uyan sipariş yok' : 'Sipariş seçin…'
                  }
                  disabled={orderOptions.length === 0}
                  onPress={() => setOrderPickerOpen(true)}
                />
              </View>

              {/* İade nedeni (katalog) + serbest metin */}
              <View style={styles.field}>
                <FieldLabel optional>İade Nedeni</FieldLabel>
                <SelectField
                  icon="alert-circle-outline"
                  value={reasonId ? reasonOptions.find((o) => o.value === reasonId)?.label ?? null : null}
                  placeholder="Neden seçin…"
                  onPress={() => setReasonPickerOpen(true)}
                  onClear={reasonId ? () => setReasonId(null) : undefined}
                />
                <TextInput
                  mode="outlined"
                  placeholder="Açıklama (serbest, opsiyonel)"
                  value={reasonText}
                  onChangeText={setReasonText}
                  multiline
                  outlineColor={colors.border}
                  activeOutlineColor={ACCENT}
                  outlineStyle={styles.inputOutline}
                  style={[styles.textArea, styles.fieldGap]}
                />
              </View>

              {/* Teslim alan notu */}
              <View style={styles.field}>
                <FieldLabel optional>Not</FieldLabel>
                <TextInput
                  mode="outlined"
                  placeholder="Teslim alan notu"
                  value={note}
                  onChangeText={setNote}
                  multiline
                  outlineColor={colors.border}
                  activeOutlineColor={ACCENT}
                  outlineStyle={styles.inputOutline}
                  style={styles.textArea}
                />
              </View>

              {/* Kalite (yalnız returnGradingEnabled açıkken) */}
              {returnGradingEnabled && (
                <View style={styles.field}>
                  <FieldLabel optional hint="seçilmezse çıktığı kaliteyle döner">
                    Kalite
                  </FieldLabel>
                  <SelectField
                    icon="star-outline"
                    value={qualityGradeId ? selectedQualityName : null}
                    placeholder={`Mevcut: ${roll.qualityGrade}`}
                    onPress={() => setQualityPickerOpen(true)}
                    onClear={qualityGradeId ? () => setQualityGradeId(null) : undefined}
                  />
                </View>
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
                    <ActivityIndicator size={20} color={ACCENT} />
                  ) : (
                    <Icon source="undo-variant" size={24} color={canSubmit ? ACCENT : colors.textMuted} />
                  )}
                  <Text style={[styles.barBtnText, { color: canSubmit ? ACCENT : colors.textMuted }]}>
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

// ---------------------------------------------------------------------------
// Form alan başlığı — opsiyonel/zorunlu işaret + ipucu suffix.
// ---------------------------------------------------------------------------
function FieldLabel({
  children,
  optional,
  hint,
}: {
  children: React.ReactNode;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <Text style={styles.fieldLabel}>
      {children}
      {optional ? <Text style={styles.fieldLabelMuted}> (opsiyonel)</Text> : null}
      {hint ? <Text style={styles.fieldLabelMuted}> — {hint}</Text> : null}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Seçim alanı — picker tetikleyici. Sabit yükseklik, iç padding, sol ikon,
// opsiyonel temizle (X) ve chevron. FasonSevk picker standardıyla hizalı.
// ---------------------------------------------------------------------------
function SelectField({
  icon,
  value,
  placeholder,
  onPress,
  onClear,
  disabled,
}: {
  icon?: string;
  value: string | null;
  placeholder: string;
  onPress: () => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const filled = !!value;
  return (
    <TouchableRipple
      onPress={onPress}
      disabled={disabled}
      borderless
      style={[styles.select, disabled && styles.selectDisabled]}
    >
      <View style={styles.selectInner}>
        {icon ? (
          <Icon source={icon} size={18} color={filled ? ACCENT : colors.textMuted} />
        ) : null}
        <Text
          style={[styles.selectValue, !filled && styles.selectPlaceholder, disabled && styles.selectDisabledText]}
          numberOfLines={1}
        >
          {value ?? placeholder}
        </Text>
        {onClear ? (
          <IconButton icon="close-circle" size={18} iconColor={colors.textMuted} style={styles.clearBtn} onPress={onClear} />
        ) : null}
        {!disabled && <Icon source="chevron-down" size={22} color={colors.textMuted} />}
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxxl },

  field: { gap: spacing.xs },
  fieldGap: { marginTop: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginLeft: 2 },
  fieldLabelMuted: { fontWeight: '500', color: colors.textMuted, fontSize: 12 },

  // Manuel barkod
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  manualBtn: { margin: 0, borderRadius: radius.md, alignSelf: 'stretch', width: 52 },

  // Çok satırlı metin alanları
  inputOutline: { borderRadius: radius.md, borderWidth: 1.5 },
  textArea: { backgroundColor: colors.surface, minHeight: 56 },

  // Seçim alanı (picker tetikleyici)
  select: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  selectDisabled: { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
  selectInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  selectValue: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  selectPlaceholder: { fontWeight: '500', color: colors.textMuted },
  selectDisabledText: { fontStyle: 'italic', color: colors.textMuted },
  clearBtn: { margin: 0 },

  // Okutulan top kartı
  rollCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: ACCENT,
  },
  rollHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rollIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: ACCENT_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rollCaption: { fontSize: 10.5, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.8 },
  rollBarcode: {
    fontSize: 19,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  qtyChip: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
  },
  qtyChipText: { fontSize: 13, fontWeight: '800', color: '#1d4ed8', fontVariant: ['tabular-nums'] },
  rollMeta: { fontSize: 14, color: colors.text, fontWeight: '500' },
  rollSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rollSub: { flex: 1, fontSize: 13, color: colors.textMuted },

  // Boş durum
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    marginTop: spacing.sm,
  },
  emptyIconBox: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: ACCENT_BG,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  emptyText: { fontSize: 13.5, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },

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
