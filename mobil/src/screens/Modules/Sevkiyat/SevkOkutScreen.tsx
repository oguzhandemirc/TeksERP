// El terminali sevk okutma (v2): üstte özet + hedef satırı, ortada çuvallar ve çuvalsız toplar, altta Çuval Aç / Sevk Et.
// Seçili çuval varsa okutulan top ONA, yoksa çuvalsıza gider; karar ve sınıflandırma sunucuda (useSevkOkut).
// Sevk edilmiş sevkiyat aynı ekranda salt-okunur açılır (okutma kapalı; baskı düğmeleri altta).
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../../components/ScreenChrome';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { SkeletonList } from '../../../components/motion';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { useHardwareScanTarget } from '../../../hooks/useHardwareScanTarget';
import type { HandheldSack } from '../../../services/handheldShipment.service';
import type { MainStackParamList } from '../../../navigation/types';
import { colors, spacing } from '../../../theme';
import { CariHoldBlockedScreen } from './CariHold';
import { DispatchConfirmSheet, DispatchResultSheet } from './elSevk/DispatchSheets';
import { LoadList } from './elSevk/LoadList';
import { SackKgSheet, SackRollsSheet } from './elSevk/SackSheets';
import { ScanLine, SummaryStrip } from './elSevk/ScanHeader';
import { targetLabel } from './elSevk/selection';
import { BottomBar, ConfirmSheet, FilledButton, ui } from './elSevk/ui';
import { useDispatchFlow } from './elSevk/useDispatchFlow';
import { useSevkOkut } from './elSevk/useSevkOkut';

interface ActionsProps {
  planned: boolean;
  rollCount: number;
  openSack: () => Promise<void>;
  openingSack: boolean;
  flow: ReturnType<typeof useDispatchFlow>;
}

/** Alt eylem çubuğu: açıkken Çuval Aç / Sevk Et; sevk edilmişte irsaliye ve etiket baskısı. */
function OkutActions({ planned, rollCount, openSack, openingSack, flow }: ActionsProps) {
  if (planned) {
    return (
      <BottomBar>
        <FilledButton label="Çuval Aç" icon="package-variant-plus" tone="neutral" onPress={() => void openSack()} loading={openingSack} style={ui.flex} testID="sevk-cuval-ac" />
        <FilledButton label="Sevk Et" icon="truck-check" onPress={flow.open} disabled={rollCount === 0} style={ui.flex} testID="sevk-et" />
      </BottomBar>
    );
  }
  return (
    <BottomBar>
      <FilledButton label="İrsaliye" icon="printer" tone="neutral" onPress={flow.printNote} loading={flow.printingNote} style={ui.flex} testID="sevk-irsaliye-yazdir" />
      {flow.labelCount > 0 ? <FilledButton label={flow.labelText} icon="label-multiple-outline" onPress={flow.printLabels} loading={flow.labelBusy} style={ui.flex} testID="sevk-etiket-bas" /> : null}
    </BottomBar>
  );
}

export default function SevkOkutScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { shipmentId, shipmentNo } = useRoute<RouteProp<MainStackParamList, 'SevkOkut'>>().params;
  const o = useSevkOkut(shipmentId);
  const { state, planned } = o;
  const flow = useDispatchFlow({ shipmentId, state, dispatch: o.dispatch, refetch: o.stateQ.refetch });
  const [camera, setCamera] = useState(false);
  const [contentsOf, setContentsOf] = useState<string | null>(null);
  const [kgOf, setKgOf] = useState<string | null>(null);

  // Okuyucu tetiği yalnız açık sevkiyatta ve üstte sayfa yokken bu ekrana akar.
  const sheetOpen = !!o.prompt || flow.confirmOpen || !!flow.result || kgOf != null || contentsOf != null || camera;
  useHardwareScanTarget((s) => o.scan(s.data), { active: planned && !sheetOpen });

  const sackById = (id: string | null) => (id ? state?.sacks.find((s) => s.id === id) ?? null : null);

  const onSackPress = (s: HandheldSack) => (planned ? o.toggleSack(s.id) : setContentsOf(s.id));
  const title = state?.shipment.shipmentNo ?? shipmentNo ?? 'Sevk';
  const statusLine = state ? `${state.shipment.customer.name}${planned ? '' : ' · Sevk edildi'}` : undefined;

  return (
    <ScreenChrome
      title={title}
      statusLine={statusLine}
      onBack={() => nav.goBack()}
      headerExtras={
        planned ? <Appbar.Action icon="camera" color={colors.textOnDark} onPress={() => setCamera(true)} accessibilityLabel="Kamerayla okut" testID="sevk-kamera" /> : null
      }
    >
      {o.stateQ.isLoading ? (
        <SkeletonList count={5} style={styles.body} />
      ) : !state ? (
        <View style={styles.error} testID="sevk-okut-hata">
          <Text style={ui.secondary}>{(o.stateQ.error as Error)?.message || 'Sevkiyat alınamadı'}</Text>
          <FilledButton label="Tekrar dene" tone="neutral" icon="refresh" onPress={() => void o.stateQ.refetch()} />
        </View>
      ) : (
        <>
          <View style={styles.head}>
            <SummaryStrip summary={state.summary} />
            {planned ? <ScanLine banner={o.banner} target={targetLabel(state, o.selected)} targetIsSack={o.selected != null} /> : null}
          </View>
          <LoadList
            state={state}
            planned={planned}
            selected={o.selected}
            highlight={o.highlight}
            onSackPress={onSackPress}
            onSackLongPress={(s) => setContentsOf(s.id)}
            onSackKg={(s) => setKgOf(s.id)}
          />
          <OkutActions planned={planned} rollCount={state.summary.rollCount} openSack={o.openSack} openingSack={o.openingSack} flow={flow} />
        </>
      )}
      <ConfirmSheet
        visible={!!o.prompt}
        title={o.prompt?.title ?? ''}
        body={o.prompt?.body}
        confirmLabel={o.prompt?.confirmLabel ?? 'Tamam'}
        tone={o.prompt?.tone}
        onConfirm={o.confirmPrompt}
        onCancel={o.cancelPrompt}
        testID="sevk-soru-onay"
      />
      <SackRollsSheet sack={sackById(contentsOf)} onDismiss={() => setContentsOf(null)} />
      <SackKgSheet sack={sackById(kgOf)} onDismiss={() => setKgOf(null)} onSave={o.setSackWeight} />
      <DispatchConfirmSheet visible={flow.confirmOpen} state={state} busy={flow.busy} error={flow.error} onCancel={flow.cancel} onConfirm={(p) => void flow.confirm(p)} />
      <DispatchResultSheet
        result={flow.result}
        onClose={flow.closeResult}
        onPrintNote={flow.printNote}
        printingNote={flow.printingNote}
        labelText={flow.labelText}
        labelBusy={flow.labelBusy}
        labelCount={flow.labelCount}
        onPrintLabels={flow.printLabels}
      />
      <CariHoldBlockedScreen block={flow.hold} onClose={flow.closeHold} />
      <BarcodeScannerModal visible={camera} onDismiss={() => setCamera(false)} onScan={(code) => o.scan(code)} continuous trigger="tap" title="Top ya da çuval okut" />
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  error: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl },
});
