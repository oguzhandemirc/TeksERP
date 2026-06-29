// tamburService kesim çağrıları etiket NİYETİNİ (targetCustomerId/OrderLineId)
// POST gövdesine geçiriyor mu? Regresyon guard'ı: niyet backend'e ulaşmazsa
// kesimde lastLabelSnapshot seed edilemez ("etiket geçerli olmuyor" sınıfı bug).

import { tamburService } from './tambur.service';
import { apiClient } from './api';

jest.mock('./api', () => ({
  apiClient: {
    post: jest.fn(() => Promise.resolve({ data: { success: true, data: {} } })),
  },
}));

const post = apiClient.post as unknown as jest.Mock;

describe('tamburService kesim — etiket niyeti gövdede', () => {
  beforeEach(() => post.mockClear());

  it('cutWarehouseRoll targetCustomerId + targetOrderLineId gövdeye geçer', async () => {
    await tamburService.cutWarehouseRoll('roll-1', {
      cutLength: 10,
      targetCustomerId: 'cust-1',
      targetOrderLineId: null,
    });
    expect(post).toHaveBeenCalledWith(
      '/tambur/roll-1/cut-warehouse',
      expect.objectContaining({ targetCustomerId: 'cust-1', targetOrderLineId: null }),
    );
  });

  it('cutOpenFabric targetCustomerId gövdeye geçer', async () => {
    await tamburService.cutOpenFabric('roll-2', {
      lengthMeters: 5,
      status: 'WAREHOUSE',
      targetCustomerId: 'cust-2',
    });
    expect(post).toHaveBeenCalledWith(
      '/tambur/roll-2/cut',
      expect.objectContaining({ targetCustomerId: 'cust-2' }),
    );
  });
});
