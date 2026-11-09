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

  it('müşteri parti no (labelBatchNo) dört kesim/bitir gövdesine geçer — sessiz allowlist bekçisi', async () => {
    await tamburService.cutOpenFabric('r1', { lengthMeters: 5, status: 'WAREHOUSE', labelBatchNo: 'J1' });
    await tamburService.cutWarehouseRoll('r2', { cutLength: 5, labelBatchNo: 'J1' });
    await tamburService.finalizeOpenFabric('r3', { remainingAction: 'keep_1kalite', labelBatchNo: 'J1' });
    await tamburService.finalizeWarehouseCut('r4', { remainingAction: 'keep_a1', labelBatchNo: 'J1' });
    expect(post).toHaveBeenCalledTimes(4);
    for (const call of post.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ labelBatchNo: 'J1' }));
    }
  });

  it('etiket kumaş adı / renk dört kesim/bitir gövdesine geçer — sessiz allowlist bekçisi', async () => {
    const L = { labelItemName: 'SULTAN', labelColorName: 'EKRU' };
    await tamburService.cutOpenFabric('r1', { lengthMeters: 5, status: 'WAREHOUSE', ...L });
    await tamburService.cutWarehouseRoll('r2', { cutLength: 5, ...L });
    await tamburService.finalizeOpenFabric('r3', { remainingAction: 'keep_1kalite', ...L });
    await tamburService.finalizeWarehouseCut('r4', { remainingAction: 'keep_a1', ...L });
    expect(post).toHaveBeenCalledTimes(4);
    for (const call of post.mock.calls) expect(call[1]).toEqual(expect.objectContaining(L));
  });
});
