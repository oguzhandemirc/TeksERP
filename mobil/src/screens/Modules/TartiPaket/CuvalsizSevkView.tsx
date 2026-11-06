import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, SegmentedButtons, IconButton, TouchableRipple } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import ModalTextInput from '../../../components/ModalTextInput';
import TruncatedText from '../../../components/TruncatedText';
import { colors, palette, radius, spacing } from '../../../theme/tokens';
import { loadLine, totalMeters, type CartGroup, type LoadMode, type LooseRoll } from './looseLoad';

const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

/** Üst özet — en önemli bilgi (kaç top, kaç metre) en büyük. */
export function LoadSummary({ rolls, mode, groups }: { rolls: LooseRoll[]; mode: LoadMode; groups: CartGroup[] }) {
  const unitText = mode === 'BULK' ? 'Dökme yük' : `${groups.filter((g) => g.label).length} araba`;
  return (
    <View style={styles.summary} testID="loose-summary">
      <View style={styles.kpi}>
        <Text style={styles.kpiNum}>{rolls.length}</Text>
        <Text style={styles.kpiLabel}>top</Text>
      </View>
      <View style={styles.kpiSep} />
      <View style={styles.kpi}>
        <Text style={styles.kpiNum}>{fmtM(totalMeters(rolls))}</Text>
        <Text style={styles.kpiLabel}>metre</Text>
      </View>
      <View style={styles.kpiSep} />
      <View style={styles.kpi}>
        <Text style={styles.kpiUnit}>{unitText}</Text>
        <Text style={styles.kpiLabel}>yükleme</Text>
      </View>
    </View>
  );
}

/** Yükleme biçimi seçimi + araba kipinde aktif araba. */
export function LoadModePicker(props: {
  mode: LoadMode;
  onMode: (m: LoadMode) => void;
  activeCart: string | null;
  onOpenCart: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Yükleme biçimi</Text>
      <View>
        <SegmentedButtons
          value={props.mode}
          onValueChange={(v) => props.onMode(v as LoadMode)}
          buttons={[
            { value: 'BULK', label: 'Dökme (kasaya)', icon: 'truck-outline', style: styles.segment, testID: 'loose-mode-bulk' },
            { value: 'CART', label: 'Araba ile', icon: 'cart-outline', style: styles.segment, testID: 'loose-mode-cart' },
          ]}
        />
      </View>
      {props.mode === 'CART' && (
        <TouchableRipple onPress={props.onOpenCart} style={styles.cartBox} testID="loose-active-cart" accessibilityLabel="Araba no değiştir">
          <View style={styles.cartRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dim}>Okutulan toplar bu arabaya yüklenir</Text>
              <Text style={props.activeCart ? styles.cartLabel : styles.cartEmpty}>
                {props.activeCart ? `Araba ${props.activeCart}` : 'Araba no girin'}
              </Text>
            </View>
            <Text style={styles.cartAction}>{props.activeCart ? 'Değiştir' : 'Gir'}</Text>
          </View>
        </TouchableRipple>
      )}
    </View>
  );
}

/** Araç bilgisi — opsiyonel; doğrudan sevkte irsaliyeye geçer. */
export function VehicleFields(props: {
  plateNumber: string;
  onPlate: (v: string) => void;
  driverName: string;
  onDriver: (v: string) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Araç (isteğe bağlı)</Text>
      <ModalTextInput mode="outlined" label="Plaka" value={props.plateNumber} onChangeText={props.onPlate} autoCapitalize="characters" style={styles.input} />
      <ModalTextInput mode="outlined" label="Şoför" value={props.driverName} onChangeText={props.onDriver} style={styles.input} />
    </View>
  );
}

