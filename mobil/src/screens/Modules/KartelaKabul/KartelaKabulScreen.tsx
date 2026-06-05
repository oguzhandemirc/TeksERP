import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Surface,
  TouchableRipple,
  Checkbox,
  SegmentedButtons,
  Divider,
  Icon,
  ActivityIndicator,
} from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import { SkeletonList } from '../../../components/motion';
import { useKartelaFirms } from '../../../hooks/useKartelaFirms';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import {
  kartelaService,
  type KartelaOutstandingItem,
  type KartelaReceiptListItem,
  type KartelaReceiveReturn,
} from '../../../services/kartela.service';
import { STATION_MUT } from '../../../offline/mutations';
import { colors, spacing, radius } from '../../../theme';
import type { MainStackParamList } from '../../../navigation/types';

interface RowState {
  selected: boolean;
  count: string;
  mode: 'bulk' | 'each';
  bulkCm: string;
  bulkKg: string;
  items: { cm: string; kg: string }[];
}

const emptyRow = (): RowState => ({
  selected: false,
  count: '1',
  mode: 'bulk',
  bulkCm: '',
  bulkKg: '',
  items: [{ cm: '', kg: '' }],
});

const parseNum = (s: string): number | null => {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const resizeItems = (items: { cm: string; kg: string }[], count: number) => {
  const next = items.slice(0, Math.max(0, count));
  while (next.length < count) next.push({ cm: '', kg: '' });
  return next;
};

export default function KartelaKabulScreen() {
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const insets = useSafeAreaInsets();
  const [firmId, setFirmId] = useState<string | null>(null);
  const [firmName, setFirmName] = useState('');
  const [firmPickerOpen, setFirmPickerOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [manifestNo, setManifestNo] = useState('');
  const [notes, setNotes] = useState('');
  const [globalCm, setGlobalCm] = useState('');
  const [globalKg, setGlobalKg] = useState('');

  const { firms, isLoading: firmsLoading, categoryMissing, refetch: refetchFirms } = useKartelaFirms();
  useRefetchOnOpen(refetchFirms, firmPickerOpen);
  const firmOptions: PickerOption[] = useMemo(
    () => firms.map((s) => ({ value: s.id, label: s.name, sublabel: s.code ?? undefined })),
    [firms]
  );

  const outstandingQuery = useQuery({
    queryKey: ['kartela', 'outstanding', firmId],
    queryFn: () => kartelaService.outstanding(firmId!),
    enabled: !!firmId,
  });
  const outstanding: KartelaOutstandingItem[] = outstandingQuery.data?.data ?? [];

  const getRow = useCallback((rollId: string, st: Record<string, RowState>) => st[rollId] ?? emptyRow(), []);

  const patchRow = (rollId: string, patch: Partial<RowState>) =>
    setRows((prev) => {
      const cur = prev[rollId] ?? emptyRow();
      const next = { ...cur, ...patch };
      if (patch.count !== undefined) {
        const c = parseInt(patch.count, 10);
        if (Number.isFinite(c)) next.items = resizeItems(next.items, c);
      }
      return { ...prev, [rollId]: next };
    });

  const patchItem = (rollId: string, idx: number, patch: Partial<{ cm: string; kg: string }>) =>
    setRows((prev) => {
      const cur = prev[rollId] ?? emptyRow();
      const items = cur.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      return { ...prev, [rollId]: { ...cur, items } };
    });

  // Toplu: globalCm/globalKg'yi SEÇİLİ tüm topların bulk ölçümüne uygula.
  const applyGlobal = () => {
    setRows((prev) => {
      const next = { ...prev };
      for (const o of outstanding) {
        const cur = next[o.roll.id] ?? emptyRow();
        if (cur.selected) {
          next[o.roll.id] = { ...cur, mode: 'bulk', bulkCm: globalCm, bulkKg: globalKg };
        }
      }
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Toast.show({ type: 'info', text1: 'Ölçüm seçili kartelalara uygulandı' });
  };

  const selectedReturns = useMemo<KartelaReceiveReturn[]>(() => {
    const out: KartelaReceiveReturn[] = [];
    for (const o of outstanding) {
      const r = rows[o.roll.id];
      if (!r?.selected) continue;
      const count = parseInt(r.count, 10);
      if (!Number.isFinite(count) || count <= 0) continue;
      if (r.mode === 'each') {
        out.push({
          rollId: o.roll.id,
          count,
          items: r.items.slice(0, count).map((it) => ({ lengthCm: parseNum(it.cm), weightKg: parseNum(it.kg) })),
        });
      } else {
        out.push({
          rollId: o.roll.id,
          count,
          bulkLengthCm: parseNum(r.bulkCm),
          bulkWeightKg: parseNum(r.bulkKg),
        });
      }
    }
    return out;
  }, [outstanding, rows]);

  const totalKartela = useMemo(() => selectedReturns.reduce((s, r) => s + r.count, 0), [selectedReturns]);

  const receiveMutation = useMutation<KartelaReceiptListItem, Error, void>({
    mutationKey: STATION_MUT.KARTELA_KABUL_RECEIVE,
    mutationFn: async () =>
      (
        await kartelaService.receive({
          subcontractorId: firmId!,
          manifestNo: manifestNo.trim() || null,
          notes: notes.trim() || null,
          returns: selectedReturns,
        })
      ).data,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: 'Kartela kabulü yapıldı',
        text2: `${selectedReturns.length} top → ${totalKartela} kartela`,
      });
      setRows({});
      setManifestNo('');
      setNotes('');
      setGlobalCm('');
      setGlobalKg('');
      qc.invalidateQueries({ queryKey: ['kartela'] });
      outstandingQuery.refetch();
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Kabul başarısız', text2: err.message });
    },
  });

  const canSubmit = !!firmId && selectedReturns.length > 0 && !receiveMutation.isPending;

  return (
    <ScreenChrome title="Kartela Kabul">
      <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Firma */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="labelLarge" style={styles.cardTitle}>
            Kartela Firması
          </Text>
          <TouchableRipple style={styles.firmSelect} onPress={() => setFirmPickerOpen(true)} borderless>
            <View style={styles.firmSelectRow}>
              <Text variant="bodyLarge" style={{ color: firmId ? colors.text : colors.textMuted }}>
                {firmId ? firmName : 'Firma seçin…'}
              </Text>
              <IconButton icon="chevron-down" size={20} />
            </View>
          </TouchableRipple>
        </Surface>

        {/* Toplu ölçüm */}
        {!!firmId && (
          <Surface style={styles.card} elevation={1}>
            <Text variant="labelLarge" style={styles.cardTitle}>
              Toplu Ölçüm (seçili kartelalara uygula)
            </Text>
            <View style={styles.measureRow}>
              <TextInput
                mode="outlined"
                label="Uzunluk (cm)"
                value={globalCm}
                onChangeText={setGlobalCm}
                keyboardType="decimal-pad"
                dense
                style={styles.measureInput}
              />
              <TextInput
                mode="outlined"
                label="Ağırlık (kg)"
                value={globalKg}
                onChangeText={setGlobalKg}
                keyboardType="decimal-pad"
                dense
                style={styles.measureInput}
              />
              <Button mode="contained-tonal" onPress={applyGlobal} compact>
                Uygula
              </Button>
            </View>
          </Surface>
        )}

        {/* Bekleyen toplar */}
        {firmId ? (
          outstandingQuery.isLoading ? (
            <SkeletonList count={3} />
          ) : outstanding.length === 0 ? (
            <Surface style={styles.card} elevation={1}>
              <Text variant="bodyMedium" style={styles.empty}>
                Bu firmada bekleyen kartela topu yok.
              </Text>
            </Surface>
          ) : (
            outstanding.map((o) => {
              const r = getRow(o.roll.id, rows);
              return (
                <Surface key={o.roll.id} style={styles.card} elevation={1}>
                  <TouchableRipple onPress={() => patchRow(o.roll.id, { selected: !r.selected })} borderless>
                    <View style={styles.rollHeader}>
                      <Checkbox status={r.selected ? 'checked' : 'unchecked'} />
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyMedium" style={styles.rollBarcode}>
                          {o.roll.barcode ?? o.roll.id.slice(0, 8)}
                        </Text>
                        <Text variant="bodySmall" style={styles.rollMeta}>
                          {o.roll.item.name}
                          {o.roll.color ? ` · ${o.roll.color.name}` : ''} · {o.dispatch.dispatchNo}
                        </Text>
                      </View>
                    </View>
                  </TouchableRipple>

                  {r.selected && (
                    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                      <Divider />
                      <View style={styles.measureRow}>
                        <TextInput
                          mode="outlined"
                          label="Kartela adedi"
                          value={r.count}
                          onChangeText={(v) => patchRow(o.roll.id, { count: v.replace(/[^0-9]/g, '') })}
                          keyboardType="number-pad"
                          dense
                          style={styles.measureInput}
                        />
                        <SegmentedButtons
                          value={r.mode}
                          onValueChange={(v) => patchRow(o.roll.id, { mode: v as 'bulk' | 'each' })}
                          density="small"
                          buttons={[
                            { value: 'bulk', label: 'Toplu' },
                            { value: 'each', label: 'Tek tek' },
                          ]}
                          style={{ flex: 1 }}
                        />
                      </View>

                      {r.mode === 'bulk' ? (
                        <View style={styles.measureRow}>
                          <TextInput
                            mode="outlined"
                            label="Uzunluk (cm)"
                            value={r.bulkCm}
                            onChangeText={(v) => patchRow(o.roll.id, { bulkCm: v })}
                            keyboardType="decimal-pad"
                            dense
                            style={styles.measureInput}
                          />
                          <TextInput
                            mode="outlined"
                            label="Ağırlık (kg)"
                            value={r.bulkKg}
                            onChangeText={(v) => patchRow(o.roll.id, { bulkKg: v })}
                            keyboardType="decimal-pad"
                            dense
                            style={styles.measureInput}
                          />
                        </View>
                      ) : (
                        <View style={{ gap: spacing.xs }}>
                          {r.items.map((it, idx) => (
                            <View key={idx} style={styles.measureRow}>
                              <Text variant="bodySmall" style={styles.itemIdx}>
                                #{idx + 1}
                              </Text>
                              <TextInput
                                mode="outlined"
                                label="cm"
                                value={it.cm}
                                onChangeText={(v) => patchItem(o.roll.id, idx, { cm: v })}
                                keyboardType="decimal-pad"
                                dense
                                style={styles.measureInput}
                              />
                              <TextInput
                                mode="outlined"
                                label="kg"
                                value={it.kg}
                                onChangeText={(v) => patchItem(o.roll.id, idx, { kg: v })}
                                keyboardType="decimal-pad"
                                dense
                                style={styles.measureInput}
                              />
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </Surface>
              );
            })
          )
        ) : (
          <Surface style={styles.card} elevation={1}>
            <Text variant="bodyMedium" style={styles.empty}>
              Önce bir kartela firması seçin.
            </Text>
          </Surface>
        )}

        {/* Kabul bilgileri */}
        {!!firmId && outstanding.length > 0 && (
          <Surface style={styles.card} elevation={1}>
            <TextInput mode="outlined" label="İrsaliye No (opsiyonel)" value={manifestNo} onChangeText={setManifestNo} dense />
            <TextInput mode="outlined" label="Kabul notu (opsiyonel)" value={notes} onChangeText={setNotes} dense multiline />
          </Surface>
        )}

      </ScrollView>

      {/* Alt bar — FasonKabul deseni (30/40/30): Geçmiş (sol) · Kabul Et (orta,
          vurgulu dolgulu hero) · Bekleyen (sağ). Güvenli alanı doldurup ekran
          dibine uzar. */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom, marginBottom: -insets.bottom }]}>
        <View style={styles.bottomBarRow}>
        <View style={styles.bottomBarCellSide}>
          <TouchableRipple
            onPress={() => nav.navigate('KartelaKabulGecmisi')}
            style={styles.bottomBarBtn}
            rippleColor="rgba(71, 85, 105, 0.12)"
            accessibilityLabel="Kabul geçmişi"
          >
            <View style={styles.bottomBarBtnInner}>
              <Icon source="history" size={24} color="#475569" />
              <Text style={[styles.bottomBarBtnText, { color: '#475569' }]}>Geçmiş</Text>
            </View>
          </TouchableRipple>
        </View>

        <View style={styles.bottomBarCellPrimary}>
          {/* Hero tuş, KartelaSevk'teki "Kamera ile Okut" gibi koşulsuz yeşil.
              Hazır değilken gri yapmak yerine yeşil kalır; basınca eksiği toast
              ile söyler (Bekleyen tuşu deseni). canSubmit içi isPending'i de
              kapsadığından çift submit engellenir. */}
          <TouchableRipple
            onPress={() => {
              if (canSubmit) {
                receiveMutation.mutate();
              } else {
                Toast.show({
                  type: 'info',
                  text1: !firmId
                    ? 'Önce firma seçin'
                    : selectedReturns.length === 0
                      ? 'Kabul edilecek top seçin'
                      : 'Kabul işleniyor…',
                });
              }
            }}
            style={[styles.bottomBarBtn, styles.bottomBarBtnPrimaryFill]}
            rippleColor="rgba(255,255,255,0.25)"
            accessibilityLabel="Kabul et"
          >
            <View style={styles.bottomBarBtnInner}>
              {receiveMutation.isPending ? (
                <ActivityIndicator size={22} color="#fff" />
              ) : (
                <Icon source="package-down" size={28} color="#fff" />
              )}
              <Text style={[styles.bottomBarBtnText, { color: '#fff' }]}>
                {selectedReturns.length > 0
                  ? `Kabul Et (${selectedReturns.length}→${totalKartela})`
                  : 'Kabul Et'}
              </Text>
            </View>
          </TouchableRipple>
        </View>

        <View style={styles.bottomBarCellSide}>
          <TouchableRipple
            onPress={() => {
              void outstandingQuery.refetch();
              Toast.show({
                type: 'info',
                text1: firmId ? `${outstanding.length} bekleyen top` : 'Önce firma seçin',
              });
            }}
            style={styles.bottomBarBtn}
            rippleColor="rgba(217, 119, 6, 0.12)"
            accessibilityLabel="Bekleyen toplar"
          >
            <View style={styles.bottomBarBtnInner}>
              <Icon source="format-list-bulleted" size={24} color="#d97706" />
              <Text style={[styles.bottomBarBtnText, { color: '#d97706' }]}>
                Bekleyen{firmId ? ` (${outstanding.length})` : ''}
              </Text>
            </View>
          </TouchableRipple>
        </View>
        </View>
      </View>
      </View>

      <PickerModal
        visible={firmPickerOpen}
        title="Kartela Firması Seç"
        options={firmOptions}
        selectedValue={firmId ?? undefined}
        loading={firmsLoading}
        emptyText={
          categoryMissing
            ? '"Kartela" fason kategorisi tanımlı değil — admin panelinden ekleyin.'
            : 'Kartela kategorisinde firma yok — admin panelinden firmaya "Kartela" kategorisi atayın.'
        }
        onSelect={(v) => {
          setFirmId(v);
          setFirmName(firmOptions.find((o) => o.value === v)?.label ?? '');
          setRows({});
          setFirmPickerOpen(false);
        }}
        onDismiss={() => setFirmPickerOpen(false)}
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  // Alt bar — FasonKabul deseni (30/40/30, orta dolgulu hero). Tam genişlik bg,
  // içerik tablet için maks-genişlikle ortalanır; güvenli alana uzar.
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
  bottomBarRow: { height: 64, flexDirection: 'row', width: '100%', maxWidth: 520, alignSelf: 'center' },
  bottomBarCellSide: { flex: 3 },
  bottomBarCellPrimary: { flex: 4 },
  bottomBarBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  bottomBarBtnPrimaryFill: { backgroundColor: '#059669' },
  bottomBarBtnInner: { alignItems: 'center', gap: 2 },
  bottomBarBtnText: { fontSize: 12, fontWeight: '700', color: colors.text },
  card: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  cardTitle: { color: colors.textSecondary },
  firmSelect: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: spacing.md,
    paddingVertical: 4,
  },
  firmSelectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { color: colors.textMuted, fontStyle: 'italic', paddingVertical: spacing.sm },
  measureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  measureInput: { flex: 1, backgroundColor: colors.surface },
  rollHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rollBarcode: { fontWeight: '600', color: colors.text },
  rollMeta: { color: colors.textMuted, marginTop: 2 },
  itemIdx: { width: 28, color: colors.textMuted },
});
