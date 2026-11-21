// =============================================================================
// DEVERE DÖNÜŞ KABULÜ (devere ek M1) — devereciden dönen dolu leventleri depoda kabul et
// =============================================================================
// Akış: devereci → irsaliye no → açık sipariş(ler) (tek açık sipariş kendiliğinden seçilir) → her levent için gövde
// QR (tek huni `BarcodeScannerModal`, altta "Numara yaz"; tanımsız gövde yerinde tanımlanır) + metre + tartı →
// önizleme → KABUL ET (panelle aynı belge ucu, hep-ya-hiç). OTURUMSUZ, online-only (kuyruk YOK).
// Yerleşim tablet tasarım dili (Tambur): üst şerit · SOL şu anki iş · SAĞ leventler + sonuç · alt bant eylemler.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenChrome from '../../../components/ScreenChrome';
import HeaderPill from '../../../components/HeaderPill';
import StationActionButton from '../../../components/StationActionButton';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { usePermissions } from '../../../hooks/usePermission';
import { colors, spacing } from '../../../theme';
import { fmtMeters } from '../../../utils/meters';
import type { ReceiveDocResult, RejectLookup } from '../../../services/devereKabul.service';
import WarpBeamLabelPrinter from '../Devere/WarpBeamLabelPrinter';
import { useDevereKabul, type DevereKabulState } from './useDevereKabul';
import { AddBeamCard, HeaderPickers, JobCard, LinesCard, SubChip } from './DevereKabulParts';
import { ManualCodeFooter, ResultCard } from './DevereKabulResult';
import BeamLineSheet from './BeamLineSheet';
import { PreviewSheet } from './ReceiveSheets';
import RejectSheet from './RejectSheet';
import { MAIN_BLUE, SPECIAL_ORANGE } from './devereKabul.styles';

/** Az önce kabul edilen satırdan ret hedefi — okutma turu yok (kimlik zaten elde). */
function resultTarget(b: ReceiveDocResult['orders'][number]['receipt']['beams'][number], o: { id: string; orderNo: string }, sub: { id: string; name: string } | null): RejectLookup {
  return {
    beam: { id: b.id, beamNo: b.beamNo, status: 'READY', physicalBeamNo: b.physicalBeamNo, bodyNo: null, lengthM: b.lengthM },
    order: { id: o.id, orderNo: o.orderNo, subcontractor: { id: sub?.id ?? '', name: sub?.name ?? 'devereci' } },
  };
}

/** Alt bant: Kusurlu levent (turuncu) + KABUL ET (en geniş, mavi). Yenile üst şeritte. */
function BottomBand({ s, canReject, onReject }: { s: DevereKabulState; canReject: boolean; onReject: () => void }) {
  const insets = useSafeAreaInsets();
  const beamCount = s.orders.reduce((n, o) => n + o.beams.length, 0);
  const label = beamCount && s.build.ok ? `KABUL ET — ${beamCount} levent · ${fmtMeters(s.build.totalM)} m` : 'KABUL ET';
  return (
    <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      {!s.isOnline ? <Text style={styles.danger}>{s.offlineReason === 'server' ? 'Sunucuya ulaşılamıyor — kabul yapılamaz (kuyruk yok)' : 'Ağ bağlantısı yok — kabul yapılamaz (kuyruk yok)'}</Text> : null}
      {!s.build.ok && s.build.error ? <Text style={styles.danger}>{s.build.error}</Text> : null}
      <View style={styles.buttons}>
        {canReject ? (
          <View style={styles.reject}>
            <StationActionButton label="Kusurlu levent" icon="truck-fast-outline" onPress={onReject} tint={SPECIAL_ORANGE} loading={s.reject.rejectLooking} loadingLabel="Aranıyor…" disabled={!s.isOnline} large testID="devere-ret-ac" />
          </View>
        ) : null}
        <View style={styles.accept}>
          <StationActionButton label={label} icon="check-decagram" onPress={() => s.previewMut.mutate()} tint={MAIN_BLUE} loading={s.previewMut.isPending} loadingLabel="Önizleniyor…" disabled={!s.build.ok || !s.isOnline || s.busy} large testID="devere-kabul-kabul" />
        </View>
      </View>
    </View>
  );
}

