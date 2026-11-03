// K29 S15b: açık iş listesinde rotasız İE satırı rozeti + istek parametresi (yalnız Okutmayla kipinde).
import React from 'react';
import { renderWithPaper } from '../../../test/render';
import ScanRouteAddBadge from './ScanRouteAddBadge';
import { apiClient } from '../../../services/api';
import { kursunQcService } from '../../../services/kursunQc.service';
import { tamburService } from '../../../services/tambur.service';

describe('ScanRouteAddBadge', () => {
  it('⭐ rotasız satırda sunucu etiketiyle görünür', () => {
    const r = renderWithPaper(<ScanRouteAddBadge card={{ scanRouteAdd: true, scanRouteLabel: 'Sahada belirlenecek' }} testID="b" />);
    expect(r.getByText('Sahada belirlenecek')).toBeTruthy();
  });
  it('normal satırda / eski sunucuda çizilmez', () => {
    expect(renderWithPaper(<ScanRouteAddBadge card={{}} testID="b" />).queryByTestId('b')).toBeNull();
    expect(renderWithPaper(<ScanRouteAddBadge card={{ scanRouteAdd: false }} testID="b" />).queryByTestId('b')).toBeNull();
  });
});

describe('açık kart isteği includeScanRouted', () => {
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue({ data: { success: true, data: [] } } as never);
  beforeEach(() => get.mockClear());
  afterAll(() => get.mockRestore());

  it('⭐ Okutmayla: Kurşun/KK ve Tambur isteğine includeScanRouted=1', async () => {
    await kursunQcService.listOpenCards(undefined, true);
    await tamburService.listOpenCards('st-1', undefined, true);
    expect(get).toHaveBeenNthCalledWith(1, '/kursun-qc/open-cards', { params: { includeScanRouted: '1' } });
    expect(get).toHaveBeenNthCalledWith(2, '/tambur/open-cards', { params: { stationId: 'st-1', includeScanRouted: '1' } });
  });
  it('sıralı (varsayılan): istek bayt-aynı', async () => {
    await kursunQcService.listOpenCards();
    await kursunQcService.listOpenCards('ab');
    await tamburService.listOpenCards(null);
    expect(get).toHaveBeenNthCalledWith(1, '/kursun-qc/open-cards', undefined);
    expect(get).toHaveBeenNthCalledWith(2, '/kursun-qc/open-cards', { params: { q: 'ab' } });
    expect(get).toHaveBeenNthCalledWith(3, '/tambur/open-cards', undefined);
  });
});
