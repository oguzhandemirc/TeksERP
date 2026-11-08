import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, IconButton, ActivityIndicator } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import ModuleSheet, { SheetField, sheet } from '../../../../components/ModuleSheet';
import TruncatedText from '../../../../components/TruncatedText';
import { BarcodeScannerModal } from '../../../../components/BarcodeScannerModal';
import { colors, spacing } from '../../../../theme';
import { beamLine, previewBlockFor, yarnLine } from './emanetCikisLogic';
import { CandidatePicker, KgSheet, OwnerPicker } from './EmanetCikisPickers';
import { useEmanetPanels, type EmanetPanels } from './useEmanetScan';
import { useEmanetCikis, type EmanetCikisState } from './useEmanetCikis';

// =============================================================================
// EMANET ÇIKIŞ (tablet T1, Depo) — müşterinin emanet leventini / ipliğini sahibine çıkarır.
// Akış: sahip → levent okut/seç · iplik lotu seç + kg → sunucu önizlemesi (engel satırda) → Kaydet.
// Tek kart (ModuleSheet); seçiciler PickerModal. Çevrimiçi-only: numarayı sunucu doğurur.
// =============================================================================

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export default function EmanetCikisSheet({ visible, onDismiss }: Props) {
  const s = useEmanetCikis(visible);
  const p = useEmanetPanels(s, visible);

  const close = () => {
    s.reset();
    onDismiss();
  };

  return (
    <ModuleSheet
      visible={visible}
      onDismiss={close}
      title="Emanet Çıkış"
      subtitle="Müşterinin emanet leventini ya da ipliğini sahibine geri verir."
      footer={<Footer s={s} onClose={close} />}
      overlays={<Overlays s={s} p={p} />}
    >
      {s.result ? (
        <View style={sheet.box} testID="emanet-sonuc">
          <Text style={styles.resultNo}>{s.result.dispatchNo}</Text>
          <TruncatedText style={sheet.line}>{s.result.ownerCustomer.name}</TruncatedText>
          <Text style={sheet.line}>{s.result.totals.beamCount} levent · {s.result.totals.yarnKg} kg iplik</Text>
        </View>
      ) : (
        <>
          <SheetField label="Malın sahibi *" value={s.owner?.name ?? ''} placeholder="Müşteri seç…" onPress={() => p.setOwnerOpen(true)} hint={s.owner && s.lines.length > 0 ? 'Müşteri değişirse kalem listesi boşalır.' : undefined} />
          {!s.online ? <Text style={sheet.warn} testID="emanet-cevrimdisi">Çevrimdışı — kalemler eklenebilir, kayıt bağlantı gelince yapılır.</Text> : null}
          <View style={sheet.row}>
            <Button icon="qrcode-scan" mode="contained-tonal" disabled={!s.owner} onPress={() => p.setScanOpen(true)} style={styles.action} contentStyle={styles.actionContent} testID="emanet-okut">Okut</Button>
            <Button icon="cylinder" mode="outlined" disabled={!s.owner} onPress={() => p.setPicker('beam')} style={styles.action} contentStyle={styles.actionContent} testID="emanet-levent-sec">Levent seç</Button>
            <Button icon="package-variant" mode="outlined" disabled={!s.owner} onPress={() => p.setPicker('yarn')} style={styles.action} contentStyle={styles.actionContent} testID="emanet-lot-sec">İplik lotu seç</Button>
          </View>
          <Lines s={s} />
        </>
      )}
    </ModuleSheet>
  );
}

function Overlays({ s, p }: { s: EmanetCikisState; p: EmanetPanels }) {
  return (
    <>
      <OwnerPicker visible={p.ownerOpen} selectedId={s.owner?.id ?? null} onDismiss={() => p.setOwnerOpen(false)} onSelect={(id, name) => { s.selectOwner(id, name); p.setOwnerOpen(false); }} />
      {s.owner ? (
        <CandidatePicker
          kind={p.picker}
          ownerId={s.owner.id}
          taken={p.taken}
          yarnSubset={p.yarnSubset}
          onBlocked={(why) => Toast.show({ type: 'error', text1: 'Seçilemez', text2: why })}
          onPickBeam={(b) => { s.addLine(beamLine(b)); p.setPicker(null); }}
          onPickYarn={(y) => { p.setPicker(null); p.setYarnSubset(null); p.setKgLot(y); }}
          onDismiss={() => { p.setPicker(null); p.setYarnSubset(null); }}
        />
      ) : null}
      <KgSheet lot={p.kgLot} onDismiss={() => p.setKgLot(null)} onDone={(y, kg) => { s.addLine(yarnLine(y, kg)); p.setKgLot(null); }} />
      <BarcodeScannerModal
        visible={p.scanOpen}
        title="Levent / lot okut"
        onDismiss={() => p.setScanOpen(false)}
        onScan={(data) => { p.pendingScan.current = data; p.setScanOpen(false); }}
        onModalHide={p.onScannerHidden}
      />
    </>
  );
}

function Lines({ s }: { s: EmanetCikisState }) {
  if (s.lines.length === 0) return <Text style={sheet.hint}>Henüz kalem yok — leventi okutun ya da listeden seçin.</Text>;
  return (
    <View style={styles.lines}>
      {s.lines.map((l) => {
        const why = previewBlockFor(l, s.preview);
        return (
          <View key={l.key} style={styles.lineRow} testID={`emanet-satir-${l.key}`}>
            <View style={styles.lineText}>
              <TruncatedText style={styles.lineLabel}>{l.label}</TruncatedText>
              <TruncatedText style={sheet.hint}>{l.sub}</TruncatedText>
              {why ? <Text style={styles.lineBlocked}>{why}</Text> : null}
            </View>
            <IconButton icon="close" size={24} accessibilityLabel={`${l.label} çıkar`} onPress={() => s.removeLine(l.key)} />
          </View>
        );
      })}
      {s.previewLoading ? <ActivityIndicator size="small" /> : null}
      {s.preview?.warnings.map((w) => <Text key={w} style={sheet.warn}>{w}</Text>)}
    </View>
  );
}

function Footer({ s, onClose }: { s: EmanetCikisState; onClose: () => void }) {
  if (s.result) {
    return (
      <>
        <Button onPress={onClose}>Kapat</Button>
        <Button mode="contained" onPress={s.startNext} testID="emanet-yeni">Yeni çıkış</Button>
      </>
    );
  }
  return (
    <>
      <View style={sheet.footerLeft}>
        {s.blockedReason ? <Text style={sheet.warn} testID="emanet-engel">{s.blockedReason}</Text> : null}
        {s.previewError ? <Button compact onPress={s.retryPreview}>Tekrar dene</Button> : null}
      </View>
      <Button onPress={onClose}>Vazgeç</Button>
      <Button mode="contained" disabled={!s.canSubmit} loading={s.submitting} onPress={s.submit} testID="emanet-kaydet">
        {s.retrying ? 'Tekrar Dene' : 'Çıkışı Kaydet'}
      </Button>
    </>
  );
}

const styles = StyleSheet.create({
  action: { flexGrow: 1, minWidth: 160 },
  actionContent: { minHeight: 56 },
  lines: { gap: spacing.xs },
  lineRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: spacing.xs },
  lineText: { flex: 1, gap: 2 },
  lineLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  lineBlocked: { fontSize: 13, color: colors.dangerText },
  resultNo: { fontSize: 24, fontWeight: '800', color: colors.text },
});
