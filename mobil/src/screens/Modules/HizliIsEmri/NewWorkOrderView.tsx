import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import {
  Text,
  Button,
  TouchableRipple,
  Icon,
  TextInput,
  Surface,
} from 'react-native-paper';
import { useMutation, useQuery, useQueryClient, onlineManager } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import WorkOrderHeaderFields, {
  EMPTY_HEADER_FIELDS,
  type WoHeaderFieldValues,
} from './WorkOrderHeaderFields';
import OrderLinkPicker from './OrderLinkPicker';
import { useCardPrinter } from './useCardPrinter';
import { buildWorkOrderCardData } from './printWorkOrder';

import { rollService } from '../../../services/roll.service';
import { routeService } from '../../../services/route.service';
import { productRecipeService } from '../../../services/productRecipe.service';
import { workOrderService, type QuickStartRequest } from '../../../services/workOrder.service';
import { useDeviceSettingsStore, type QuickWoMode } from '../../../store/deviceSettingsStore';
import { useFeatureFlags } from '../../../hooks/useFeatureFlags';
import { ROLL_STATUS_LABEL, trLabel } from '../../../utils/labels';
import { colors, spacing, radius, shadow } from '../../../theme';

interface ScannedRoll {
  barcode: string;
  itemId: string;
  itemName: string;
  qty: number;
}

