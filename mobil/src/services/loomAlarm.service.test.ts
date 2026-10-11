// "Benim alarmlarım" geri düşüşü: sorgu şeması `.strict()` olan eski sunucu `mine`ı 400 ile reddeder
// (ölçüldü: errors[0].message = 'Unrecognized key: "mine"'). İstemci parametresiz yeniden ister,
// süreç boyunca hatırlar; başka 400 düşmez (yanlış "tümü" gösterilmez).
import { apiClient } from './api';
import { isMineUnsupported, loomAlarmListQuery, loomAlarmService, resetMineSupport } from './loomAlarm.service';

jest.mock('./api', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const get = apiClient.get as unknown as jest.Mock;
const post = apiClient.post as unknown as jest.Mock;

const OK = { status: 200, data: { success: true, data: { items: [], nextCursor: null, summary: {} } } };
const MINE_400 = { status: 400, data: { success: false, message: 'Validasyon hatası', errors: [{ field: '', message: 'Unrecognized key: "mine"' }] } };
const OTHER_400 = { status: 400, data: { success: false, message: 'Validasyon hatası', errors: [{ field: 'scope', message: 'Geçersiz kapsam' }] } };
const urls = () => get.mock.calls.map((c) => c[0] as string);

describe('loomAlarmService.list — mine geri düşüşü', () => {
  beforeEach(() => {
    get.mockReset();
    resetMineSupport();
  });

  it('sunucu süzgeci tanıyorsa mine=1 gider, kapsam "mine"', async () => {
    get.mockResolvedValueOnce(OK);
    const r = await loomAlarmService.list({ scope: 'active', mine: true });
    expect(urls()).toEqual(['/loom-alarms?scope=active&mine=1']);
    expect(r.audience).toBe('mine');
  });

  it('400 "mine" → parametresiz yeniden ister ve süreç boyunca hatırlar', async () => {
    get.mockResolvedValueOnce(MINE_400).mockResolvedValueOnce(OK).mockResolvedValueOnce(OK);
    const r = await loomAlarmService.list({ scope: 'active', mine: true });
    expect(r.audience).toBe('all');
    expect(urls()).toEqual(['/loom-alarms?scope=active&mine=1', '/loom-alarms?scope=active']);
    await loomAlarmService.list({ scope: 'active', mine: true });
    expect(urls()[2]).toBe('/loom-alarms?scope=active');
  });

  it('başka bir 400 geri düşmez — hata fırlar', async () => {
    get.mockResolvedValueOnce(OTHER_400);
    await expect(loomAlarmService.list({ scope: 'active', mine: true })).rejects.toMatchObject({ status: 400 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('makine süzgeci ve mine:false sorguya doğru yazılır', () => {
    expect(loomAlarmListQuery({ scope: 'active', machineId: 'm 1', mine: false, limit: 100 }, true)).toBe('scope=active&machineId=m%201&limit=100');
  });

  it('isMineUnsupported yalnız 400 + "mine" anahtarı', () => {
    expect(isMineUnsupported(400, MINE_400.data)).toBe(true);
    expect(isMineUnsupported(400, OTHER_400.data)).toBe(false);
    expect(isMineUnsupported(403, MINE_400.data)).toBe(false);
    expect(isMineUnsupported(400, null)).toBe(false);
  });
});

describe('loomAlarmService eylemleri', () => {
  it('clientToken gövdede, yol alarm kimliğiyle', async () => {
    post.mockResolvedValue({ data: { success: true, data: { alarmId: 'a' } } });
    await loomAlarmService.snooze('a', 30, 'tok');
    expect(post).toHaveBeenLastCalledWith('/loom-alarms/a/snooze', { minutes: 30, clientToken: 'tok' });
    await loomAlarmService.retractNote('a', 'e', 'tok2');
    expect(post).toHaveBeenLastCalledWith('/loom-alarms/a/notes/e/retract', { clientToken: 'tok2' });
  });
});
