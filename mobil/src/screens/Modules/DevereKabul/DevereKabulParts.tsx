// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — görünüm parçaları: üst alanlar (devereci · irsaliye · siparişler) + levent listesi
// =============================================================================
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text, Button, Chip, TouchableRipple, Icon } from 'react-native-paper';
import ModalTextInput from '../../../components/ModalTextInput';
import PickerModal from '../../../components/PickerModal';
import TruncatedText from '../../../components/TruncatedText';
import { colors, moduleAccents, spacing, typography } from '../../../theme';
import { fmtMeters } from '../../../utils/meters';
import { parseNum, progressText, type BeamDraft } from './receiveDocPayload';
import type { DevereKabulState } from './useDevereKabul';

const accent = moduleAccents.DevereKabul;

/** Devereci ve açık sipariş seçicileri (seçilmiş sipariş listeden düşer). */
export function HeaderPickers({ state: s, picker, onClose }: { state: DevereKabulState; picker: null | 'sub' | 'order'; onClose: () => void }) {
  const pickedIds = new Set(s.orders.map((o) => o.orderId));
  return (
    <>
      <PickerModal
        visible={picker === 'sub'}
        title="Devereci"
        options={s.subcontractors.map((x) => ({ value: x.id, label: x.name, sublabel: `${x.openOrderCount} açık sipariş` }))}
        selectedValue={s.subcontractorId ?? ''}
        loading={s.context.isLoading}
        emptyText="Açık fason devere siparişi olan devereci yok — sipariş panelden açılır (Üretim › Devere / Çözgü)."
        onDismiss={onClose}
        onSelect={(id) => { s.selectSubcontractor(id); onClose(); }}
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
        onDismiss={onClose}
        onSelect={(id) => { s.addOrder(id); onClose(); }}
      />
    </>
  );
}

export function HeaderFields({ state, onPickSub, onPickOrder }: { state: DevereKabulState; onPickSub: () => void; onPickOrder: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Button mode="outlined" icon="account-hard-hat-outline" onPress={onPickSub} contentStyle={styles.tall} style={styles.grow} testID="devere-kabul-devereci">
          {state.subcontractor ? `Devereci: ${state.subcontractor.name}` : 'Devereci seç'}
        </Button>
        <ModalTextInput
          mode="outlined"
          label="İrsaliye no"
          value={state.deliveryNoteNo}
          onChangeText={state.setDeliveryNoteNo}
          maxLength={64}
          autoCapitalize="characters"
          style={styles.note}
          testID="devere-kabul-irsaliye"
        />
      </View>
      {state.subcontractorId ? (
        <ScrollView horizontal contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {state.orders.map((o) => (
            <Chip
              key={o.orderId}
              selected={o.orderId === state.activeOrderId}
              showSelectedOverlay
              onPress={() => state.setActiveOrderId(o.orderId)}
              onClose={() => state.removeOrder(o.orderId)}
              style={styles.chip}
            >
              {`${o.orderNo} · ${o.beams.length}`}
            </Chip>
          ))}
          <Button mode="contained-tonal" icon="plus" onPress={onPickOrder} contentStyle={styles.tall} testID="devere-kabul-siparis-ekle">
            {state.orders.length ? 'Sipariş ekle' : 'Sipariş seç'}
          </Button>
        </ScrollView>
      ) : null}
    </View>
  );
}

/** Seçili siparişin bağlam kartı: "FDV-0001 ARMÜR 350 · 4 levent bekleniyor". */
export function OrderCard({ state }: { state: DevereKabulState }) {
  const o = state.activeOrder;
  if (!o) return null;
  const drafted = state.orders.find((x) => x.orderId === o.id)?.beams.length ?? 0;
  const expected = o.remainingBeamCount === null ? '' : ` · ${o.remainingBeamCount} levent bekleniyor`;
  return (
    <View style={styles.card}>
      <TruncatedText style={styles.cardTitle}>{`${o.orderNo} ${o.warpSpec.name}${expected}`}</TruncatedText>
      <Text style={styles.cardLine}>{`Kalan ${fmtMeters(Number(o.remainingM))} m · gelen ${o.receivedBeamCount} levent / ${fmtMeters(Number(o.receivedM))} m · bu kabulde ${progressText(drafted, o.remainingBeamCount)}`}</Text>
    </View>
  );
}

function lineText(b: BeamDraft): string {
  const no = b.body ? `${b.body.bodyNo}${b.body.kind === 'new' ? ' (yeni)' : ''}` : b.physicalBeamNo.trim() || 'gövdesiz';
  const len = parseNum(b.lengthM);
  const gross = parseNum(b.grossKg);
  return [no, len === null ? '— m' : `${fmtMeters(len)} m`, gross === null ? '' : `tartı ${fmtMeters(gross)} kg`].filter(Boolean).join(' · ');
}

export function LinesList({ state }: { state: DevereKabulState }) {
  const o = state.orders.find((x) => x.orderId === state.activeOrderId);
  if (!o) return <Text style={styles.hint}>{state.subcontractorId ? 'Siparişi seçin; sonra her leventin gövde QR\'ını okutun.' : 'Önce devereciyi seçin.'}</Text>;
  if (o.beams.length === 0) return <Text style={styles.hint}>Henüz levent yok — gövde QR'ını okutun.</Text>;
  return (
    <ScrollView contentContainerStyle={styles.lines}>
      {o.beams.map((b, i) => (
        <TouchableRipple key={b.key} onPress={() => state.editLine(o.orderId, b)} style={styles.line} accessibilityLabel={`${i + 1}. levent düzelt`}>
          <View style={styles.lineInner}>
            <Text style={styles.lineText}>{`${i + 1}. ${lineText(b)}`}</Text>
            <Icon source="check-circle" size={22} color={accent.tint} />
          </View>
        </TouchableRipple>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  grow: { flex: 1 },
  tall: { height: 56 },
  note: { flex: 1, backgroundColor: colors.surface },
  chips: { gap: spacing.sm, alignItems: 'center' },
  chip: { height: 48, justifyContent: 'center' },
  card: { backgroundColor: accent.bg, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  cardTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  cardLine: { fontSize: typography.size.base, color: colors.text },
  hint: { color: colors.textSecondary, fontSize: typography.size.base, padding: spacing.md },
  lines: { gap: spacing.sm, paddingBottom: spacing.md },
  line: { minHeight: 56, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: spacing.md },
  lineInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  lineText: { fontSize: typography.size.lg, color: colors.text, flex: 1 },
});
