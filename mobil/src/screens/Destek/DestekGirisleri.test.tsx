// KAPALIYKEN GÖRÜNMEZLİK: `/durum` etkin:false ya da uç yok (404) → destek
// girişi/rozeti çizilmez ve /durum dışında HİÇBİR destek isteği atılmaz.
// Açıkken rozet hatası sessiz: toast yok, giriş yerinde kalır.
// ⭐ NEGATİF SONDA (2026-11-16, ölçüldü): `useDestekEtkin` koşulu `q.data !== undefined`'a
//    gevşetilince ❌2 (etkin:false ve 404 vakaları); sorgu oturmadan ölçen ilk yazım
//    bu sondada YEŞİL kalmıştı → `yerlesmeBekle` eklendi. Geri alındı, temiz ağaçta 5/5.
import { act, screen, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import { renderWithPaper } from '../../test/render';
import { destekService } from '../../services/destek.service';
import { useAuthStore } from '../../store/authStore';
import { DestekCipi, DestekRozetNoktasi } from './DestekGirisleri';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('react-native-view-shot', () => ({ captureScreen: jest.fn() }));
jest.mock('../../services/destek.service', () => ({
  destekService: { durum: jest.fn(), okunmamis: jest.fn() },
}));
const durum = destekService.durum as jest.Mock;
const okunmamis = destekService.okunmamis as jest.Mock;

/** Sorgu sonucunun render'a yansımasını bekle (aksi hâlde "görünmez" ölçümü erken ve KÖR olur). */
async function yerlesmeBekle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

function girisYap() {
  useAuthStore.setState({
    user: { userId: 'u-1', username: 'op', permissions: ['mobile:tambur'] },
    isLoading: false,
  } as never);
}

beforeEach(() => {
  durum.mockReset();
  okunmamis.mockReset();
  (Toast.show as jest.Mock).mockReset();
  girisYap();
});

it('etkin:false → çip yok, rozet yoklaması YOK', async () => {
  durum.mockResolvedValue({ etkin: false });
  renderWithPaper(<DestekCipi yalnizSimge={false} />);
  await waitFor(() => expect(durum).toHaveBeenCalledTimes(1));
  await yerlesmeBekle();
  expect(screen.queryByText('Destek')).toBeNull();
  expect(okunmamis).not.toHaveBeenCalled();
});

it('eski backend (404) → çip yok, rozet yoklaması YOK, toast YOK', async () => {
  durum.mockRejectedValue(Object.assign(new Error('Bulunamadı'), { status: 404 }));
  renderWithPaper(<DestekCipi yalnizSimge={false} />);
  await waitFor(() => expect(durum).toHaveBeenCalled());
  await yerlesmeBekle();
  expect(screen.queryByText('Destek')).toBeNull();
  expect(okunmamis).not.toHaveBeenCalled();
  expect(Toast.show).not.toHaveBeenCalled();
});

it('oturum yoksa /durum bile sorulmaz', async () => {
  useAuthStore.setState({ user: null } as never);
  renderWithPaper(<DestekCipi yalnizSimge={false} />);
  await yerlesmeBekle();
  expect(durum).not.toHaveBeenCalled();
  expect(screen.queryByText('Destek')).toBeNull();
});

it('etkin:true → çip ve okunmamış sayısı görünür', async () => {
  durum.mockResolvedValue({ etkin: true });
  okunmamis.mockResolvedValue({ count: 3, tickets: 2 });
  renderWithPaper(<DestekCipi yalnizSimge={false} />);
  expect(await screen.findByText('Destek')).toBeTruthy();
  expect(await screen.findByText('2')).toBeTruthy();
});

it('rozet yoklaması 502 → sessiz: toast yok, çip yerinde, nokta yok', async () => {
  durum.mockResolvedValue({ etkin: true });
  okunmamis.mockRejectedValue(Object.assign(new Error('x'), { status: 502, details: { code: 'DESTEK_ULASILAMADI' } }));
  renderWithPaper(
    <>
      <DestekCipi yalnizSimge={false} />
      <DestekRozetNoktasi />
    </>,
  );
  expect(await screen.findByText('Destek')).toBeTruthy();
  await waitFor(() => expect(okunmamis).toHaveBeenCalled());
  await yerlesmeBekle();
  expect(Toast.show).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Yeni destek yanıtı var')).toBeNull();
});
