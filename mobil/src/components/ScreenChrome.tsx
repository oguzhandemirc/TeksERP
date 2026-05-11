import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Appbar, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { usePermissions } from '../hooks/usePermission';
import type { MainStackParamList } from '../navigation/types';

interface Props {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
}

export default function ScreenChrome({ title, subtitle, onBack, children }: Props) {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const { hasMultipleMobileScreens } = usePermissions();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();

  const showHome = hasMultipleMobileScreens && !onBack;
  const goHome = () => navigation.navigate('ModuleSelect');

  return (
    <View style={styles.root}>
      <Appbar.Header style={styles.appbar} elevated>
        {onBack && <Appbar.BackAction onPress={onBack} color="#fff" />}
        {showHome && (
          <Appbar.Action icon="home" onPress={goHome} color="#fff" accessibilityLabel="Ana sayfa" />
        )}
        <Appbar.Content title={title} subtitle={subtitle} titleStyle={styles.title} />

        <View style={styles.userBox}>
          <Text variant="bodyMedium" style={styles.userText}>
            {user?.username ?? ''}
          </Text>
        </View>
        <Appbar.Action icon="logout" onPress={clearAuth} accessibilityLabel="Çıkış" color="#fff" />
      </Appbar.Header>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  appbar: { backgroundColor: '#0f172a' },
  title: { color: '#fff', fontWeight: '700' },
  userBox: { paddingHorizontal: 12 },
  userText: { color: '#cbd5e1' },
  content: { flex: 1 },
});
