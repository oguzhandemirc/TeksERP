// BEKÇİ — tablet sevkiyat kurma GÖVDESİ (2026-09-23; panel turu SY2'nin tablet ikizi — tablette
// gerçek tur yok, sınıf yalnız statik yakalanır). `destinationChosen` düşerse ilk sevk seçimi karta
// YAZILMAZ. Negatif sonda: servis gövdeyi `{ ...body, destinationChosen: undefined }` ile gönderdi → ⭐ ×.
import { packingService } from './packing.service';
import { apiClient } from './api';

jest.mock('./api', () => ({
  apiClient: { post: jest.fn(() => Promise.resolve({ data: { success: true, data: { id: 's1', shipmentNo: 'S1', dispatched: true } } })) },
}));
const post = apiClient.post as unknown as jest.Mock;
const govde = () => post.mock.calls.at(-1)?.[1] as Record<string, unknown>;

describe('packingService.createShipmentFromSacks gövdesi', () => {
  beforeEach(() => post.mockClear());
  it('⭐ açık niyet gövdeye girer', async () => {
    await packingService.createShipmentFromSacks({ sackIds: ['k1'], customerId: 'c1', destination: 'EXPORT', destinationChosen: true });
    expect(post.mock.calls.at(-1)?.[0]).toBe('/shipping/shipments');
    expect(govde().destinationChosen).toBe(true);
    expect(govde().destination).toBe('EXPORT');
  });
  it('niyet yoksa anahtar gitmez', async () => {
    await packingService.createShipmentFromSacks({ sackIds: ['k1'], customerId: 'c1', destination: 'DOMESTIC' });
    expect(govde().destinationChosen).toBeUndefined();
  });
});
