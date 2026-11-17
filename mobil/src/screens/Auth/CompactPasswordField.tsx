// =============================================================================
// GİRİŞ — dar düzen (telefon / DİKEY tablet) parola alanı
// =============================================================================
// Dar düzende ekran-üstü numpad yok; noktalara dokununca görünmez bir TextInput sistem klavyesini
// açar. Önceden bu alan harfli klavye gösterip girdiyi `sanitizeNumericInput` ile süzüyordu ve
// "ABC" geçişi yalnız yatay numpad'in içindeydi → harfli parolalı kullanıcı (ör. admin) dikeyde
// giriş yapamıyordu. Artık geçiş burada da görünür; ABC'de girdi SÜZÜLMEZ (`sanitizeAlphaInput`),
// 123'te sayı klavyesi + rakam süzmesi kalır. Klavye türü değişince input yeniden kurulur (key) ki
// Android IME yeni türle açılsın.
// =============================================================================
import React from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { palette } from '../../theme/tokens';
import { sanitizeAlphaInput, sanitizeNumericInput } from './loginInput';

// LoginScreen'in koyu giriş paletiyle aynı değerler (jetondan).
const COLORS = {
  bgSoft: palette.slate[800],
  accentLight: palette.indigo[500],
  text: palette.slate[100],
  subtext: palette.slate[400],
  border: palette.slate[700],
  error: palette.red[500],
  pinEmpty: palette.slate[700],
};

type Props = {
  value: string;
  maxLength: number;
  alphaKeyboard: boolean;
  hasUser: boolean;
  submitting: boolean;
  hasError: boolean;
  inputRef: React.RefObject<TextInput | null>;
  /** Süzülmüş değer: ABC'de olduğu gibi, 123'te yalnız rakam. */
  onChange: (value: string) => void;
  onToggleKeyboard: () => void;
  onFocusRequest: () => void;
  onSubmit: () => void;
};

export default function CompactPasswordField(props: Props) {
  const { value, maxLength, alphaKeyboard, hasUser, submitting, hasError, inputRef } = props;
  const handleChange = (text: string) =>
    props.onChange(alphaKeyboard ? sanitizeAlphaInput(text, maxLength) : sanitizeNumericInput(text, maxLength));

  return (
    <>
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>2 · ŞİFRE</Text>
        <TouchableRipple
          testID="login-abc-toggle-compact"
          onPress={props.onToggleKeyboard}
          disabled={submitting}
          rippleColor="rgba(99,102,241,0.25)"
          borderless
          style={styles.toggle}
          accessibilityRole="button"
          accessibilityLabel={alphaKeyboard ? 'Sayısal klavyeye dön' : 'Harfli klavyeye geç'}
        >
          <Text style={styles.toggleText}>{alphaKeyboard ? '123' : 'ABC'}</Text>
        </TouchableRipple>
      </View>
      <TouchableRipple
        testID="login-password-compact-tap"
        onPress={props.onFocusRequest}
        disabled={!hasUser || submitting}
        rippleColor="rgba(99,102,241,0.25)"
        borderless
        style={styles.tap}
      >
        <View style={styles.wrap}>
          <View style={styles.dotRow}>
            {Array.from({ length: Math.min(value.length + 1, 12) }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i < value.length && styles.dotFilled,
                  i === value.length && hasUser && !submitting && styles.dotActive,
                  hasError && styles.dotError,
                ]}
              />
            ))}
          </View>
          {hasUser && (
            <TextInput
              key={alphaKeyboard ? 'alpha' : 'numeric'}
              testID="login-password-compact-input"
              ref={inputRef}
              value={value}
              onChangeText={handleChange}
              keyboardType={alphaKeyboard ? 'default' : 'number-pad'}
              secureTextEntry
              autoCapitalize="none"
              maxLength={maxLength}
              autoFocus
              caretHidden
              // Görünmez overlay: autofill kutusu / seçim tutamağı / bağlam menüsü noktaların üstünde artefakt bırakıyordu.
              importantForAutofill="no"
              autoComplete="off"
              autoCorrect={false}
              contextMenuHidden
              selectTextOnFocus={false}
              editable={!submitting}
              returnKeyType="done"
              onSubmitEditing={props.onSubmit}
              underlineColorAndroid="transparent"
              style={styles.overlayInput}
            />
          )}
        </View>
      </TouchableRipple>
      <Text style={styles.helper}>
        {alphaKeyboard ? 'Harfli klavye — şifre girmek için dokunun' : 'Şifre girmek için dokunun'}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, marginBottom: 10 },
  sectionLabel: { color: COLORS.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  toggle: { paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bgSoft, minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  toggleText: { color: COLORS.text, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  tap: { alignSelf: 'center', borderRadius: 14 },
  wrap: { position: 'relative', paddingVertical: 14, paddingHorizontal: 18 },
  dotRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: COLORS.pinEmpty, backgroundColor: 'transparent' },
  dotFilled: { backgroundColor: COLORS.accentLight, borderColor: COLORS.accentLight },
  dotActive: { borderColor: COLORS.accentLight },
  dotError: { borderColor: COLORS.error },
  helper: { color: COLORS.subtext, fontSize: 12, textAlign: 'center', marginTop: 8 },
  overlayInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // opacity:0 sistemin çizdiği öğeleri de gizler; dokunmalar üstteki TouchableRipple'a gider.
    opacity: 0,
    pointerEvents: 'none',
    color: 'transparent',
    backgroundColor: 'transparent',
    textAlign: 'center',
  },
});
