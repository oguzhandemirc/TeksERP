// Belge kamerası fener düğmesi (≥56dp, koyu zemin üstünde): dört kamera yüzeyi aynı görünümü kullanır.
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { IconButton } from 'react-native-paper';
import { colors, palette, radius } from '../../../theme';

export default function TorchButton({ on, onPress, style, testID }: { on: boolean; onPress: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <IconButton
      icon={on ? 'flashlight' : 'flashlight-off'}
      size={28}
      iconColor={on ? palette.amber[500] : colors.textOnDark}
      onPress={onPress}
      style={[styles.btn, style]}
      accessibilityLabel="Flaş"
      accessibilityState={{ checked: on }}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  btn: { width: 56, height: 56, margin: 0, borderRadius: radius.full, backgroundColor: colors.scrim },
});
