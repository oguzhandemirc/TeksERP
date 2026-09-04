// =============================================================================
// Bekçi: "Ağda Ara" — ilerleme DÜĞMENİN ÜSTÜNDE, sonuç ÇAĞIRANA bildirilir
// =============================================================================
// SAHA İSTEĞİ (2026-09-04): "ağda ara tuşuna basınca altta değil buton üstünde
// loading animasyonu ve yazı olsun, olumlu ya da olumsuz bildirimi ekrana toast
// olarak bas."
//
// Sıra ölçülüyor çünkü asıl arıza görsel değil DAVRANIŞSALDI: ilerleme satırı
// düğmenin ALTINDAYKEN, tarama ilerledikçe altına eklenen aday satırları onu
// aşağı itiyor ve küçük ekranda kadrajdan çıkarıyordu — operatör "hiçbir şey
// olmuyor" diyordu.
//
// ⚠️ Toast BU BİLEŞENDE basılmaz (kilit ekranında Toast katmanın altında kalır);
// bileşenin sözleşmesi `onResult`tur — bekçi de onu ölçer, toast'ı değil.
// =============================================================================

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { ServerDiscoveryList } from './ServerDiscoveryList';
import { discoverServers } from '../services/discovery.service';

jest.mock('../services/discovery.service', () => ({
  discoverServers: jest.fn(),
}));

const discoverMock = discoverServers as jest.MockedFunction<typeof discoverServers>;

function ciz(onResult = jest.fn(), onPick = jest.fn()) {
  render(
    <PaperProvider>
      <ServerDiscoveryList onPick={onPick} onResult={onResult} />
    </PaperProvider>,
  );
  return { onResult, onPick };
}

/** Render edilmiş ağaçtaki metin sırası = ekrandaki yerleşim sırası. */
function agactakiSira(metin: string): number {
  return JSON.stringify(screen.toJSON()).indexOf(metin);
}

beforeEach(() => {
  jest.useFakeTimers();
  discoverMock.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('ServerDiscoveryList', () => {
  it('§1 tarama sırasında ilerleme DÜĞMENİN ÜSTÜNDE çizilir', async () => {
    discoverMock.mockResolvedValue({ candidates: [] } as never);
    ciz();

    await act(async () => {
      fireEvent.press(screen.getByTestId('sunucu-ara'));
    });

    const ilerleme = agactakiSira('Ağ taranıyor');
    const dugmeEtiketi = agactakiSira('Aranıyor…'); // meşgul düğmenin etiketi
    expect(ilerleme).toBeGreaterThan(-1);
    expect(dugmeEtiketi).toBeGreaterThan(-1);
    expect(ilerleme).toBeLessThan(dugmeEtiketi);

    await act(async () => {
      jest.advanceTimersByTime(2500);
      await Promise.resolve();
    });
  });

  it('§2 sonuç ÇAĞIRANA bildirilir (boş küme dahil — sessiz kalmaz)', async () => {
    discoverMock.mockResolvedValue({ candidates: [] } as never);
    const { onResult } = ciz();

    await act(async () => {
      fireEvent.press(screen.getByTestId('sunucu-ara'));
    });
    // Asgari süre dolmadan bildirim YOK (spinner cevabı geçmesin).
    expect(onResult).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(onResult).toHaveBeenCalledWith([]);
  });

  it('§3 tarama patlarsa da bildirilir (sessiz yutulmaz)', async () => {
    discoverMock.mockRejectedValue(new Error('ağ yok'));
    const { onResult } = ciz();

    await act(async () => {
      fireEvent.press(screen.getByTestId('sunucu-ara'));
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(onResult).toHaveBeenCalledWith([]);
  });

  it('§4 "bulunamadı" metni ÇÖZÜM söyler (yalnız olumsuzluk değil)', async () => {
    discoverMock.mockResolvedValue({ candidates: [] } as never);
    ciz();
    await act(async () => {
      fireEvent.press(screen.getByTestId('sunucu-ara'));
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(screen.getByText(/elle yazıp/i)).toBeTruthy();
  });

  it('§5 tarama sürerken düğmeye tekrar basmak ikinci taramayı BAŞLATMAZ', async () => {
    discoverMock.mockResolvedValue({ candidates: [] } as never);
    ciz();
    await act(async () => {
      fireEvent.press(screen.getByTestId('sunucu-ara'));
      fireEvent.press(screen.getByTestId('sunucu-ara'));
    });
    expect(discoverMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
  });
});
