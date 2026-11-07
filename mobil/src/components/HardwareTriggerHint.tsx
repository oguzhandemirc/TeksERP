// Donanım okuyucu modunda OKUT/kamera düğmesinin yerine geçen bilgi bandı: ekran tuş okumasını zaten
// dinliyor, operatöre yalnız "tuşa bas" denir (dokunulacak bir şey yok).
import { palette } from '../theme/tokens';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface Props {
  busy?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export default function HardwareTriggerHint({ busy = false, label = 'Okuyucu tuşuna basın', style }: Props) {
  return (
    <View style={[styles.band, style]} testID="hardware-trigger-hint" accessibilityRole="text">
      {busy ? (
        <ActivityIndicator size="small" color={palette.indigo[700]} />
      ) : (
        <MaterialCommunityIcons name="barcode-scan" size={24} color={palette.indigo[700]} />
      )}
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    minHeight: 56,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: palette.indigo[200],
    backgroundColor: palette.indigo[50],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  text: { color: palette.indigo[700], fontSize: 16, fontWeight: '700' },
});
