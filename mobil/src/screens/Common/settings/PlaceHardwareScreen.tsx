// =============================================================================
// Ayarlar → Bu Yerin Donanımı
// =============================================================================
// Aktif çalışma oturumunun yerine (makine/istasyon) bağlı cihazların SALT-OKUNUR
// teşhis listesi. İçerik `SessionHardwareCard`'ta; burası yalnız sayfa kabuğu.
// Sayfaya girildiğinde liste HER ZAMAN tazelenir (kart içindeki query
// `refetchOnMount: 'always'`), ayrıca kartta manuel "Yenile" var — admin yeni
// cihaz atadığında operatör uygulamayı yeniden başlatmak zorunda kalmasın.
// =============================================================================

import React from 'react';
import SessionHardwareCard from '../../../components/session/SessionHardwareCard';
import { SettingsPage } from './settingsUi';

export default function PlaceHardwareScreen() {
  return (
    <SettingsPage title="Bu Yerin Donanımı">
      <SessionHardwareCard />
    </SettingsPage>
  );
}
