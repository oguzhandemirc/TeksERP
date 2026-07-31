import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import ScreenChrome from '../../components/ScreenChrome';
import { useVisibleScreens } from '../../hooks/useVisibleScreens';
import { SCREEN_BY_KEY, MobileScreenKey } from '../../types/permissions';

interface ModulePlaceholderProps {
  screenKey: MobileScreenKey;
}

function ModulePlaceholder({ screenKey }: ModulePlaceholderProps) {
  const meta = SCREEN_BY_KEY[screenKey];
  const { hasMultipleVisibleScreens } = useVisibleScreens();
  const nav = useNavigation<any>();

  const canGoBack = hasMultipleVisibleScreens && nav.canGoBack();

  return (
    <ScreenChrome
      title={meta.label}
      subtitle={meta.description}
      onBack={canGoBack ? () => nav.goBack() : undefined}
    >
      <View style={styles.content}>
        <View style={styles.iconBox}>
          <MaterialCommunityIcons name={meta.icon as any} size={96} color="#4f46e5" />
        </View>
        <Text variant="headlineMedium" style={styles.title}>
          {meta.label}
        </Text>
        <Chip icon="hammer-wrench" style={styles.chip}>
          Yapım Aşamasında
        </Chip>
        <Text variant="bodyLarge" style={styles.description}>
          Bu ekran henüz tamamlanmadı. Login akışı ve yetki yönlendirmesi test ediliyor.
        </Text>
        <Text variant="bodySmall" style={styles.permission}>
          Permission: {meta.permission}
        </Text>
      </View>
    </ScreenChrome>
  );
}

export const KK1Screen = () => <ModulePlaceholder screenKey="KK1" />;
export const DepoScreen = () => <ModulePlaceholder screenKey="Depo" />;
export const FasonSevkScreen = () => <ModulePlaceholder screenKey="FasonSevk" />;

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  iconBox: {
    width: 144,
    height: 144,
    borderRadius: 32,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontWeight: '700', color: '#0f172a' },
  chip: { backgroundColor: '#fef3c7' },
  description: { color: '#64748b', textAlign: 'center', maxWidth: 480 },
  permission: { color: '#94a3b8', fontFamily: 'monospace', marginTop: 16 },
});