export default function DevereKabulScreen() {
  const compact = useDeviceType() === 'phone';
  useLandscapeLock(!compact);
  const s = useDevereKabul();
  const [picker, setPicker] = useState<null | 'sub' | 'order'>(null);
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [rejectScan, setRejectScan] = useState(false);
  const canReject = usePermissions().has('mobile:devere-ret');
  const bodyMode = s.settings.beamBodyMode;
  const canAdd = !!s.activeOrder && s.isOnline && !s.busy;
  return (
    <ScreenChrome
      title="Devere Dönüş Kabulü"
      subtitle="Devereciden dönen dolu leventleri gövde QR'ı okutarak kabul edin"
      titleRowExtras={<SubChip name={s.subcontractor?.name ?? null} onPress={() => setPicker('sub')} />}
      headerExtras={
        <View style={styles.headerRow}>
          {s.subcontractorId && !compact ? <HeaderPill icon="plus" label="Sipariş ekle" onPress={() => setPicker('order')} testID="devere-kabul-ust-siparis" /> : null}
          <HeaderPill icon="refresh" label="Yenile" onPress={s.refresh} testID="devere-kabul-yenile" />
        </View>
      }
      flushBottom={!compact}
    >
      <View style={styles.root}>
        <View style={[styles.body, compact && styles.stack]}>
          <View style={[styles.left, compact && styles.full]}>
            <JobCard state={s} onPickSub={() => setPicker('sub')} onPickOrder={() => setPicker('order')} />
            <AddBeamCard state={s} code={code} setCode={setCode} canAdd={canAdd} onCamera={() => setCamera(true)} />
            {s.context.isError ? <Text style={styles.danger}>Siparişler yüklenemedi — devere modülü kapalı, yetki yok ya da ağ. Yenileyin.</Text> : null}
          </View>
          <View style={styles.right}>
            <LinesCard state={s} />
            {s.result ? <ResultCard result={s.result} onClose={() => s.setResult(null)} onReject={canReject ? (b, o) => s.reject.openReject(resultTarget(b, o, s.subcontractor)) : undefined} /> : null}
          </View>
        </View>
        <BottomBand s={s} canReject={canReject} onReject={() => setRejectScan(true)} />
      </View>
      <BarcodeScannerModal
        visible={camera}
        listenWhileHidden={canAdd && bodyMode !== 'OFF' && !s.sheet && !s.preview && !s.reject.rejectDraft && !rejectScan}
        title="Leventin gövde QR'ını okutun"
        trigger="auto"
        onDismiss={() => setCamera(false)}
        onScan={(c) => { setCamera(false); void s.scanBody(c); }}
        footer={<ManualCodeFooter placeholder="Gövde no (ör. LG-00012)" onSubmit={(c) => { setCamera(false); void s.scanBody(c); }} testID="devere-kabul-numara" />}
      />
      <HeaderPickers state={s} picker={picker} onClose={() => setPicker(null)} />
      {s.sheet ? <BeamLineSheet value={s.sheet} weighing={s.settings.receiveWeighing} subcontractorName={s.subcontractor?.name ?? 'devereci'} reworkCandidates={s.reworkFor(s.sheet)} onSave={s.saveLine} onRemove={s.removeLine} onDismiss={() => s.setSheet(null)} /> : null}
      {s.preview ? <PreviewSheet preview={s.preview} sent={s.build.ok ? s.build.body : null} duplicateMode={s.settings.duplicateDeliveryNote} pending={s.accept.isPending} isOnline={s.isOnline} onAccept={() => s.accept.mutate()} onBack={() => s.setPreview(null)} /> : null}
      <BarcodeScannerModal
        visible={rejectScan}
        title="Kusurlu leventin etiketini ya da gövde QR'ını okutun"
        trigger="auto"
        onDismiss={() => setRejectScan(false)}
        onScan={(c) => { setRejectScan(false); void s.reject.rejectLookup(c); }}
        footer={<ManualCodeFooter placeholder="Levent ya da gövde no" onSubmit={(c) => { setRejectScan(false); void s.reject.rejectLookup(c); }} testID="devere-ret-numara" />}
      />
      {s.reject.rejectDraft ? <RejectSheet state={s.reject} draft={s.reject.rejectDraft} isOnline={s.isOnline} photoRequiredHint={s.settings.rejectPhotoRequired} /> : null}
      <WarpBeamLabelPrinter />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  body: { flex: 1, flexDirection: 'row', padding: spacing.md, gap: spacing.md },
  stack: { flexDirection: 'column' },
  left: { flex: 1.1, gap: spacing.md },
  full: { flex: 0 },
  right: { flex: 1, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  bottomBar: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttons: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  reject: { width: 280 },
  accept: { flex: 1 },
  danger: { color: colors.dangerText, textAlign: 'center' },
});
