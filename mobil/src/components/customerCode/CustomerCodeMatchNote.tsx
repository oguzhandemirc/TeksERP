// Okutulan kod topun İÇ barkodu değil, müşteri barkoduysa (D4-F1b `matchedBy`) operatöre söyler — hangi topun çözüldüğü görünür.
import React from 'react';
import { Text } from 'react-native-paper';
import { customerCodeMatchText, type ScanMatchExtras } from './customerCodeLogic';

export function CustomerCodeMatchNote({ match }: { match: ScanMatchExtras | null | undefined }) {
  const text = customerCodeMatchText(match);
  if (!text) return null;
  return (
    <Text testID="musteri-kodu-eslesme" variant="bodySmall" style={{ marginTop: 2 }}>
      {text}
    </Text>
  );
}