/** Yük listesi — araba kipinde araba başlıklı gruplar; boş durum yönlendirir. */
export function LoadList(props: {
  mode: LoadMode;
  groups: CartGroup[];
  activeCart: string | null;
  onRemove: (barcode: string) => void;
  onMoveToActive: (id: string) => void;
}) {
  if (props.groups.length === 0) {
    return (
      <View style={styles.empty} testID="loose-empty">
        <Text style={styles.emptyTitle}>Henüz top okutulmadı</Text>
        <Text style={styles.emptyText}>
          {props.mode === 'CART'
            ? 'Araba no girin, sonra alttaki “Top Okut” ile o arabadaki topları okutun.'
            : 'Alttaki “Top Okut” ile kasaya yüklenecek topları okutun.'}
        </Text>
      </View>
    );
  }
  return (
    <View>
      {props.groups.map((g) => (
        <View key={g.label || 'bulk'} style={styles.card}>
          <View style={styles.groupHead}>
            <Text style={styles.groupTitle}>{loadLine(props.mode, g.label || null, g.rolls.length)}</Text>
            <Text style={styles.groupMeters}>{fmtM(g.meters)} m</Text>
          </View>
          {g.rolls.map((r) => (
            <View key={r.id} style={styles.rollRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.barcode}>{r.barcode}</Text>
                <TruncatedText style={styles.dim}>
                  {`${r.itemName} · ${r.colorName ?? 'Ham'}${r.width ? ` · ${r.width} cm` : ''}`}
                </TruncatedText>
              </View>
              <Text style={styles.rollQty}>{fmtM(r.qty)} m</Text>
              {props.mode === 'CART' && props.activeCart && r.cartLabel !== props.activeCart && (
                <IconButton icon="cart-arrow-right" size={26} style={styles.touch} onPress={() => props.onMoveToActive(r.id)} accessibilityLabel={`Araba ${props.activeCart}'a taşı`} />
              )}
              <IconButton icon="close" size={26} style={styles.touch} onPress={() => props.onRemove(r.barcode)} accessibilityLabel={`${r.barcode} listeden çıkar`} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Araba no girişi — son kullanılan arabalar tek dokunuşla seçilir. */
export function CartLabelModal(props: {
  visible: boolean;
  onDismiss: () => void;
  recent: string[];
  onChoose: (label: string) => boolean;
}) {
  const [draft, setDraft] = useState('');
  const pick = (v: string) => {
    if (props.onChoose(v)) {
      setDraft('');
      props.onDismiss();
    }
  };
  return (
    <AppModal visible={props.visible} onDismiss={props.onDismiss} position="center" contentStyle={styles.modal}>
      <Text style={styles.modalTitle}>Araba no</Text>
      <Text style={styles.dim}>Arabanın üstündeki numarayı yazın (ör. A-12). Aynı sevkiyatta her araba no bir kez kullanılır.</Text>
      <ModalTextInput mode="outlined" label="Araba no" value={draft} onChangeText={setDraft} autoFocus maxLength={32} style={styles.input} onSubmitEditing={() => pick(draft)} testID="loose-cart-input" />
      {props.recent.length > 0 && (
        <View style={styles.chips}>
          {props.recent.map((l) => (
            <Button key={l} mode="outlined" onPress={() => pick(l)} style={styles.chip} contentStyle={styles.btnContent}>
              {l}
            </Button>
          ))}
        </View>
      )}
      <View style={styles.modalActions}>
        <Button mode="text" onPress={props.onDismiss} contentStyle={styles.btnContent}>Vazgeç</Button>
        <Button mode="contained" onPress={() => pick(draft)} disabled={!draft.trim()} contentStyle={styles.btnContent} testID="loose-cart-ok">
          Bu arabaya yükle
        </Button>
      </View>
    </AppModal>
  );
}

/** Sabit alt çubuk — okut + sevk et; engel varsa sebep düğmenin üstünde yazar. */
export function BottomBar(props: {
  count: number;
  meters: number;
  blockReason: string | null;
  submitting: boolean;
  /** Dar (telefon dikey) ekranda düğmeler alt alta. */
  stacked?: boolean;
  onScan: () => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.bottom}>
      {props.blockReason && props.count > 0 && <Text style={styles.block}>{props.blockReason}</Text>}
      <View style={[styles.bottomRow, props.stacked && styles.bottomStack]}>
        <Button mode="outlined" icon="barcode-scan" onPress={props.onScan} style={[styles.bottomBtn, !props.stacked && styles.grow1]} contentStyle={styles.bigContent} labelStyle={styles.bigLabel} testID="loose-scan">
          Top Okut
        </Button>
        <Button
          mode="contained"
          icon="truck-check"
          onPress={props.onSubmit}
          disabled={!!props.blockReason || props.submitting}
          loading={props.submitting}
          style={[styles.bottomBtn, !props.stacked && styles.grow2]}
          contentStyle={styles.bigContent}
          labelStyle={styles.bigLabel}
          testID="loose-submit"
        >
          {props.count > 0 ? `Sevk Et · ${props.count} top · ${fmtM(props.meters)} m` : 'Sevk Et'}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', backgroundColor: colors.headerBg, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  kpi: { flex: 1, alignItems: 'center' },
  kpiSep: { width: StyleSheet.hairlineWidth, backgroundColor: palette.slate[600] },
  kpiNum: { color: colors.textOnDark, fontSize: 34, fontWeight: '800' },
  kpiUnit: { color: colors.textOnDark, fontSize: 20, fontWeight: '700', marginTop: 8 },
  kpiLabel: { color: colors.textOnDarkMuted, fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  segment: { minHeight: 56, justifyContent: 'center' },
  cartBox: { marginTop: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: colors.brand, padding: spacing.md, minHeight: 56 },
  cartRow: { flexDirection: 'row', alignItems: 'center' },
  cartLabel: { fontSize: 24, fontWeight: '800', color: colors.brandDark },
  cartEmpty: { fontSize: 20, fontWeight: '700', color: colors.warningText },
  cartAction: { fontSize: 15, fontWeight: '700', color: colors.brand, paddingHorizontal: spacing.sm },
  input: { marginTop: spacing.sm },
  empty: { alignItems: 'center', padding: spacing.xxl, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  groupHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  groupTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.text },
  groupMeters: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
  rollRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  barcode: { fontSize: 15, fontWeight: '700', fontFamily: 'monospace', color: colors.text },
  rollQty: { fontSize: 16, fontWeight: '700', color: colors.text, marginHorizontal: spacing.sm },
  touch: { width: 56, height: 56, margin: 0 },
  dim: { fontSize: 13, color: colors.textSecondary },
  modal: { width: '90%', maxWidth: 480, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  chip: { marginRight: spacing.sm, marginBottom: spacing.sm },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.lg, gap: spacing.sm },
  btnContent: { minHeight: 56 },
  bottom: { padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  block: { color: colors.warningText, fontSize: 14, fontWeight: '700', marginBottom: spacing.sm, textAlign: 'center' },
  bottomRow: { flexDirection: 'row', gap: spacing.md },
  bottomStack: { flexDirection: 'column-reverse' },
  bottomBtn: { borderRadius: radius.md },
  grow1: { flex: 1 },
  grow2: { flex: 2 },
  bigContent: { minHeight: 64 },
  bigLabel: { fontSize: 17, fontWeight: '800' },
});
