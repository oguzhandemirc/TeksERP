import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TextInput, IconButton, Surface, TouchableRipple, Chip, Icon, ActivityIndicator, Button } from 'react-native-paper';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import ScreenChrome from '../../../components/ScreenChrome';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import PickerModal, { PickerOption } from '../../../components/PickerModal';
import RollPickerModal from '../../../components/RollPickerModal';
import { rollService } from '../../../services/roll.service';
import { useKartelaFirms } from '../../../hooks/useKartelaFirms';
import { useRefetchOnOpen } from '../../../hooks/useRefetchOnOpen';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { kartelaService, type KartelaDispatchListItem } from '../../../services/kartela.service';
import { STATION_MUT } from '../../../offline/mutations';
import { colors, spacing, radius } from '../../../theme';
import type { Roll } from '../../../types/models';
import type { MainStackParamList } from '../../../navigation/types';

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
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const insets = useSafeAreaInsets();
  const manualMode = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  // Sürekli tarama: aynı barkodu kamera karede tutarken tekrar tekrar eklemeyi
  // önlemek için kısa cooldown (barkod + zaman).
  const lastScanRef = useRef<{ code: string; t: number }>({ code: '', t: 0 });
  const [firmId, setFirmId] = useState<string | null>(null);
  const [firmName, setFirmName] = useState<string>('');
  const [firmPickerOpen, setFirmPickerOpen] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [rollPickerOpen, setRollPickerOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [rolls, setRolls] = useState<ScannedRoll[]>([]);
  const [plateNumber, setPlateNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');
  const [extrasOpen, setExtrasOpen] = useState(false);

  const { firms, isLoading: firmsLoading, categoryMissing, refetch: refetchFirms } = useKartelaFirms();
  // Picker her açıldığında firmaları taze çek — admin'deki kategori/atama
  // değişikliği staleTime beklenmeden yansır.
  useRefetchOnOpen(refetchFirms, firmPickerOpen);

  const firmOptions: PickerOption[] = useMemo(
    () =>
      firms.map((s) => ({
        value: s.id,
        label: s.name,
        sublabel: s.code ?? undefined,
      })),
    [firms]
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
        // Çuvala/sevkiyata rezerve top serbest stok DEĞİL — kartelaya alınamaz
        // (backend zaten reddeder; burada operatöre net sebep gösteririz).
        if (roll.shipmentId) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Toast.show({
            type: 'error',
            text1: 'Top çuvalda — kullanılamaz',
            text2: roll.shipment
              ? `${roll.shipment.shipmentNo} sevkiyatına bağlı (çuval depo/kapı önü).`
              : 'Bu top bir sevkiyatın çuvalında, serbest depoda değil.',
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

  // Listeden seçim — picker zaten WAREHOUSE + serbest filtreliyor ve tam roll
  // verisini veriyor; getByBarcode'a gerek yok, doğrudan ekle (dedup korunur).
  const addRollFromList = useCallback(
    (roll: Roll & { markedForKartela?: boolean }) => {
      if (rolls.some((r) => r.id === roll.id)) {
        Toast.show({ type: 'info', text1: 'Bu top zaten eklendi' });
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
    },
    [rolls],
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
    <ScreenChrome title="Kartela Sevk">
      <View style={styles.flex}>
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

        {/* Toplar — kamera alt bardaki "OKUT" ile; manuel mod açıksa burada giriş alanı */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="labelLarge" style={styles.cardTitle}>
            Toplar ({rolls.length}) · {total.toFixed(1)} m
          </Text>
          <Button
            mode="contained-tonal"
            icon="format-list-bulleted"
            onPress={() => setRollPickerOpen(true)}
            style={styles.listBtn}
          >
            Listeden Seç
          </Button>
          {manualMode && (
            <View style={styles.manualRow}>
              <TextInput
                mode="outlined"
                dense
                style={{ flex: 1, backgroundColor: colors.surface }}
                placeholder="Top barkodu gir…"
                value={barcode}
                onChangeText={setBarcode}
                onSubmitEditing={() => addRoll(barcode)}
                returnKeyType="done"
                autoCapitalize="characters"
                left={<TextInput.Icon icon="barcode" />}
              />
              <IconButton
                icon="plus"
                mode="contained"
                onPress={() => addRoll(barcode)}
                disabled={!barcode.trim() || resolving}
              />
            </View>
          )}
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

      </ScrollView>

      {/* Alt bar — FasonKabul deseni (30/40/30): Geçmiş (sol) · OKUT (orta,
          vurgulu dolgulu hero) · Gönder (sağ). Güvenli alanı doldurup ekran
          dibine uzar (paddingBottom inset + negatif margin ScreenChrome
          content paddingBottom'unu iptal eder). */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom, marginBottom: -insets.bottom }]}>
        <View style={styles.barContent}>
          <View style={styles.barCellSide}>
            <TouchableRipple
              onPress={() => nav.navigate('KartelaSevkGecmisi')}
              style={styles.barBtn}
              rippleColor="rgba(71, 85, 105, 0.12)"
              accessibilityLabel="Sevk geçmişi"
            >
              <View style={styles.barBtnInner}>
                <Icon source="history" size={24} color="#475569" />
                <Text style={[styles.barBtnText, { color: '#475569' }]}>Geçmiş</Text>
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
              onPress={() => canDispatch && dispatchMutation.mutate()}
              disabled={!canDispatch}
              style={styles.barBtn}
              rippleColor="rgba(217, 119, 6, 0.12)"
              accessibilityLabel="Kartelaya gönder"
            >
              <View style={styles.barBtnInner}>
                {dispatchMutation.isPending ? (
                  <ActivityIndicator size={20} color="#d97706" />
                ) : (
                  <Icon source="truck-fast" size={24} color={canDispatch ? '#d97706' : colors.textMuted} />
                )}
                <Text style={[styles.barBtnText, { color: canDispatch ? '#d97706' : colors.textMuted }]}>
                  Gönder{rolls.length ? ` (${rolls.length})` : ''}
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
          setFirmPickerOpen(false);
        }}
        onDismiss={() => setFirmPickerOpen(false)}
      />

      <BarcodeScannerModal
        visible={scannerOpen}
        title="Top Barkodu Okut — arka arkaya okutabilirsin"
        continuous
        onDismiss={() => setScannerOpen(false)}
        onScan={(code) => {
          // Sürekli mod: aynı barkodu 2 sn içinde tekrar ekleme.
          const now = Date.now();
          if (lastScanRef.current.code === code && now - lastScanRef.current.t < 2000) return;
          lastScanRef.current = { code, t: now };
          void addRoll(code);
        }}
      />

      <RollPickerModal
        visible={rollPickerOpen}
        onDismiss={() => setRollPickerOpen(false)}
        onSelect={addRollFromList}
        filters={{ status: 'WAREHOUSE', shipmentScope: 'free' }}
        title="Kartelalık Top Seç"
        subtitle="Depodaki bitmiş toplar · seçince listeye eklenir"
        excludeIds={rolls.map((r) => r.id)}
        emptyText="Depoda uygun top yok"
        accent="#d97706"
      />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },
  card: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  cardTitle: { color: colors.textSecondary },
  listBtn: { alignSelf: 'flex-start', borderRadius: radius.md, marginTop: spacing.xs },
  firmSelect: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: spacing.md,
    paddingVertical: 4,
  },
  firmSelectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
  // Alt bar — FasonKabul deseni (30/40/30, orta dolgulu hero). Tam genişlik bg,
  // içerik tablet için maks-genişlikle ortalanır.
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
  barCellSide: { flex: 3 },
  barCellPrimary: { flex: 4 },
  barBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  barBtnPrimaryFill: { backgroundColor: '#059669' },
  barBtnInner: { alignItems: 'center', gap: 2 },
  barBtnText: { fontSize: 12, fontWeight: '700', color: colors.text },
});
