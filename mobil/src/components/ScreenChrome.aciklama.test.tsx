// K24 — ekran açıklaması başlık altında satır kaplamaz; başlık yanındaki ⓘ'de
// erişilebilir ad olarak durur ve dokununca balonda okunur. Veri satırları
// (statusLine, makine adını taşıyan subtitle) görünür kalır.
import React from 'react';
import { BackHandler, Text } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithPaper } from '../test/render';
import ScreenChrome from './ScreenChrome';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), popTo: jest.fn() }),
  useRoute: () => ({ name: 'Uyarilar' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('./bildirim/NotificationBellButton', () => () => null);
jest.mock('./bildirim/NotificationStrip', () => () => null);
jest.mock('./session/PlaceChip', () => () => null);
jest.mock('./AppMenu', () => Object.assign(({ anchor }: { anchor: React.ReactNode }) => anchor, { Item: () => null }));
jest.mock('./LogoutModals', () => () => null);
jest.mock('./session/PlaceActions', () => ({
  usePlaceActions: () => ({ showMachine: false, showStation: false, expectedKind: null }),
  MachinePickerModal: () => null,
}));
jest.mock('../hooks/useVisibleScreens', () => ({ useVisibleScreens: () => ({ hasMultipleVisibleScreens: false }) }));
jest.mock('../hooks/useDeviceType', () => ({ useDeviceType: () => 'tablet' }));
jest.mock('../hooks/useLogout', () => ({
  useLogout: () => ({ confirm: null, setConfirm: jest.fn(), busy: false, runLogout: jest.fn(), requestLogout: jest.fn() }),
}));

const ACIKLAMA = 'Ham top okut → müşteri seç → sipariş';

describe('ScreenChrome — başlık altı açıklama (K24)', () => {
  it('subtitle başlık altında çizilmez; ⓘ erişilebilir adı açıklamadır, dokununca balonda', () => {
    renderWithPaper(
      <ScreenChrome title="Hızlı Sipariş" subtitle={ACIKLAMA}>
        <Text>içerik</Text>
      </ScreenChrome>,
    );
    expect(screen.queryByTestId('ekran-alt-baslik')).toBeNull();
    expect(screen.queryByText(ACIKLAMA)).toBeNull();
    const info = screen.getByLabelText(ACIKLAMA);
    fireEvent.press(info, { nativeEvent: { pageX: 100, pageY: 40 } });
    expect(screen.getByTestId('tam-ad-balonu')).toBeTruthy();
    expect(screen.getByText(ACIKLAMA)).toBeTruthy();
  });

  it('statusLine (durum/veri) başlık altında görünür kalır; ⓘ çıkmaz', () => {
    renderWithPaper(
      <ScreenChrome title="Uyarılar" statusLine="3 açık alarm">
        <Text>içerik</Text>
      </ScreenChrome>,
    );
    expect(screen.getByTestId('ekran-alt-baslik')).toBeTruthy();
    expect(screen.getByLabelText('3 açık alarm')).toBeTruthy();
    expect(screen.queryByTestId('ekran-aciklama')).toBeNull();
  });

  it('hidePlaceChip: subtitle makine adını taşır → görünür satırdır, ipucuna gizlenmez', () => {
    renderWithPaper(
      <ScreenChrome title="Tambur" subtitle="Tambur 2" hidePlaceChip>
        <Text>içerik</Text>
      </ScreenChrome>,
    );
    expect(screen.getByTestId('ekran-alt-baslik')).toBeTruthy();
    expect(screen.queryByTestId('ekran-aciklama')).toBeNull();
  });

  it('S12: hidePlaceChip + statusLine birlikte → makine adı da durum da görünür', () => {
    renderWithPaper(
      <ScreenChrome title="Kurşun" subtitle="KURŞUN MAKİNESİ 1" statusLine="2 açık kart" hidePlaceChip>
        <Text>içerik</Text>
      </ScreenChrome>,
    );
    expect(screen.getByLabelText('KURŞUN MAKİNESİ 1 · 2 açık kart')).toBeTruthy();
  });
});

describe('ScreenChrome — donanım geri tuşu = önceki adım', () => {
  it('onStepBack varsa geri tuşu onu çağırır ve olayı tüketir; yoksa ekrana (pop) bırakır', () => {
    type Handler = () => boolean | null | undefined;
    const handlers: Handler[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      handlers.push(h);
      return { remove: () => handlers.splice(handlers.indexOf(h), 1) };
    });
    try {
      const geri = jest.fn();
      const r = renderWithPaper(
        <ScreenChrome title="Hızlı İş Emri" onStepBack={geri}>
          <Text>içerik</Text>
        </ScreenChrome>,
      );
      expect(handlers).toHaveLength(1);
      expect(handlers[0]()).toBe(true);
      expect(geri).toHaveBeenCalledTimes(1);

      r.rerender(
        <ScreenChrome title="Hızlı İş Emri">
          <Text>içerik</Text>
        </ScreenChrome>,
      );
      expect(handlers[handlers.length - 1]()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
