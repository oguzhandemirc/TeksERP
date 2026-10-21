// =============================================================================
// KK1 — TEZGAH ETİKETİ BANDI (S3a): okut · bağlam şeridi · levent/hat çipleri · iş seç
// =============================================================================
// Yalnız `isLoomBirthVisible` doğruysa mount edilir (KK1Screen karar verir): tablette sağ
// sütunun üstü, telefonda sol form. Çok top okutan yüzey → kamera `trigger="tap"` (komşu
// tezgahın etiketi kadraja girip kendiliğinden okunmasın). "Açık iş yok" MODAL (tek buton).
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import PickerModal from '../../../components/PickerModal';
import TruncatedText from '../../../components/TruncatedText';
import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import type { DokumaRollBirth } from '../../../services/featureFlag.service';
import { colors, radius, spacing, typography } from '../../../theme';
import { beamQuestion, contextLine, orderPickAllowed } from './loomBirth';
import type { LoomBirthApi } from './useLoomBirth';

const ORDER_STATUS_LABEL: Record<string, string> = { IN_PROGRESS: 'Çalışıyor', PLANNED: 'Planlı' };

function Chip({ on, label, onPress, testID }: { on: boolean; label: string; onPress: () => void; testID?: string }) {
  return (
    <TouchableRipple onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }} testID={testID}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableRipple>
  );
}

interface Props {
  loom: LoomBirthApi;
  rollBirth: DokumaRollBirth;
  onBeforeOpen?: () => void;
}

/** Hat (çok hatlı tezgah) · levent değişimi (eski/yeni) · "Aynı tezgah" çipleri. */
function LoomChips({ loom }: { loom: LoomBirthApi }) {
  const s = loom.state;
  const q = s.beamChipsDismissed ? null : beamQuestion(s.context);
  const lines = s.context && s.context.machine.productionLineCount > 1 ? s.context.machine.productionLineCount : 0;
  return (
    <>
      {lines > 0 ? (
        <View style={styles.row}>
          {Array.from({ length: lines }, (_, i) => i + 1).map((n) => (
            <Chip key={n} on={(s.lineNo ?? 1) === n} label={`Hat ${n}`} onPress={() => loom.setLine(n)} />
          ))}
        </View>
      ) : null}
      {q ? (
        <View style={styles.row}>
          <Text style={styles.label}>Levent değişti:</Text>
          <Chip on={s.beamChoice === 'old'} label={`Eski levent ${q.old.beamNo}`} onPress={() => loom.chooseBeam('old')} testID="beam-old" />
          <Chip on={s.beamChoice === 'new'} label={`Yeni levent${q.newBeamNo ? ` ${q.newBeamNo}` : ''}`} onPress={() => loom.chooseBeam('new')} testID="beam-new" />
        </View>
      ) : null}
      {!s.machineCode && !s.order && s.lastMachineCode ? (
        <View style={styles.row}>
          <Chip on={false} label={`Aynı tezgah: ${s.lastMachineCode}`} onPress={loom.sameLoom} testID="same-loom" />
        </View>
      ) : null}
    </>
  );
}

/** Kamera (çok top → `trigger="tap"`) · çalışan iş seçici (A yolu) · "açık iş yok" modalı. */
function LoomOverlays({ loom, camera, setCamera }: { loom: LoomBirthApi; camera: boolean; setCamera: (v: boolean) => void }) {
  return (
    <>
      <BarcodeScannerModal
        visible={camera}
        title="Tezgah etiketini okut"
        trigger="tap"
        onDismiss={() => setCamera(false)}
        onScan={(code) => {
          setCamera(false);
          void loom.scan(code);
        }}
      />
      <PickerModal
        visible={loom.ordersOpen}
        title="Çalışan iş seç"
        options={loom.orders.map((o) => ({
          value: o.id,
          label: o.weavingOrderNumber,
          sublabel: [o.item?.name, o.color?.name, ORDER_STATUS_LABEL[o.status]].filter(Boolean).join(' · '),
        }))}
        selectedValue={loom.state.order?.id ?? ''}
        loading={loom.ordersLoading}
        emptyText={loom.ordersError ? 'Liste yüklenemedi — bu bir "iş yok" cevabı DEĞİLDİR.' : 'Açık dokuma işi yok.'}
        onRefresh={loom.refetchOrders}
        refreshError={loom.ordersError}
        onSelect={(id) => {
          const o = loom.orders.find((x) => x.id === id);
          if (o) loom.pickOrder(o);
        }}
        onDismiss={() => loom.setOrdersOpen(false)}
      />
      <ModuleSheet
        visible={loom.failureModal !== null}
        onDismiss={loom.dismissFailure}
        dismissable={false}
        size="sm"
        title={loom.failureModal?.title ?? ''}
        footer={<Button mode="contained" onPress={loom.dismissFailure} testID="loom-failure-ok">Tamam</Button>}
      >
        <Text style={sheet.body_}>{loom.failureModal?.hint}</Text>
        {loom.failureModal?.message ? <Text style={sheet.hint}>{loom.failureModal.message}</Text> : null}
      </ModuleSheet>
    </>
  );
}

export default function LoomBirthBar({ loom, rollBirth, onBeforeOpen }: Props) {
  const [camera, setCamera] = useState(false);
  const line = contextLine(loom.state);
  const canPickOrder = orderPickAllowed(rollBirth);
  return (
    <View style={styles.root} testID="loom-birth-bar">
      <ScannerEntryBar
        value={loom.scanValue}
        onChangeText={loom.setScanValue}
        placeholder="Tezgah etiketi okut/yaz…"
        onResolve={() => void loom.scan(loom.scanValue)}
        onScan={() => {
          onBeforeOpen?.();
          setCamera(true);
        }}
        scanCtaLabel="Tezgah etiketini okut"
        tone="indigo"
      />
      {canPickOrder ? (
        <Button compact mode="text" icon="format-list-bulleted" onPress={() => { onBeforeOpen?.(); loom.setOrdersOpen(true); }} testID="loom-order-ac">
          Etiket yok mu? Çalışan iş seç
        </Button>
      ) : null}
      {loom.scanMessage ? <Text style={styles.reject}>{loom.scanMessage}</Text> : null}
      {line ? (
        <View style={styles.strip}>
          <TruncatedText style={styles.stripText} revealOnTap testID="loom-context">{line}</TruncatedText>
          <Button compact icon="close" onPress={loom.clear} accessibilityLabel="Tezgah bağını kaldır">Kaldır</Button>
        </View>
      ) : (
        <Text style={styles.hint}>Etiket okutulmazsa top dışarıdan gelmiş sayılır.</Text>
      )}
      <LoomChips loom={loom} />
      <LoomOverlays loom={loom} camera={camera} setCamera={setCamera} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  strip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.brandContainer },
  stripText: { flex: 1, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.brandDark },
  hint: { fontSize: typography.size.sm, color: colors.textMuted },
  reject: { fontSize: typography.size.sm, color: colors.dangerText },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, minHeight: 44, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brandContainer, borderColor: colors.brand },
  chipText: { color: colors.text },
  chipTextOn: { color: colors.brandDark, fontWeight: typography.weight.semibold },
});
