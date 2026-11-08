// İş Emirleri — "Seçenekler" (CİHAZ ayarları, onay kutulu ModuleSheet): alttaki tuşlar (biri hep açık) · formda hangi mal
// sahipleri seçilebilsin (iki tür açıksa formda "Malın sahibi" kartı; biri açıksa tuşlarda etiket) · rota tuşta mı ·
// form başlığında son parti numarası.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import { colors, radius, spacing, typography } from '../../../theme';
import { toggleWoCreateKind, type WoCreateKind } from '../../../store/woCreateKinds';
import type { WoButtons } from '../../../store/deviceSettingsStore';

interface Props {
  visible: boolean;
  kinds: WoCreateKind[];
  onChange: (next: WoCreateKind[]) => void;
  routeOnButton: boolean;
  onRouteOnButton: (v: boolean) => void;
  buttons: WoButtons;
  onButtons: (v: WoButtons) => void;
  lastBatchHint: boolean;
  onLastBatchHint: (v: boolean) => void;
  onDismiss: () => void;
}

/** Tuş aç/kapa; ikisi birden kapanmaz (son açık tuş kilitli). */
function toggleButton(cur: WoButtons, which: 'scan' | 'manual'): WoButtons {
  if (cur === 'both') return which === 'scan' ? 'manual' : 'scan';
  return cur === which ? cur : 'both';
}

const LABEL: Record<WoCreateKind, string> = { STANDARD: 'Kendi Üretimimiz', CUSTOMER_GOODS: 'Fason Üretim' };
const HINT: Record<WoCreateKind, string> = {
  STANDARD: 'Stok ya da sipariş işi.',
  CUSTOMER_GOODS: 'Müşteri malı işlenir: müşteri işin üstünde, sipariş gerekmez.',
};

function CheckRow({ on, locked, label, hint, onPress, testID }: { on: boolean; locked?: boolean; label: string; hint: string; onPress: () => void; testID: string }) {
  return (
    <TouchableRipple
      onPress={locked ? undefined : onPress}
      disabled={locked}
      style={[styles.row, on && styles.rowOn]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: locked }}
      testID={testID}
    >
      <View style={styles.inner}>
        <Icon source={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={on ? colors.brand : colors.textMuted} />
        <View style={styles.text}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.hint}>{hint}</Text>
        </View>
      </View>
    </TouchableRipple>
  );
}

export default function OptionsSheet({ visible, kinds, onChange, routeOnButton, onRouteOnButton, buttons, onButtons, lastBatchHint, onLastBatchHint, onDismiss }: Props) {
  const scanOn = buttons !== 'manual';
  const manualOn = buttons !== 'scan';
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Seçenekler"
      subtitle="Seçimler yalnız bu cihazda saklanır."
      size="sm"
      footer={<Button mode="contained" onPress={onDismiss} contentStyle={styles.btn} testID="ie-secenek-tamam">Tamam</Button>}
    >
      <Text style={styles.section}>Alttaki tuşlar</Text>
      <CheckRow on={scanOn} locked={scanOn && !manualOn} label="Belge Okut" hint={scanOn && !manualOn ? 'Son açık tuş — kapatılamaz.' : 'İrsaliyeyi okutarak iş emri aç.'} onPress={() => onButtons(toggleButton(buttons, 'scan'))} testID="ie-secenek-tus-okut" />
      <CheckRow on={manualOn} locked={manualOn && !scanOn} label="Elle Oluştur" hint={manualOn && !scanOn ? 'Son açık tuş — kapatılamaz.' : 'Belgesiz, boş formla iş emri aç.'} onPress={() => onButtons(toggleButton(buttons, 'manual'))} testID="ie-secenek-tus-elle" />

      <Text style={styles.section}>Malın sahibi</Text>
      <Text style={styles.sectionHint}>İkisi açıksa formda "Malın sahibi" sorulur. Biri açıksa sorulmaz; iş emri o türle açılır ve tuşlarda etiketi görünür.</Text>
      {(['STANDARD', 'CUSTOMER_GOODS'] as const).map((k) => {
        const on = kinds.includes(k);
        const last = on && kinds.length === 1;
        return <CheckRow key={k} on={on} locked={last} label={LABEL[k]} hint={last ? 'Son açık tür — kapatılamaz.' : HINT[k]} onPress={() => onChange(toggleWoCreateKind(kinds, k))} testID={`ie-secenek-${k}`} />;
      })}

      {scanOn && (
        <>
          <Text style={styles.section}>Rota</Text>
          <CheckRow on={routeOnButton} label="Rota seçimini Belge Okut tuşunda göster" hint="Kapalıyken rota formda kart rotasından gelir, yoksa sahada belirlenir." onPress={() => onRouteOnButton(!routeOnButton)} testID="ie-secenek-rota-tusta" />
        </>
      )}

      <Text style={styles.section}>Form başlığı</Text>
      <CheckRow on={lastBatchHint} label="Son parti numarasını göster" hint="İş emri formunun başlığında son kullanılan parti numarası görünür (kısa numara açıksa)." onPress={() => onLastBatchHint(!lastBatchHint)} testID="ie-secenek-son-parti" />
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 56, paddingHorizontal: spacing.xl },
  section: { marginTop: spacing.sm, fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHint: { fontSize: typography.size.sm, color: colors.textMuted },
  row: { minHeight: 64, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  rowOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
  label: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  hint: { fontSize: typography.size.sm, color: colors.textMuted },
});
