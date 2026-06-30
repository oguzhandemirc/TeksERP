// swatchService kartela ADET stok uçları doğru URL/body ile çağırıyor mu?
// (mobil apiClient baseURL'i /api içerir → yollar /kartela/stock biçimindedir.)
import { swatchService } from './swatch.service';
import { apiClient } from './api';

jest.mock('./api', () => ({
  apiClient: {
    get: jest.fn(() => Promise.resolve({ data: { success: true, data: [] } })),
    post: jest.fn(() => Promise.resolve({ data: { success: true, data: { reduced: 0 } } })),
  },
}));

const get = apiClient.get as unknown as jest.Mock;
const post = apiClient.post as unknown as jest.Mock;

describe('swatchService — kartela ADET stok', () => {
  beforeEach(() => {
    get.mockClear();
    post.mockClear();
  });

  it('getStock() aramasız → /kartela/stock (querysiz)', async () => {
    await swatchService.getStock();
    expect(get).toHaveBeenCalledWith('/kartela/stock');
  });

  it('getStock(search) → arama encode\'lu query', async () => {
    await swatchService.getStock('patos mavi');
    expect(get).toHaveBeenCalledWith('/kartela/stock?search=patos%20mavi');
  });

  it('reduceStock → POST /kartela/stock/reduce, body aynen geçer', async () => {
    const body = { itemId: 'i1', colorId: 'c1', count: 3, reason: 'kayıp' };
    await swatchService.reduceStock(body);
    expect(post).toHaveBeenCalledWith('/kartela/stock/reduce', body);
  });

  it('reduceStock renksiz grup (colorId null) gönderebilir', async () => {
    const body = { itemId: 'i1', colorId: null, count: 1, reason: 'hasar' };
    await swatchService.reduceStock(body);
    expect(post).toHaveBeenCalledWith('/kartela/stock/reduce', body);
  });
});
