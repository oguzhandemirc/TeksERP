// =============================================================================
// Bekçi: mükerrer seçim modalı GERÇEKTEN ÇİZİLEBİLİYOR mu
// =============================================================================
// Saha çökmesi (2026-08-12, APK 2.5.0 yerel testi): modal İLK tetiklenişinde
// uygulamayı kapattı — `renderChoice`teki TouchableRipple İKİ doğrudan çocuk
// taşıyordu ([choiceInner, scrim]) ve React.Children.only her açılışta fırladı.
// Guard bayrağı 2026-08-05'ten beri canlıda AÇIK olduğu hâlde fark edilmedi,
// çünkü 90 sn penceresi gerçek akışta hiç dolmadı ve bekçi yalnız METİN
// sabitlerini ölçüyordu (`duplicateEntryChoice.test.ts`) — render hiç.
// Bu dosya dört durumu da fiilen çizer; kırılırsa modal yine sessizce ölür.
// =============================================================================

import React, { type ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SimplePortalHost } from '../../../components/SimplePortal';

// KK1Screen import zinciri native modüller çeker — render bekçisinin konusu
// değiller, jest ortamında yüklenemeyenler mock'lanır (scanFeedback.test emsali).
jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 1, Warning: 2, Error: 3 },
  ImpactFeedbackStyle: { Light: 1 },
}));
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [null, jest.fn()] }));
jest.mock('expo-print', () => ({ printAsync: jest.fn() }));
jest.mock('react-native-bluetooth-classic', () => ({}));

import { EntryConflictModal } from './KK1Screen';

const metrics = {
  frame: { x: 0, y: 0, width: 800, height: 1280 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
// SimplePortalHost = App.tsx'teki kök modal katmanının testteki karşılığı.
// AppModal içeriğini SimplePortal host'a taşır; host yoksa modal hiçbir yerde
// çizilmez ve bu bekçi (tam da "modal GERÇEKTEN çiziliyor mu" sorusu) sessizce
// boşa düşerdi.
const Wrap = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <PaperProvider>
      {children}
      <SimplePortalHost />
    </PaperProvider>
  </SafeAreaProvider>
);

const base = {
  visible: true,
  barcode: 'T120826H0001',
  onPrintExisting: jest.fn(),
  onSaveAsNew: jest.fn(),
};

describe('EntryConflictModal — render bekçisi', () => {
  it('POSSIBLE_DUPLICATE: iki kart da çizilir (Children.only çökmesi yok)', () => {
    const { getByText } = render(
      <EntryConflictModal {...base} kind="POSSIBLE_DUPLICATE" printing={false} />,
      { wrapper: Wrap },
    );
    expect(getByText('Bu top kayıtlı mı, yeni mi?')).toBeTruthy();
    expect(getByText('T120826H0001')).toBeTruthy();
  });

  it('TOKEN_COLLISION dalı da çizilir', () => {
    render(
      <EntryConflictModal {...base} kind="TOKEN_COLLISION" printing={false} />,
      { wrapper: Wrap },
    );
  });

  it('printing=true: busy kart + DIMMED kart (scrim dalı) birlikte çizilir', () => {
    // dimmed=true scrim'i AKTİF eder — çökmenin ikiz dalı: [View, <scrim>] da
    // Children.only'de dizidir. İki durum da tek sarmalayıcıdan geçmeli.
    const { getByText } = render(
      <EntryConflictModal {...base} kind="POSSIBLE_DUPLICATE" printing />,
      { wrapper: Wrap },
    );
    expect(getByText('ETİKET BASILIYOR…')).toBeTruthy();
  });

  it('visible=false: hiç çizilmez', () => {
    const { queryByText } = render(
      <EntryConflictModal {...base} visible={false} kind="POSSIBLE_DUPLICATE" printing={false} />,
      { wrapper: Wrap },
    );
    expect(queryByText('Bu top kayıtlı mı, yeni mi?')).toBeNull();
  });
});
