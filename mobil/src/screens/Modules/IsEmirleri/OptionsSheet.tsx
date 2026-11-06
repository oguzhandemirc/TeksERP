// İş Emirleri — "Seçenekler": hangi İE oluştur düğmeleri görünsün (CİHAZ ayarı, onay kutulu ModuleSheet).
// En az bir tür açık kalır; yalnız Fason açıksa cihazın öteki giriş noktaları da Fason türüyle açar.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import { TERIM_AD } from '../../../lib/terim';
import { colors, radius, spacing, typography } from '../../../theme';
import { toggleWoCreateKind, type WoCreateKind } from '../../../store/woCreateKinds';
import { KIND_BUTTON } from './scanFlow';

interface Props {
  visible: boolean;
  kinds: WoCreateKind[];
  onChange: (next: WoCreateKind[]) => void;
  onDismiss: () => void;
}

const HINT: Record<WoCreateKind, string> = {
  STANDARD: 'Stok ya da sipariş işi (bugünkü düğme).',
  CUSTOMER_GOODS: `${TERIM_AD.fasonMusteriMali}: müşteri işin üstünde, sipariş gerekmez.`,
};

export default function OptionsSheet({ visible, kinds, onChange, onDismiss }: Props) {
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Seçenekler"
      subtitle="Altta hangi belge okut düğmeleri görünsün? Seçim yalnız bu cihazda saklanır; en az biri açık kalır."
      size="sm"
      footer={<Button mode="contained" onPress={onDismiss} contentStyle={styles.btn} testID="ie-secenek-tamam">Tamam</Button>}
    >
      {(['STANDARD', 'CUSTOMER_GOODS'] as const).map((k) => {
        const on = kinds.includes(k);
        const last = on && kinds.length === 1;
        return (
          <TouchableRipple
            key={k}
            onPress={last ? undefined : () => onChange(toggleWoCreateKind(kinds, k))}
            disabled={last}
            style={[styles.row, on && styles.rowOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: last }}
            testID={`ie-secenek-${k}`}
          >
            <View style={styles.inner}>
              <Icon source={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={on ? colors.brand : colors.textMuted} />
              <View style={styles.text}>
                <Text style={styles.label}>{KIND_BUTTON[k]}</Text>
                <Text style={styles.hint}>{last ? 'Son açık tür — kapatılamaz.' : HINT[k]}</Text>
              </View>
            </View>
          </TouchableRipple>
        );
      })}
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 56, paddingHorizontal: spacing.xl },
  row: { minHeight: 64, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  rowOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
  label: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  hint: { fontSize: typography.size.sm, color: colors.textMuted },
});
