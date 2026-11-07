import { apiClient } from './api';
import { rollService } from './roll.service';

jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));
const get = apiClient.get as jest.Mock;

describe('rollService.getWarehouseScope — mülkiyet süzgeci (T3)', () => {
  beforeEach(() => get.mockReset().mockResolvedValue({ data: { success: true } }));

  it('süzgeçsiz ve ALL dışı değer yokken eski URL (bayt-aynı)', async () => {
    await rollService.getWarehouseScope();
    await rollService.getWarehouseScope({});
    expect(get.mock.calls.map((c) => c[0])).toEqual(['/rolls/warehouse-scope', '/rolls/warehouse-scope']);
  });

  it('kapsam seçiliyse filter[mulkiyet] sarmalıyla gider', async () => {
    await rollService.getWarehouseScope({ mulkiyet: 'CONSIGNED' });
    expect(get).toHaveBeenCalledWith('/rolls/warehouse-scope?filter[mulkiyet]=CONSIGNED');
  });
});
