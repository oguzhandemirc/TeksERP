// =============================================================================
// DEVERE DÖNÜŞ KABULÜ (devere ek M1) — devereciden dönen dolu leventleri depoda kabul et
// =============================================================================
// Akış: devereci → irsaliye no → açık sipariş(ler) → her levent için gövde QR (tek huni
// `BarcodeScannerModal`; tanımsız gövde yerinde tanımlanır) + metre + tartı (ayara göre) →
// önizleme → KABUL ET (panelle aynı belge ucu, hep-ya-hiç). OTURUMSUZ, online-only (kuyruk YOK).
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenChrome from '../../../components/ScreenChrome';
import PickerModal from '../../../components/PickerModal';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import StationActionButton from '../../../components/StationActionButton';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { colors, moduleAccents, spacing, typography } from '../../../theme';
import { fmtMeters } from '../../../utils/meters';
import WarpBeamLabelPrinter from '../Devere/WarpBeamLabelPrinter';
import { useDevereKabul } from './useDevereKabul';
import { HeaderFields, LinesList, OrderCard } from './DevereKabulParts';
import BeamLineSheet from './BeamLineSheet';
import { PreviewSheet, ResultSheet } from './ReceiveSheets';

export default function DevereKabulScreen() {
  const compact = useDeviceType() === 'phone';
  useLandscapeLock(!compact);
  const insets = useSafeAreaInsets();
  const s = useDevereKabul();
  const [picker, setPicker] = useState<null | 'sub' | 'order'>(null);
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const bodyMode = s.settings.beamBodyMode;
  const canAdd = !!s.activeOrder && s.isOnline && !s.busy;
  const beamCount = s.orders.reduce((n, o) => n + o.beams.length, 0);
  const totalM = s.build.ok ? s.build.totalM : 0;
  const pickedIds = new Set(s.orders.map((o) => o.orderId));
  return (
    <ScreenChrome title="Devere Dönüş Kabulü" subtitle="Devereciden dönen dolu leventleri gövde QR'ı okutarak kabul edin" statusLine={s.subcontractor ? `${s.subcontractor.openOrderCount} açık sipariş` : undefined}>
      <View style={styles.root}>
        <View style={styles.body}>
          <HeaderFields state={s} onPickSub={() => setPicker('sub')} onPickOrder={() => setPicker('order')} />
          <OrderCard state={s} />
          <View style={[styles.split, compact && styles.stack]}>
            <View style={[styles.scanCol, compact && styles.full]}>
              {bodyMode !== 'OFF' ? (
                <ScannerEntryBar value={code} onChangeText={setCode} placeholder="Gövde QR / no okut-yaz…" onResolve={() => { void s.scanBody(code); setCode(''); }} resolving={s.resolving} onScan={canAdd ? () => setCamera(true) : undefined} scanCtaLabel="GÖVDE QR OKUT" tone="indigo" hardwareListening />
              ) : null}
              {bodyMode !== 'REQUIRED' ? (
                <Button mode={bodyMode === 'OFF' ? 'contained' : 'outlined'} icon="plus" onPress={() => s.openNewLine(null)} disabled={!canAdd} contentStyle={styles.tall} testID="devere-kabul-govdesiz">
                  {bodyMode === 'OFF' ? 'LEVENT EKLE' : 'Gövdesiz levent ekle'}
                </Button>
              ) : null}
            </View>
            <View style={styles.listCol}>
              <LinesList state={s} />
            </View>
          </View>
          {s.context.isError ? <Text style={styles.danger}>Siparişler yüklenemedi — devere modülü kapalı, yetki yok ya da ağ. Yenileyin.</Text> : null}
        </View>
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]}>
          {!s.isOnline ? <Text style={styles.danger}>{s.offlineReason === 'server' ? 'Sunucuya ulaşılamıyor — kabul yapılamaz (kuyruk yok)' : 'Ağ bağlantısı yok — kabul yapılamaz (kuyruk yok)'}</Text> : null}
          {!s.build.ok && s.build.error ? <Text style={styles.danger}>{s.build.error}</Text> : null}
          <View style={styles.buttons}>
            <Button mode="outlined" icon="refresh" onPress={s.refresh} contentStyle={styles.tall}>Yenile</Button>
            <Text style={styles.total}>{beamCount ? `${beamCount} levent · ${fmtMeters(totalM)} m` : ''}</Text>
            <View style={styles.accept}>
              <StationActionButton label="KABUL ET" icon="check-decagram" onPress={() => s.previewMut.mutate()} tint={moduleAccents.DevereKabul.tint} loading={s.previewMut.isPending} loadingLabel="Önizleniyor…" disabled={!s.build.ok || !s.isOnline || s.busy} large testID="devere-kabul-kabul" />
            </View>
          </View>
        </View>
      </View>
      <BarcodeScannerModal visible={camera} listenWhileHidden={canAdd && bodyMode !== 'OFF' && !s.sheet && !s.preview} title="Leventin gövde QR'ını okutun" trigger="auto" onDismiss={() => setCamera(false)} onScan={(c) => { setCamera(false); void s.scanBody(c); }} />
      <PickerModal
        visible={picker === 'sub'}
        title="Devereci"
        options={s.subcontractors.map((x) => ({ value: x.id, label: x.name, sublabel: `${x.openOrderCount} açık sipariş` }))}
        selectedValue={s.subcontractorId ?? ''}
        loading={s.context.isLoading}
        emptyText="Açık fason devere siparişi olan devereci yok — sipariş panelden açılır (Üretim › Devere / Çözgü)."
        onDismiss={() => setPicker(null)}
        onSelect={(id) => { s.selectSubcontractor(id); setPicker(null); }}
      />
      <PickerModal
        visible={picker === 'order'}
        title="Açık sipariş"
        options={s.ctxOrders.filter((o) => !pickedIds.has(o.id)).map((o) => ({
          value: o.id,
          label: `${o.orderNo} — ${o.warpSpec.name}`,
          sublabel: o.remainingBeamCount === null ? `kalan ${fmtMeters(Number(o.remainingM))} m` : `${o.remainingBeamCount} levent bekleniyor · kalan ${fmtMeters(Number(o.remainingM))} m`,
        }))}
        selectedValue=""
        loading={s.context.isFetching}
        emptyText="Bu deverecinin kabul bekleyen başka açık siparişi yok."
        onDismiss={() => setPicker(null)}
        onSelect={(id) => { s.addOrder(id); setPicker(null); }}
      />
      {s.sheet ? <BeamLineSheet value={s.sheet} weighing={s.settings.receiveWeighing} subcontractorName={s.subcontractor?.name ?? 'devereci'} onSave={s.saveLine} onRemove={s.removeLine} onDismiss={() => s.setSheet(null)} /> : null}
      {s.preview ? <PreviewSheet preview={s.preview} sent={s.build.ok ? s.build.body : null} duplicateMode={s.settings.duplicateDeliveryNote} pending={s.accept.isPending} isOnline={s.isOnline} onAccept={() => s.accept.mutate()} onBack={() => s.setPreview(null)} /> : null}
      {s.result ? <ResultSheet result={s.result} onClose={() => s.setResult(null)} /> : null}
      <WarpBeamLabelPrinter />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  body: { flex: 1, padding: spacing.md, gap: spacing.md },
  split: { flex: 1, flexDirection: 'row', gap: spacing.md },
  stack: { flexDirection: 'column' },
  scanCol: { width: 360, gap: spacing.sm },
  full: { width: '100%' },
  listCol: { flex: 1 },
  bottomBar: { padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttons: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  total: { flex: 1, fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text, textAlign: 'right' },
  accept: { minWidth: 280 },
  tall: { height: 56 },
  danger: { color: colors.dangerText, textAlign: 'center' },
});
