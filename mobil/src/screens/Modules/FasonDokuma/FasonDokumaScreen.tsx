// =============================================================================
// FASON DOKUMA KABUL (G2t) — fasonda dokunan iş: levent dönüşü + dönen topların kabulü
// =============================================================================
// OTURUMSUZ (Devere emsali). Sevk açma ve iptaller PANELDEN (dokuma işi detayı);
// tablette yalnız kabul + dönüş. Kuyruk YOK; kayıt gitmezse anında söyler.
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenChrome from '../../../components/ScreenChrome';
import PickerModal from '../../../components/PickerModal';
import { useLandscapeLock } from '../../../hooks/useLandscapeLock';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { colors, spacing, typography } from '../../../theme';
import { useFasonDokuma } from './useFasonDokuma';
import { ReceiveModal, ReturnModal } from './FasonDokumaModals';

export default function FasonDokumaScreen() {
  const compact = useDeviceType() === 'phone';
  useLandscapeLock(!compact);
  const insets = useSafeAreaInsets();
  const state = useFasonDokuma();
  const [picker, setPicker] = useState(false);
  const o = state.order;
  const openBeams = o?.openDispatches.reduce((n, d) => n + d.beams.length, 0) ?? 0;
  return (
    <ScreenChrome title="Fason Dokuma Kabul" subtitle={state.context.data ? `${state.orders.length} açık fason iş` : undefined}>
      <View style={styles.root}>
        <View style={styles.body}>
          <Button mode="outlined" icon="clipboard-text-outline" onPress={() => setPicker(true)} contentStyle={styles.tall}>
            {o ? `${o.weavingOrderNumber} · ${o.subcontractor?.name ?? '—'}` : 'Dokuma işi seç'}
          </Button>
          {o ? (
            <View style={styles.card}>
              <Text style={styles.line}>Kumaş: {o.item.name}{o.color ? ` · ${o.color.name}` : ' · renksiz (ham)'}</Text>
              <Text style={styles.line}>Fasoncu: {o.subcontractor?.name ?? '—'}</Text>
              <Text style={styles.line}>Fasondaki levent: {openBeams} ({o.openDispatches.map((d) => d.dispatchNo).join(', ') || 'sevk yok — fasoncu kendi ipliğini kullanıyor olabilir'})</Text>
            </View>
          ) : (
            <Text style={styles.hint}>Fasonda dokunan açık iş seçin. Sevk açma ve iptaller panelden (Dokuma İşleri › Fason).</Text>
          )}
          {state.context.isError ? <Text style={styles.offline}>Fason işleri yüklenemedi — dokuma modülü kapalı, yetki yok ya da ağ. Yenileyin.</Text> : null}
        </View>
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]}>
          {!state.isOnline ? <Text style={styles.offline}>{state.offlineReason === 'server' ? 'Sunucuya ulaşılamıyor — kayıt yapılamaz (kuyruk yok)' : 'Ağ bağlantısı yok — kayıt yapılamaz (kuyruk yok)'}</Text> : null}
          <View style={styles.buttons}>
            <Button mode="outlined" icon="refresh" onPress={state.refresh} contentStyle={styles.tall}>Yenile</Button>
            <Button mode="outlined" icon="undo-variant" onPress={() => state.setModal('return')} disabled={!o || openBeams === 0 || !state.isOnline || state.busy} contentStyle={styles.tall} style={styles.grow}>
              Levent döndü
            </Button>
            <Button mode="contained" icon="package-variant-plus" onPress={() => state.setModal('receive')} disabled={!o || !state.isOnline || state.busy} contentStyle={styles.tall} labelStyle={styles.primaryLabel} style={styles.grow}>
              Top kabul et
            </Button>
          </View>
        </View>
      </View>
      <PickerModal
        visible={picker}
        title="Fasonda dokunan iş"
        options={state.orders.map((w) => ({ value: w.id, label: w.weavingOrderNumber, sublabel: `${w.item.name}${w.color ? ` · ${w.color.name}` : ''}`, details: [w.subcontractor?.name ?? '—', `${w.openDispatches.reduce((n, d) => n + d.beams.length, 0)} levent fasonda`] }))}
        selectedValue={o?.id ?? ''}
        loading={state.context.isLoading}
        emptyText="Açık fason dokuma işi yok — panelden dokuma işi açın (Kim dokuyor: fasonda)."
        onDismiss={() => setPicker(false)}
        onSelect={(id) => { state.setOrderId(id); setPicker(false); }}
      />
      {o ? <ReceiveModal state={state} /> : null}
      {o ? <ReturnModal state={state} /> : null}
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  body: { flex: 1, padding: spacing.md, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.border },
  line: { fontSize: typography.size.base, color: colors.text },
  hint: { color: colors.textSecondary },
  bottomBar: { padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  tall: { height: 56 },
  primaryLabel: { fontSize: typography.size.base, fontWeight: typography.weight.bold },
  offline: { color: colors.dangerText, textAlign: 'center' },
});
