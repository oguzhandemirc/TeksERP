// İster 2.8: Tambur açık kart listesi istasyon parametresi — oturum TAMBUR istasyonundaysa
// gönderilir, istasyon bilinmiyorsa/başka türse HİÇ gönderilmez (bugünkü liste).
import { resolveTamburListStationId } from './tamburStationFilter';
import { tamburService } from '../../../services/tambur.service';
import { apiClient } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  apiClient: {
    get: jest.fn(() => Promise.resolve({ data: { success: true, data: [] } })),
  },
}));

const get = apiClient.get as unknown as jest.Mock;
const station = (kind: string) => ({ id: 'st-2', code: 'TAMBUR-2', name: 'Tambur-2', kind });

describe('resolveTamburListStationId', () => {
  it('TAMBUR oturumunda istasyon kimliği döner', () => {
    expect(resolveTamburListStationId({ stationId: 'st-2', station: station('TAMBUR') })).toBe('st-2');
  });
  it('oturum yoksa null (parametresiz liste)', () => {
    expect(resolveTamburListStationId(null)).toBeNull();
    expect(resolveTamburListStationId(undefined)).toBeNull();
  });
  it('TAMBUR olmayan oturum istasyonunda null (backend 400 vermesin)', () => {
    expect(resolveTamburListStationId({ stationId: 'st-k', station: station('PROCESS_QC') })).toBeNull();
  });
});

describe('tamburService.listOpenCards istasyon parametresi', () => {
  beforeEach(() => get.mockClear());

  it('istasyon varsa stationId sorgu parametresi gönderilir', async () => {
    await tamburService.listOpenCards('st-2');
    expect(get).toHaveBeenCalledWith('/tambur/open-cards', { params: { stationId: 'st-2' } });
  });

  it('istasyon yoksa parametre gönderilmez', async () => {
    await tamburService.listOpenCards(null);
    await tamburService.listOpenCards();
    expect(get).toHaveBeenNthCalledWith(1, '/tambur/open-cards', undefined);
    expect(get).toHaveBeenNthCalledWith(2, '/tambur/open-cards', undefined);
  });
});