const toPositiveNum = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function NewWorkOrderView() {
  const qc = useQueryClient();
  const mode = useDeviceSettingsStore((s) => s.quickWoMode);
  const setMode = useDeviceSettingsStore((s) => s.setQuickWoMode);
  const manualMode = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const companyName = useFeatureFlags().data?.companyName ?? 'Adnan Şahin Tekstil';
  const { QrSink, printCard, printing } = useCardPrinter();

  const [scanned, setScanned] = useState<ScannedRoll[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const resolvingRef = useRef(false);

  const [routeTemplateId, setRouteTemplateId] = useState<string | null>(null);
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [recipePickerOpen, setRecipePickerOpen] = useState(false);
  const [header, setHeader] = useState<WoHeaderFieldValues>(EMPTY_HEADER_FIELDS);
  const [orderLineIds, setOrderLineIds] = useState<string[]>([]);

  const [result, setResult] = useState<{ batchNumber: string; attached: number; errors: string[]; woId: string } | null>(
    null,
  );

  const lockedItemId = scanned[0]?.itemId ?? null;
  const lockedItemName = scanned[0]?.itemName ?? null;
  const totalQty = useMemo(() => scanned.reduce((s, r) => s + r.qty, 0), [scanned]);

  // ── Master data ──────────────────────────────────────────────────────────
  const routesQuery = useQuery({
    queryKey: ['routes', 'wo-picker'],
    queryFn: () => routeService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 10 * 60 * 1000,
  });
  const recipesQuery = useQuery({
    queryKey: ['product-recipes', 'wo-picker'],
    queryFn: () => productRecipeService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 10 * 60 * 1000,
    enabled: recipePickerOpen || !!recipeId,
  });

  const routeOptions: PickerOption[] = useMemo(
    () =>
      (routesQuery.data?.data ?? []).map((r) => ({
        value: r.id,
        label: r.name,
        sublabel: r.code ?? undefined,
        badge: r.isFavorite ? { text: '★', color: colors.warning } : undefined,
      })),
    [routesQuery.data],
  );
  const recipeOptions: PickerOption[] = useMemo(
    () =>
      (recipesQuery.data?.data ?? []).map((r) => ({
        value: r.id,
        label: r.name,
        sublabel: r.code,
      })),
    [recipesQuery.data],
  );

  const routeLabel = routeOptions.find((o) => o.value === routeTemplateId)?.label ?? null;
  const recipeLabel = recipeOptions.find((o) => o.value === recipeId)?.label ?? null;

  // ── Tarama ───────────────────────────────────────────────────────────────
  const reject = (text2: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    Toast.show({ type: 'error', text1: 'Top eklenmedi', text2 });
  };

  const handleScan = useCallback(
    async (raw: string) => {
      const barcode = raw.trim();
      if (!barcode) return;
      if (resolvingRef.current) return;
      // Mükerrer
      let dup = false;
      setScanned((prev) => {
        dup = prev.some((s) => s.barcode === barcode);
        return prev;
      });
      if (dup) {
        reject(`${barcode} zaten okutuldu`);
        return;
      }
      resolvingRef.current = true;
      try {
        const res = await rollService.getByBarcode(barcode);
        const roll = res.data;
        if (!roll) {
          reject(`${barcode} bulunamadı`);
          return;
        }
        if (roll.status !== 'STOCK') {
          reject(`${barcode} stokta değil (${trLabel(ROLL_STATUS_LABEL, roll.status)})`);
          return;
        }
        let mismatch = false;
        setScanned((prev) => {
          const lockId = prev[0]?.itemId;
          if (lockId && roll.itemId !== lockId) {
            mismatch = true;
            return prev;
          }
          if (prev.some((s) => s.barcode === barcode)) return prev;
          return [
            ...prev,
            {
              barcode,
              itemId: roll.itemId,
              itemName: roll.item?.name ?? 'Ürün',
              qty: Number(roll.currentQty) || 0,
            },
          ];
        });
        if (mismatch) {
          reject('Farklı ürün — tek iş emri tek kumaş. Aynı ürünü okut.');
          return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Toast.show({ type: 'success', text1: 'Eklendi', text2: barcode, visibilityTime: 900 });
      } catch {
        reject(`${barcode} okunamadı`);
      } finally {
        resolvingRef.current = false;
      }
    },
    [],
  );

  const removeRoll = (barcode: string) => setScanned((prev) => prev.filter((s) => s.barcode !== barcode));
  const clearScanned = () => setScanned([]);

  // ── Reçete uygula (Basit) ──────────────────────────────────────────────────
  const applyRecipe = (id: string) => {
    setRecipeId(id);
    const r = (recipesQuery.data?.data ?? []).find((x) => x.id === id);
    if (!r) return;
    if (r.routeId) setRouteTemplateId(r.routeId);
    setHeader((h) => ({
      ...h,
      targetColorId: r.colorId ?? null,
      width: r.width != null ? String(r.width) : '',
      foldType: r.foldType ?? null,
    }));
  };

  // ── Oluştur ────────────────────────────────────────────────────────────────
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: (payload: QuickStartRequest) => workOrderService.quickStart(payload),
    onSuccess: (res) => {
      const data = res.data;
      if (!data) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setResult({
        batchNumber: data.workOrder.batchNumber,
        attached: data.attached,
        errors: data.errors,
        woId: data.workOrder.id,
      });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['rolls'] });
    },
    onError: (err: unknown) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      Toast.show({
        type: 'error',
        text1: 'İş emri başlatılamadı',
        text2: e?.response?.data?.message ?? e?.message ?? 'Bilinmeyen hata',
      });
    },
  });

  const canSubmit = scanned.length > 0 && !!routeTemplateId && !mutation.isPending;

  const submit = () => {
    if (!onlineManager.isOnline()) {
      Toast.show({ type: 'error', text1: 'Çevrimdışı', text2: 'İş emri başlatmak için bağlantı gerekli.' });
      return;
    }
    if (!routeTemplateId) {
      Toast.show({ type: 'error', text1: 'Rota seçin', text2: 'Bir rota şablonu seçmelisiniz.' });
      return;
    }
    const payload: QuickStartRequest = {
      rollBarcodes: scanned.map((s) => s.barcode),
      routeTemplateId,
      targetColorId: header.targetColorId,
      width: toPositiveNum(header.width),
      targetQuantity: toPositiveNum(header.targetQuantity),
      targetWeight: toPositiveNum(header.targetWeight),
      foldType: header.foldType,
      dyehouseNote: header.dyehouseNote.trim() || null,
      // Boş → backend Electron ile aynı algoritmayı (P-YYMMDD-NNN) üretir; doluysa override.
      batchNumber: header.batchNumber.trim() || undefined,
      orderLineIds: mode === 'advanced' && orderLineIds.length ? orderLineIds : undefined,
      // targetItemId verilmiyor → backend okutulan topların ürününden türetir
    };
    mutation.mutate(payload);
  };

  const resetAll = () => {
    setScanned([]);
    setRouteTemplateId(null);
    setRecipeId(null);
    setHeader(EMPTY_HEADER_FIELDS);
    setOrderLineIds([]);
    setResult(null);
  };

  const printResult = async () => {
    if (!result) return;
    try {
      const data = await buildWorkOrderCardData(result.woId, companyName);
      await printCard(data);
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Çıktı alınamadı', text2: e instanceof Error ? e.message : '' });
    }
  };

  // ── Başarı ekranı ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <View style={styles.successWrap}>
        {QrSink}
        <Surface style={styles.successCard} elevation={2}>
          <View style={styles.successIcon}>
            <Icon source="check-circle" size={56} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>İş Emri Başlatıldı</Text>
          <Text style={styles.successBatch}>{result.batchNumber}</Text>
          <Text style={styles.successMeta}>{result.attached} top bağlandı</Text>
          {result.errors.length > 0 ? (
            <Text style={styles.successWarn}>{result.errors.length} top bağlanamadı</Text>
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
          <Button mode="outlined" icon="plus" onPress={resetAll} style={styles.successBtn} contentStyle={styles.btnContent}>
            Yeni İş Emri
          </Button>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {QrSink}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Mod seçici */}
        <View style={styles.modeRow}>
          {(['simple', 'advanced'] as QuickWoMode[]).map((m) => {
            const active = mode === m;
            return (
              <TouchableRipple
                key={m}
                onPress={() => setMode(m)}
                style={[styles.modeChip, active && styles.modeChipActive]}
                borderless
                rippleColor="rgba(79,70,229,0.12)"
              >
                <Text style={[styles.modeText, active && styles.modeTextActive]}>
                  {m === 'simple' ? 'Basit' : 'Gelişmiş'}
                </Text>
              </TouchableRipple>
            );
          })}
        </View>

        {/* Tarama kartı */}
        <Surface style={styles.card} elevation={1}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Stok Topları</Text>
            {scanned.length > 0 ? (
              <TouchableRipple onPress={clearScanned} borderless style={styles.clearAll}>
                <Text style={styles.clearAllText}>Temizle</Text>
              </TouchableRipple>
            ) : null}
          </View>

          <Button
            mode="contained"
            icon="barcode-scan"
            onPress={() => setScannerOpen(true)}
            style={styles.scanBtn}
            contentStyle={styles.scanBtnContent}
          >
            Topları Okut
          </Button>

          {manualMode ? (
            <View style={styles.manualRow}>
              <TextInput
                mode="outlined"
                dense
                placeholder="Barkod elle gir"
                value={manualBarcode}
                onChangeText={setManualBarcode}
                onSubmitEditing={() => {
                  void handleScan(manualBarcode);
                  setManualBarcode('');
                }}
                returnKeyType="done"
                autoCapitalize="characters"
                style={styles.manualInput}
              />
            </View>
          ) : null}

          {lockedItemName ? (
            <View style={styles.itemLock}>
              <Icon source="cube-outline" size={16} color={colors.brand} />
              <Text style={styles.itemLockText} numberOfLines={1}>
                {lockedItemName}
              </Text>
            </View>
          ) : null}

          {scanned.length === 0 ? (
            <Text style={styles.emptyScan}>Henüz top okutulmadı. Aynı üründen topları arka arkaya okutun.</Text>
          ) : (
            <View style={styles.rollList}>
              {scanned.map((s, i) => (
                <View key={s.barcode} style={styles.rollRow}>
                  <Text style={styles.rollIdx}>{i + 1}</Text>
                  <Text style={styles.rollBarcode} numberOfLines={1}>
                    {s.barcode}
                  </Text>
                  <Text style={styles.rollQty}>{Math.round(s.qty)}m</Text>
                  <TouchableRipple onPress={() => removeRoll(s.barcode)} borderless style={styles.rollRemove}>
                    <Icon source="close" size={18} color={colors.danger} />
                  </TouchableRipple>
                </View>
              ))}
              <View style={styles.totalBar}>
                <Text style={styles.totalText}>
                  {scanned.length} top · {Math.round(totalQty)} m
                </Text>
              </View>
            </View>
          )}
        </Surface>

        {/* Form kartı */}
        <Surface style={styles.card} elevation={1}>
          <Text style={styles.cardTitle}>İş Emri Bilgileri</Text>

          {/* Rota — her iki modda zorunlu */}
          <Text style={styles.label}>
            Rota Şablonu <Text style={styles.req}>*</Text>
          </Text>
          <TouchableRipple
            onPress={() => setRoutePickerOpen(true)}
            style={styles.selectField}
            borderless
            rippleColor="rgba(79,70,229,0.12)"
          >
            <Text style={[styles.selectText, !routeLabel && styles.placeholder]} numberOfLines={1}>
              {routeLabel ?? 'Rota seç'}
            </Text>
          </TouchableRipple>

          {/* Parti Kodu — her iki modda override edilebilir; boş = otomatik (Electron algoritması). */}
          <Text style={styles.label}>Parti Kodu</Text>
          <TextInput
            mode="outlined"
            dense
            value={header.batchNumber}
            onChangeText={(t) => setHeader((h) => ({ ...h, batchNumber: t }))}
            placeholder="Otomatik (P-YYMMDD-NNN) — değiştirmek için yazın"
            autoCapitalize="characters"
            style={styles.input}
          />

          {mode === 'simple' ? (
            <>
              <Text style={styles.label}>Reçete (opsiyonel — renk/en/rotayı doldurur)</Text>
              <View style={styles.rowGap}>
                <TouchableRipple
                  onPress={() => setRecipePickerOpen(true)}
                  style={styles.selectFieldFlex}
                  borderless
                  rippleColor="rgba(79,70,229,0.12)"
                >
                  <Text style={[styles.selectText, !recipeLabel && styles.placeholder]} numberOfLines={1}>
                    {recipeLabel ?? 'Reçete seç'}
                  </Text>
                </TouchableRipple>
                {recipeId ? (
                  <TouchableRipple onPress={() => setRecipeId(null)} style={styles.clearBtn} borderless>
                    <Text style={styles.clearText}>Temizle</Text>
                  </TouchableRipple>
                ) : null}
              </View>
              <Text style={styles.hint}>Hedef ürün okutulan toplardan otomatik belirlenir.</Text>
            </>
          ) : (
            <>
              <WorkOrderHeaderFields value={header} onChange={(p) => setHeader((h) => ({ ...h, ...p }))} />
              <OrderLinkPicker itemId={lockedItemId} value={orderLineIds} onChange={setOrderLineIds} />
            </>
          )}
        </Surface>

        <View style={{ height: 90 }} />
      </ScrollView>

      {/* Sticky başlat butonu */}
      <View style={styles.footer}>
        <Button
          mode="contained"
          icon="rocket-launch"
          onPress={submit}
          disabled={!canSubmit}
          loading={mutation.isPending}
          style={styles.submitBtn}
          contentStyle={styles.submitBtnContent}
          labelStyle={styles.submitLabel}
        >
          İş Emrini Başlat{scanned.length > 0 ? ` (${scanned.length})` : ''}
        </Button>
      </View>

      {/* Sürekli tarayıcı */}
      <BarcodeScannerModal
        visible={scannerOpen}
        onDismiss={() => setScannerOpen(false)}
        onScan={(b) => void handleScan(b)}
        title="Stok Topu Okut"
        continuous
        barcodeTypes={['qr', 'code128']}
      />

      {/* Rota picker */}
      <PickerModal
        visible={routePickerOpen}
        title="Rota Şablonu Seç"
        options={routeOptions}
        selectedValue={routeTemplateId}
        loading={routesQuery.isLoading}
        onSelect={setRouteTemplateId}
        onDismiss={() => setRoutePickerOpen(false)}
        onRefresh={() => routesQuery.refetch()}
        emptyText="Rota şablonu yok"
      />

      {/* Reçete picker */}
      <PickerModal
        visible={recipePickerOpen}
        title="Reçete Seç"
        options={recipeOptions}
        selectedValue={recipeId}
        loading={recipesQuery.isLoading}
        onSelect={applyRecipe}
        onDismiss={() => setRecipePickerOpen(false)}
        onRefresh={() => recipesQuery.refetch()}
        emptyText="Reçete yok"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  scroll: { padding: spacing.md, gap: spacing.md },

  modeRow: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.full, padding: 4 },
  modeChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.full },
  modeChipActive: { backgroundColor: colors.surface, ...shadow.sm },
  modeText: { fontWeight: '700', color: colors.textSecondary, fontSize: 14 },
  modeTextActive: { color: colors.brand },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  clearAll: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  clearAllText: { color: colors.danger, fontWeight: '700', fontSize: 13 },

  scanBtn: { borderRadius: radius.md, marginTop: spacing.xs },
  scanBtnContent: { height: 52 },
  manualRow: { marginTop: spacing.sm },
  manualInput: { backgroundColor: colors.surface },

  itemLock: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, backgroundColor: colors.brandSoft, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, alignSelf: 'flex-start' },
  itemLockText: { color: colors.brand, fontWeight: '700', fontSize: 13 },

  emptyScan: { color: colors.textMuted, fontSize: 13, marginTop: spacing.md, lineHeight: 18 },
  rollList: { marginTop: spacing.sm, gap: 4 },
  rollRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  rollIdx: { width: 22, textAlign: 'center', color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  rollBarcode: { flex: 1, fontFamily: 'monospace', fontSize: 13, color: colors.text },
  rollQty: { fontWeight: '700', color: colors.textSecondary, fontSize: 13 },
  rollRemove: { padding: 4, borderRadius: radius.full },
  totalBar: { marginTop: spacing.sm, backgroundColor: colors.brandSoft, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  totalText: { fontWeight: '800', color: colors.brand, fontSize: 15 },

  label: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 2 },
  req: { color: colors.danger },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 17 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectField: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 12, backgroundColor: colors.surface },
  selectFieldFlex: { flex: 1, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 12, backgroundColor: colors.surface },
  selectText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  input: { backgroundColor: colors.surface },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  clearBtn: { paddingHorizontal: spacing.sm, paddingVertical: 10 },
  clearText: { color: colors.danger, fontWeight: '700', fontSize: 13 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  submitBtn: { borderRadius: radius.md },
  submitBtnContent: { height: 54 },
  submitLabel: { fontSize: 16, fontWeight: '800' },

  successWrap: { flex: 1, backgroundColor: colors.appBg, justifyContent: 'center', padding: spacing.lg },
  successCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xxl, alignItems: 'center', gap: spacing.sm },
  successIcon: { marginBottom: spacing.xs },
  successTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  successBatch: { fontSize: 24, fontWeight: '800', color: colors.brand, marginTop: 2 },
  successMeta: { fontSize: 14, color: colors.textSecondary },
  successWarn: { fontSize: 13, color: colors.warningDark, fontWeight: '700' },
  successBtn: { borderRadius: radius.md, alignSelf: 'stretch', marginTop: spacing.sm },
  btnContent: { height: 50 },
});
