import React, { useCallback } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Text, TouchableRipple, Icon } from 'react-native-paper';

interface NumpadProps {
  value: string;
  onChange: (next: string) => void;
  allowDecimal?: boolean;
  maxLength?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  /** true → tuşlar sabit yükseklik yerine kapsayıcıyı FLEX ile doldurur (satırlar
   *  eşit paylaşır, tuşlar satır yüksekliğine yayılır). Dar kolonlarda taşmayı
   *  önler (küçük ekranda küçülür, büyük ekranda iri tuş). `compact`'tan bağımsız. */
  fill?: boolean;
}

const ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'BACKSPACE'],
];

export default function Numpad({
  value,
  onChange,
  allowDecimal = true,
  maxLength,
  disabled,
  style,
  compact = false,
  fill = false,
}: NumpadProps) {
  const handlePress = useCallback(
    (key: string) => {
      if (disabled) return;

      if (key === 'BACKSPACE') {
        if (value.length === 0) return;
        onChange(value.slice(0, -1));
        return;
      }

      if (key === '.') {
        if (!allowDecimal || value.includes('.')) return;
        const next = value.length === 0 ? '0.' : value + '.';
        if (maxLength !== undefined && next.length > maxLength) return;
        onChange(next);
        return;
      }

      const next = value + key;
      if (maxLength !== undefined && next.length > maxLength) return;
      onChange(next);
    },
    [value, onChange, allowDecimal, maxLength, disabled]
  );

  return (
    <View style={[styles.container, fill && styles.containerFill, style]}>
      {ROWS.map((row, rIdx) => (
        <View key={rIdx} style={[styles.row, fill && styles.rowFill]}>
          {row.map((key) => {
            const isBackspace = key === 'BACKSPACE';
            const isDecimal = key === '.';
            const decimalDisabled =
              isDecimal && (!allowDecimal || value.includes('.'));
            const keyDisabled =
              disabled ||
              decimalDisabled ||
              (isBackspace && value.length === 0);

            return (
              <TouchableRipple
                key={key}
                onPress={() => handlePress(key)}
                disabled={keyDisabled}
                rippleColor="rgba(79, 70, 229, 0.18)"
                style={[
                  styles.key,
                  // Yükseklik: fill → yok (satır flex'ine yayılır); compact → 48; default → 68.
                  fill ? null : compact ? styles.keyCompact : styles.keyDefaultHeight,
                  isBackspace && styles.keyBackspace,
                  keyDisabled && styles.keyDisabled,
                ]}
              >
                <View style={styles.keyContent}>
                  {isBackspace ? (
                    <Icon source="backspace-outline" size={compact ? 22 : 30} color="#dc2626" />
                  ) : (
                    <Text style={[styles.keyText, compact && styles.keyTextCompact]}>{key}</Text>
                  )}
                </View>
              </TouchableRipple>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  containerFill: { flex: 1 },
  row: { flexDirection: 'row', gap: 8 },
  rowFill: { flex: 1 },
  key: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  // Varsayılan sabit yükseklik (fill kapalıyken). fill modunda uygulanmaz →
  // tuş satır yüksekliğine (rowFill flex) yayılır.
  keyDefaultHeight: { height: 68 },
  keyCompact: { height: 48, borderRadius: 10 },
  keyContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBackspace: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  keyDisabled: {
    opacity: 0.4,
  },
  keyText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a',
  },
  keyTextCompact: { fontSize: 22 },
});
