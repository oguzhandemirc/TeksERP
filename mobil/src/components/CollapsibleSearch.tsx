// Üst çubuktaki büyüteçle açılan arama kutusu: kapalıyken yer kaplamaz, açılınca yukarıdan kayar ve odaklanır.
// Durum saf `lib/collapsibleSearch` indirgecinden; kapatmak metni temizler.
import React, { useCallback, useReducer } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Appbar, Icon } from 'react-native-paper';
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { colors, radius, shadow, spacing, typography } from '../theme/tokens';
import { SEARCH_CLOSED, activeSearchTerm, collapsibleSearchReducer } from '../lib/collapsibleSearch';

export const SEARCH_ANIM_MS = 200;
/** Kutunun altındaki kardeşler aynı sürede kayar (kutu açılınca liste zıplamasın). */
export const SEARCH_SIBLING_LAYOUT = LinearTransition.duration(SEARCH_ANIM_MS);

export function useCollapsibleSearch() {
  const [state, dispatch] = useReducer(collapsibleSearchReducer, SEARCH_CLOSED);
  const toggle = useCallback(() => dispatch({ type: 'toggle' }), []);
  const close = useCallback(() => dispatch({ type: 'close' }), []);
  const setText = useCallback((text: string) => dispatch({ type: 'text', text }), []);
  return { open: state.open, text: state.text, term: activeSearchTerm(state), toggle, close, setText };
}

export function SearchToggleAction({ open, onPress, testID }: { open: boolean; onPress: () => void; testID?: string }) {
  return (
    <Appbar.Action
      icon={open ? 'magnify-close' : 'magnify'}
      color={colors.textOnDark}
      onPress={onPress}
      accessibilityLabel={open ? 'Aramayı kapat' : 'Ara'}
      testID={testID}
    />
  );
}

interface Props {
  open: boolean;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  testID?: string;
}

export default function CollapsibleSearch({ open, value, onChangeText, placeholder, testID }: Props) {
  if (!open) return null;
  return (
    <Animated.View
      entering={FadeInUp.duration(SEARCH_ANIM_MS)}
      exiting={FadeOutUp.duration(SEARCH_ANIM_MS)}
      style={styles.box}
    >
      <View style={styles.field}>
        <Icon source="magnify" size={22} color={colors.textMuted} />
        <TextInput
          autoFocus
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          returnKeyType="search"
          style={styles.input}
          testID={testID}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  // Çerçevesiz beyaz kutu + hafif gölge (ham Paper outlined görünümü yerine).
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, ...shadow.sm },
  input: { flex: 1, fontSize: typography.size.base, color: colors.text, paddingVertical: spacing.sm },
});
