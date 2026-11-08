// İş Emirleri — "Seçenekler" (CİHAZ ayarları, onay kutulu ModuleSheet): formda hangi mal sahipleri seçilebilsin (iki tür
// açıksa formda "Malın sahibi" kartı; en az biri açık; yalnız Fason açıksa öteki giriş noktaları da Fason) + rota tuşta mı.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import { TERIM_AD } from '../../../lib/terim';
import { colors, radius, spacing, typography } from '../../../theme';
import { toggleWoCreateKind, type WoCreateKind } from '../../../store/woCreateKinds';

interface Props {
  visible: boolean;
  kinds: WoCreateKind[];
  onChange: (next: WoCreateKind[]) => void;
  routeOnButton: boolean;
  onRouteOnButton: (v: boolean) => void;
  onDismiss: () => void;
}

const LABEL: Record<WoCreateKind, string> = { STANDARD: 'Bizim mal', CUSTOMER_GOODS: 'Müşteri malı (fason)' };
const HINT: Record<WoCreateKind, string> = {
  STANDARD: 'Stok ya da sipariş işi (bugünkü tür).',
  CUSTOMER_GOODS: `${TERIM_AD.fasonMusteriMali}: müşteri işin üstünde, sipariş gerekmez.`,
};

export default function OptionsSheet({ visible, kinds, onChange, routeOnButton, onRouteOnButton, onDismiss }: Props) {
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Seçenekler"
      subtitle="Formda hangi mal sahipleri seçilebilsin? İkisi açıksa formda sorulur. Seçimler yalnız bu cihazda saklanır."
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
                <Text style={styles.label}>{LABEL[k]}</Text>
                <Text style={styles.hint}>{last ? 'Son açık tür — kapatılamaz.' : HINT[k]}</Text>
              </View>
            </View>
          </TouchableRipple>
        );
      })}
      <TouchableRipple
        onPress={() => onRouteOnButton(!routeOnButton)}
        style={[styles.row, routeOnButton && styles.rowOn]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: routeOnButton }}
        testID="ie-secenek-rota-tusta"
      >
        <View style={styles.inner}>
          <Icon source={routeOnButton ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={routeOnButton ? colors.brand : colors.textMuted} />
          <View style={styles.text}>
            <Text style={styles.label}>Rota seçimini Belge Okut tuşunda göster</Text>
            <Text style={styles.hint}>Kapalıyken rota formda kart rotasından gelir, yoksa sahada belirlenir.</Text>
          </View>
        </View>
      </TouchableRipple>
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
