// =============================================================================
// Bekçi: yerel cihaz kimliği — "değer YOK" ile "OKUNAMADI" ayrımı (eşleme v2 §5.5 md. 5)
// =============================================================================
// NEGATİF SONDA (ölçüldü 2026-10-25): okuma hatası dalında `storage.setItem` çağrılınca 1 kırmızı (§2).
// =============================================================================
import { storage } from './storage';
import { __resetDeviceIdForTest, getOrCreateDeviceId, isEphemeralDeviceId } from './deviceId';

jest.mock('./storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), deleteItem: jest.fn() },
}));

const getItem = storage.getItem as jest.Mock;
const setItem = storage.setItem as jest.Mock;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('getOrCreateDeviceId', () => {
  beforeEach(() => {
    __resetDeviceIdForTest();
    getItem.mockReset();
    setItem.mockReset().mockResolvedValue(undefined);
  });

  it('§1 değer YOK → üretilir ve kalıcı yazılır', async () => {
    getItem.mockResolvedValue(null);
    const id = await getOrCreateDeviceId();
    expect(id).toMatch(UUID_RE);
    expect(setItem).toHaveBeenCalledWith('device_local_id', id);
    expect(isEphemeralDeviceId()).toBe(false);
  });

  it('§2 OKUNAMADI → kalıcı değer YAZILMAZ, oturum geçici kimlikle sürer', async () => {
    getItem.mockRejectedValue(new Error('Keystore kilitli'));
    const id = await getOrCreateDeviceId();
    expect(id).toMatch(UUID_RE);
    expect(setItem).not.toHaveBeenCalled();
    expect(isEphemeralDeviceId()).toBe(true);
    // Oturum boyu aynı geçici kimlik (her istek başka kimlik taşımasın).
    expect(await getOrCreateDeviceId()).toBe(id);
  });

  it('§3 var olan değer aynen döner, yazma yok', async () => {
    getItem.mockResolvedValue('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(await getOrCreateDeviceId()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('§4 yazma hatası önbelleğe yapışmaz (sonraki çağrı yeniden dener)', async () => {
    getItem.mockResolvedValue(null);
    setItem.mockRejectedValueOnce(new Error('yazılamadı'));
    await expect(getOrCreateDeviceId()).rejects.toThrow('yazılamadı');
    const id = await getOrCreateDeviceId();
    expect(id).toMatch(UUID_RE);
  });
});
