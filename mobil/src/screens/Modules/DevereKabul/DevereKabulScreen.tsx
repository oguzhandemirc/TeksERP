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
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import StationActionButton from '../../../components/StationActionButton';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { usePermissions } from '../../../hooks/usePermission';
import { colors, moduleAccents, palette, spacing, typography } from '../../../theme';
import { fmtMeters } from '../../../utils/meters';
import type { ReceiveDocResult, RejectLookup } from '../../../services/devereKabul.service';
import WarpBeamLabelPrinter from '../Devere/WarpBeamLabelPrinter';
import { useDevereKabul } from './useDevereKabul';
import { HeaderFields, HeaderPickers, LinesList, OrderCard } from './DevereKabulParts';
import BeamLineSheet from './BeamLineSheet';
import { PreviewSheet, ResultSheet } from './ReceiveSheets';
import RejectSheet from './RejectSheet';

/** Az önce kabul edilen satırdan ret hedefi — okutma turu yok (kimlik zaten elde). */
function resultTarget(b: ReceiveDocResult['orders'][number]['receipt']['beams'][number], o: { id: string; orderNo: string }, sub: { id: string; name: string } | null): RejectLookup {
  return {
    beam: { id: b.id, beamNo: b.beamNo, status: 'READY', physicalBeamNo: b.physicalBeamNo, bodyNo: null, lengthM: b.lengthM },
    order: { id: o.id, orderNo: o.orderNo, subcontractor: { id: sub?.id ?? '', name: sub?.name ?? 'devereci' } },
  };
}

export default function DevereKabulScreen() {
  const compact = useDeviceType() === 'phone';
  useLandscapeLock(!compact);
  const insets = useSafeAreaInsets();
  const s = useDevereKabul();
  const [picker, setPicker] = useState<null | 'sub' | 'order'>(null);
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [rejectScan, setRejectScan] = useState(false);
  const canReject = usePermissions().has('mobile:devere-ret');
  const bodyMode = s.settings.beamBodyMode;
  const canAdd = !!s.activeOrder && s.isOnline && !s.busy;
  const beamCount = s.orders.reduce((n, o) => n + o.beams.length, 0);
  const totalM = s.build.ok ? s.build.totalM : 0;
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
            {canReject ? (
              <Button mode="outlined" icon="truck-fast-outline" textColor={palette.orange[800]} onPress={() => setRejectScan(true)} disabled={!s.isOnline || s.reject.rejectLooking} loading={s.reject.rejectLooking} contentStyle={styles.tall} testID="devere-ret-ac">
                Kusurlu levent
              </Button>
            ) : null}
            <Text style={styles.total}>{beamCount ? `${beamCount} levent · ${fmtMeters(totalM)} m` : ''}</Text>
            <View style={styles.accept}>
              <StationActionButton label="KABUL ET" icon="check-decagram" onPress={() => s.previewMut.mutate()} tint={moduleAccents.DevereKabul.tint} loading={s.previewMut.isPending} loadingLabel="Önizleniyor…" disabled={!s.build.ok || !s.isOnline || s.busy} large testID="devere-kabul-kabul" />
            </View>
          </View>
        </View>
      </View>
      <BarcodeScannerModal visible={camera} listenWhileHidden={canAdd && bodyMode !== 'OFF' && !s.sheet && !s.preview && !s.reject.rejectDraft && !rejectScan} title="Leventin gövde QR'ını okutun" trigger="auto" onDismiss={() => setCamera(false)} onScan={(c) => { setCamera(false); void s.scanBody(c); }} />
      <HeaderPickers state={s} picker={picker} onClose={() => setPicker(null)} />
      {s.sheet ? <BeamLineSheet value={s.sheet} weighing={s.settings.receiveWeighing} subcontractorName={s.subcontractor?.name ?? 'devereci'} reworkCandidates={s.reworkFor(s.sheet)} onSave={s.saveLine} onRemove={s.removeLine} onDismiss={() => s.setSheet(null)} /> : null}
      {s.preview ? <PreviewSheet preview={s.preview} duplicateMode={s.settings.duplicateDeliveryNote} pending={s.accept.isPending} isOnline={s.isOnline} onAccept={() => s.accept.mutate()} onBack={() => s.setPreview(null)} /> : null}
      {s.result ? <ResultSheet result={s.result} onClose={() => s.setResult(null)} onReject={canReject ? (b, o) => s.reject.openReject(resultTarget(b, o, s.subcontractor)) : undefined} /> : null}
      <BarcodeScannerModal visible={rejectScan} title="Kusurlu leventin etiketini ya da gövde QR'ını okutun" trigger="auto" onDismiss={() => setRejectScan(false)} onScan={(c) => { setRejectScan(false); void s.reject.rejectLookup(c); }} />
      {s.reject.rejectDraft ? <RejectSheet state={s.reject} draft={s.reject.rejectDraft} isOnline={s.isOnline} photoRequiredHint={s.settings.rejectPhotoRequired} /> : null}
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
