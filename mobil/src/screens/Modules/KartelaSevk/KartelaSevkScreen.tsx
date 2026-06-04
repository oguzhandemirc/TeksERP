import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TextInput, Button, IconButton, Surface, TouchableRipple, Chip } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import { rollService } from '../../../services/roll.service';
import { subcontractorService } from '../../../services/subcontractor.service';
import { kartelaService, type KartelaDispatchListItem } from '../../../services/kartela.service';
import { STATION_MUT } from '../../../offline/mutations';
import { colors, spacing, radius } from '../../../theme';
import type { Roll } from '../../../types/models';

interface ScannedRoll {
  id: string;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  currentQty: number;
  markedForKartela: boolean;
}

export default function KartelaSevkScreen() {
  const qc = useQueryClient();
  const [firmId, setFirmId] = useState<string | null>(null);
  const [firmName, setFirmName] = useState<string>('');
  const [firmPickerOpen, setFirmPickerOpen] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [rolls, setRolls] = useState<ScannedRoll[]>([]);
  const [plateNumber, setPlateNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');
  const [extrasOpen, setExtrasOpen] = useState(false);

  const firmsQuery = useQuery({
    queryKey: ['subcontractors', 'picker'],
    queryFn: () => subcontractorService.listSubcontractors({ pageSize: 200 }),
  });

  const firmOptions: PickerOption[] = useMemo(
    () =>
      (firmsQuery.data?.data ?? []).map((s) => ({
        value: s.id,
        label: s.name,
        sublabel: s.code ?? undefined,
      })),
    [firmsQuery.data]
  );

  const total = useMemo(() => rolls.reduce((s, r) => s + r.currentQty, 0), [rolls]);

  const addRoll = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      if (rolls.some((r) => r.barcode === trimmed)) {
        Toast.show({ type: 'info', text1: 'Bu top zaten eklendi' });
        setBarcode('');
        return;
      }
      setResolving(true);
      try {
        const res = await rollService.getByBarcode(trimmed);
        const roll = res.data as Roll & { markedForKartela?: boolean };
        if (roll.status !== 'WAREHOUSE') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Toast.show({
            type: 'error',
            text1: 'Top kartelaya gönderilemez',
            text2: `Durum: ${roll.status}. Sadece depodaki bitmiş toplar.`,
          });
          return;
        }
        setRolls((prev) => [
          ...prev,
          {
            id: roll.id,
            barcode: roll.barcode,
            itemName: roll.item?.name ?? '—',
            colorName: roll.color?.name ?? null,
            currentQty: Number(roll.currentQty),
            markedForKartela: Boolean(roll.markedForKartela),
          },
        ]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setBarcode('');
      } catch (err) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: 'error', text1: 'Top bulunamadı', text2: (err as Error).message });
      } finally {
        setResolving(false);
      }
    },
    [rolls]
  );

  const removeRoll = (id: string) => setRolls((prev) => prev.filter((r) => r.id !== id));

  const dispatchMutation = useMutation<KartelaDispatchListItem, Error, void>({
    mutationKey: STATION_MUT.KARTELA_SEVK_DISPATCH,
    mutationFn: async () =>
      (
        await kartelaService.dispatch({
          subcontractorId: firmId!,
          rollIds: rolls.map((r) => r.id),
          plateNumber: plateNumber.trim() || null,
          driverName: driverName.trim() || null,
          notes: notes.trim() || null,
        })
      ).data,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Kartela sevki oluşturuldu', text2: `${rolls.length} top gönderildi` });
      setRolls([]);
      setPlateNumber('');
      setDriverName('');
      setNotes('');
      qc.invalidateQueries({ queryKey: ['kartela'] });
    },
    onError: (err) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Sevk başarısız', text2: err.message });
    },
  });

  const canDispatch = !!firmId && rolls.length > 0 && !dispatchMutation.isPending;

  return (
    <ScreenChrome title="Kartela Sevk" subtitle="Bitmiş topu kartela firmasına gönder">
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Firma seçimi */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="labelLarge" style={styles.cardTitle}>
            Kartela Firması
          </Text>
          <TouchableRipple
            style={styles.firmSelect}
            onPress={() => setFirmPickerOpen(true)}
            borderless
          >
            <View style={styles.firmSelectRow}>
              <Text variant="bodyLarge" style={{ color: firmId ? colors.text : colors.textMuted }}>
                {firmId ? firmName : 'Firma seçin…'}
              </Text>
              <IconButton icon="chevron-down" size={20} />
            </View>
          </TouchableRipple>
        </Surface>

        {/* Top okut */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="labelLarge" style={styles.cardTitle}>
            Toplar ({rolls.length}) · {total.toFixed(1)} m
          </Text>
          <ScannerEntryBar
            value={barcode}
            onChangeText={setBarcode}
            onResolve={() => addRoll(barcode)}
            onScan={() => setScannerOpen(true)}
            resolving={resolving}
            tone="indigo"
            placeholder="Top barkodu gir veya okut…"
          />
          <View style={{ marginTop: spacing.sm }}>
            {rolls.length === 0 ? (
              <Text variant="bodySmall" style={styles.empty}>
                Henüz top eklenmedi.
              </Text>
            ) : (
              rolls.map((r) => (
                <Surface key={r.id} style={styles.rollRow} elevation={0}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rollTop}>
                      <Text variant="bodyMedium" style={styles.rollBarcode}>
                        {r.barcode ?? r.id.slice(0, 8)}
                      </Text>
                      {r.markedForKartela && (
                        <Chip compact style={styles.markChip} textStyle={styles.markChipText}>
                          kartelalık
                        </Chip>
                      )}
                    </View>
                    <Text variant="bodySmall" style={styles.rollMeta}>
                      {r.itemName}
                      {r.colorName ? ` · ${r.colorName}` : ''} · {r.currentQty.toFixed(1)} m
                    </Text>
                  </View>
                  <IconButton icon="close" size={18} onPress={() => removeRoll(r.id)} />
                </Surface>
              ))
            )}
          </View>
        </Surface>

        {/* Sevk bilgileri (opsiyonel) */}
        <Surface style={styles.card} elevation={1}>
          <TouchableRipple onPress={() => setExtrasOpen((v) => !v)} borderless>
            <View style={styles.firmSelectRow}>
              <Text variant="labelLarge" style={styles.cardTitle}>
                Sevk Bilgileri (opsiyonel)
              </Text>
              <IconButton icon={extrasOpen ? 'chevron-up' : 'chevron-down'} size={20} />
            </View>
          </TouchableRipple>
          {extrasOpen && (
            <View style={{ gap: spacing.sm }}>
              <TextInput mode="outlined" label="Plaka" value={plateNumber} onChangeText={setPlateNumber} dense />
              <TextInput mode="outlined" label="Sürücü" value={driverName} onChangeText={setDriverName} dense />
              <TextInput mode="outlined" label="Not" value={notes} onChangeText={setNotes} dense multiline />
            </View>
          )}
        </Surface>

        <Button
          mode="contained"
          icon="truck-fast"
          onPress={() => dispatchMutation.mutate()}
          disabled={!canDispatch}
          loading={dispatchMutation.isPending}
          style={styles.submit}
          contentStyle={styles.submitContent}
        >
          Kartelaya Gönder ({rolls.length} top)
        </Button>
      </ScrollView>

      <PickerModal
        visible={firmPickerOpen}
        title="Kartela Firması Seç"
        options={firmOptions}
        selectedValue={firmId ?? undefined}
        loading={firmsQuery.isLoading}
        onSelect={(v) => {
          setFirmId(v);
          setFirmName(firmOptions.find((o) => o.value === v)?.label ?? '');
          setFirmPickerOpen(false);
        }}
        onDismiss={() => setFirmPickerOpen(false)}
      />

      <BarcodeScannerModal
        visible={scannerOpen}
        title="Top Barkodu Okut"
        onDismiss={() => setScannerOpen(false)}
        onScan={(code) => {
          setScannerOpen(false);
          addRoll(code);
        }}
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },
  card: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  cardTitle: { color: colors.textSecondary },
  firmSelect: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  firmSelectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { color: colors.textMuted, fontStyle: 'italic', paddingVertical: spacing.sm },
  rollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.appBg,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    marginBottom: spacing.xs,
  },
  rollTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rollBarcode: { fontWeight: '600', color: colors.text },
  rollMeta: { color: colors.textMuted, marginTop: 2 },
  markChip: { backgroundColor: '#f3e8ff', height: 22 },
  markChipText: { fontSize: 11, color: '#9333ea', marginVertical: 0 },
  submit: { borderRadius: radius.lg },
  submitContent: { height: 52 },
});
