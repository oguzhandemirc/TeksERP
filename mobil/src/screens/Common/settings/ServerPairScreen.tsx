// Ayarlar → API Sunucusu → "Sunucuyu değiştir": tam ekran sunucu ekleme (QR ya da IP + doğrulama kodu).
import React from 'react';
import { useNavigation } from '@react-navigation/native';

import { ServerPairFlow } from '../../../components/serverPair/ServerPairFlow';
import { SettingsPage } from './settingsUi';

export default function ServerPairScreen() {
  const navigation = useNavigation();
  return (
    <SettingsPage title="Sunucuyu ekle / değiştir">
      <ServerPairFlow
        onDone={() => {
          if (navigation.canGoBack()) navigation.goBack();
        }}
      />
    </SettingsPage>
  );
}
