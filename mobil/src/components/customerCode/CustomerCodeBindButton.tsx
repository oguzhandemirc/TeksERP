// Kesim sonrası etiket kartında "Müşteri etiketini okut" ikonu — yalnız bağlanabilir topta çizilir (D4-F4).
import React from 'react';
import { IconButton } from 'react-native-paper';
import { colors } from '../../theme/tokens';
import { useCustomerCodeBindable } from './useCustomerCodeBindable';

export function CustomerCodeBindButton({ ownerCustomerId, onPress }: { ownerCustomerId: string | null | undefined; onPress: () => void }) {
  const bindable = useCustomerCodeBindable(ownerCustomerId);
  if (!bindable) return null;
  return (
    <IconButton
      icon="barcode-scan"
      mode="contained"
      size={22}
      containerColor={colors.warningDark}
      iconColor={colors.textOnDark}
      onPress={onPress}
      accessibilityLabel="Müşteri etiketini okut"
      testID="customer-code-bind-icon"
      style={{ margin: 0 }}
    />
  );
}
