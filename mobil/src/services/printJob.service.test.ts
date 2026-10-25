// =============================================================================
// Bekçi: basım rapor kuyruğu (izlenebilirlik A4)
// =============================================================================
// Sözleşme: çevrimdışında biriken rapor bağlantı gelince TEK satır olarak düşer — token
// mantıksal deneme başına bir kez üretilir ve yeniden denemede AYNI kalır (sunucu replay).
// Sahte sunucu `clientToken`la satır tutar: yanıtı kaybolan (commit olmuş) istek yeniden
// gelirse yeni satır doğurmaz — token yeniden üretilirse doğurur (mükerrer = kırmızı).
//
// NEGATİF SONDA (2026-10-25, md5 ile geri alındı): `flushPrintReports` gönderimde
// `{...item.body, clientToken: generateClientUuid()}` → "yanıtı kaybolan rapor",
// "çevrimdışı birikim" + "kalıcılık" testleri ❌ (3 kırmızı / 11 yeşil; sunucuda 2 satır).
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import { apiClient } from './api';
import { useAuthStore } from '../store/authStore';
import {
  PRINT_REPORT_MAX,
  PRINT_REPORT_TTL_MS,
  __resetPrintReportsForTests,
  btTarget,
  flushPrintReports,
  hydratePrintReports,
  installPrintReportFlush,
  printErrorCode,
  printJobAttachment,
  reportPrintJob,
  reportPrintOutcome,
  usePrintReports,
  type PrintReportBody,
} from './printJob.service';

jest.mock('./api', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '9.9.9' } } }));

const post = apiClient.post as jest.Mock;

/** Sahte sunucu: `clientToken @unique` + replay (aynı token yeni satır doğurmaz). */
const rows = new Map<string, PrintReportBody>();
function serverAccepts(body: PrintReportBody): Promise<unknown> {
  if (!rows.has(body.clientToken)) rows.set(body.clientToken, body);
  return Promise.resolve({ data: { success: true } });
}
const err = (status?: number) => Object.assign(new Error(`HTTP ${status ?? 'ağ'}`), status ? { status } : {});

const HATA = {
  subjectKind: 'ETIKET_TOP' as const,
  subjectTable: 'rolls' as const,
  subjectId: '11111111-1111-4111-8111-111111111111',
  status: 'HATA' as const,
  transport: 'BLUETOOTH' as const,
  printerName: 'KK1 Yazıcı',
  printerAddress: '00:11:22:33:44:55',
  errorCode: 'BT_BAGLANTI',
  errorMessage: 'Yazıcıya bağlanılamadı',
};

async function settle(): Promise<void> {
  await flushPrintReports().catch(() => undefined);
}

beforeEach(async () => {
  rows.clear();
  post.mockReset();
  post.mockImplementation((_url: string, body: PrintReportBody) => serverAccepts(body));
  __resetPrintReportsForTests();
  await AsyncStorage.clear();
  onlineManager.setOnline(true);
  useAuthStore.setState({ token: 'jwt', user: { userId: 'u1', username: 'op', permissions: [] } });
});

describe('basım rapor kuyruğu — gönderim', () => {
  it('çevrimdışı birikim → çevrimiçi olunca her rapor TEK satır, kuyruk boşalır', async () => {
    onlineManager.setOnline(false);
    reportPrintJob(HATA);
    reportPrintJob({ ...HATA, status: 'IPTAL', errorCode: undefined });
    await settle();
    expect(post).not.toHaveBeenCalled();
    expect(usePrintReports.getState().items).toHaveLength(2);

    onlineManager.setOnline(true);
    // Bağlantı gelince ilk deneme yanıtsız kalır (sunucu yazdı, yanıt kayboldu).
    post.mockImplementationOnce(async (_u: string, body: PrintReportBody) => {
      await serverAccepts(body);
      throw err();
    });
    await settle();
    expect(usePrintReports.getState().items).toHaveLength(2); // belirsiz → kalır, tur durur
    await settle();
    expect(usePrintReports.getState().items).toHaveLength(0);
    expect(rows.size).toBe(2);
    const sent = post.mock.calls.map((c) => (c[1] as PrintReportBody).clientToken);
    expect(sent[0]).toBe(sent[1]); // yeniden deneme AYNI token
  });

  it('yanıtı kaybolan rapor üç kez denense de sunucuda tek satır', async () => {
    post.mockImplementation(async (_u: string, body: PrintReportBody) => {
      await serverAccepts(body);
      throw err(503);
    });
    reportPrintJob(HATA);
    await settle();
    await settle();
    post.mockImplementation((_u: string, body: PrintReportBody) => serverAccepts(body));
    await settle();
    expect(post).toHaveBeenCalledTimes(3);
    expect(rows.size).toBe(1);
    expect(usePrintReports.getState().items).toHaveLength(0);
  });

  it('gövde: kaynak, sürüm, MAC ve Türkçe neden taşınır', async () => {
    reportPrintJob(HATA);
    await settle();
    const body = post.mock.calls[0]![1] as PrintReportBody;
    expect(post.mock.calls[0]![0]).toBe('/print-jobs');
    expect(body).toMatchObject({
      status: 'HATA',
      errorCode: 'BT_BAGLANTI',
      printerAddress: '00:11:22:33:44:55',
      printerName: 'KK1 Yazıcı',
      appVersion: '9.9.9',
    });
    expect(['TABLET', 'TELEFON']).toContain(body.source);
    expect(body.clientToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('kesin 4xx → düşer (sayaç), sıradaki rapor gönderilir', async () => {
    onlineManager.setOnline(false);
    reportPrintJob(HATA);
    reportPrintJob(HATA);
    onlineManager.setOnline(true);
    post.mockImplementationOnce(() => Promise.reject(err(400)));
    await settle();
    expect(usePrintReports.getState().items).toHaveLength(0);
    expect(usePrintReports.getState().drops.rejected).toBe(1);
    expect(rows.size).toBe(1);
  });

  it('404 (eski backend) sessiz düşer', async () => {
    post.mockImplementation(() => Promise.reject(err(404)));
    reportPrintJob(HATA);
    await settle();
    expect(usePrintReports.getState().items).toHaveLength(0);
    expect(usePrintReports.getState().drops.unsupported).toBe(1);
  });
});

describe('basım rapor kuyruğu — oturum, ömür, kalıcılık', () => {
  it('401 → kalır (oturum açılınca gider); oturumsuzken hiç gönderilmez', async () => {
    post.mockImplementationOnce(() => Promise.reject(err(401)));
    reportPrintJob(HATA);
    await settle();
    expect(usePrintReports.getState().items).toHaveLength(1);
    useAuthStore.setState({ token: null, user: null });
    post.mockClear();
    await settle();
    expect(post).not.toHaveBeenCalled();
  });

  it('başka kullanıcının raporu onun oturumunu bekler', async () => {
    onlineManager.setOnline(false);
    reportPrintJob(HATA);
    onlineManager.setOnline(true);
    useAuthStore.setState({ token: 'jwt2', user: { userId: 'u2', username: 'b', permissions: [] } });
    await settle();
    expect(post).not.toHaveBeenCalled();
    useAuthStore.setState({ token: 'jwt', user: { userId: 'u1', username: 'op', permissions: [] } });
    await settle();
    expect(rows.size).toBe(1);
  });

  it('TTL: 48 saati aşan rapor düşer ve sayılır', async () => {
    onlineManager.setOnline(false);
    reportPrintJob(HATA);
    const old = usePrintReports.getState().items.map((i) => ({ ...i, queuedAt: Date.now() - PRINT_REPORT_TTL_MS - 1 }));
    usePrintReports.setState({ items: old });
    reportPrintJob(HATA);
    expect(usePrintReports.getState().items).toHaveLength(1);
    expect(usePrintReports.getState().drops.ttl).toBe(1);
  });

  it('tavan: 200 üstünde en eski düşer', async () => {
    onlineManager.setOnline(false);
    for (let i = 0; i < PRINT_REPORT_MAX + 5; i++) reportPrintJob({ ...HATA, subjectNo: `T${i}` });
    const items = usePrintReports.getState().items;
    expect(items).toHaveLength(PRINT_REPORT_MAX);
    expect(items[0]!.body.subjectNo).toBe('T5');
    expect(usePrintReports.getState().drops.cap).toBe(5);
  });

  it('kalıcılık: diskteki kuyruk yeniden açılışta yüklenir ve aynı token gider', async () => {
    onlineManager.setOnline(false);
    const token = reportPrintJob(HATA);
    await new Promise((r) => setTimeout(r, 0));
    __resetPrintReportsForTests();
    await hydratePrintReports();
    expect(usePrintReports.getState().items.map((i) => i.body.clientToken)).toEqual([token]);
    onlineManager.setOnline(true);
    await settle();
    expect([...rows.keys()]).toEqual([token]);
  });

  it('geç biten hydrate gönderilmiş raporu diskten geri getirmez', async () => {
    const token = reportPrintJob(HATA); // çevrimiçi: hemen gider; disk yazımı eski hâli tutabilir
    await settle();
    expect(rows.has(token)).toBe(true);
    await AsyncStorage.setItem('TEKSERP_PRINT_REPORTS_V1', JSON.stringify({ items: [{ body: { ...HATA, clientToken: token, source: 'TABLET' }, userId: 'u1', queuedAt: Date.now() }] }));
    usePrintReports.setState({ hydrated: false });
    await hydratePrintReports();
    expect(usePrintReports.getState().items).toHaveLength(0);
  });

  it('çevrimiçi kenarı kuyruğu kendiliğinden boşaltır', async () => {
    installPrintReportFlush();
    onlineManager.setOnline(false);
    reportPrintJob(HATA);
    onlineManager.setOnline(true);
    await new Promise((r) => setTimeout(r, 0));
    await settle();
    expect(rows.size).toBe(1);
  });
});

describe('basım akışı yardımcıları', () => {
  it('adım → hata kodu; zaman aşımı adımdan önce gelir', () => {
    expect(printErrorCode('pair', new Error('bond failed'))).toBe('BT_ESLESME');
    expect(printErrorCode('send', new Error('socket closed'))).toBe('BT_BAGLANTI');
    expect(printErrorCode('fetch', err(500))).toBe('ICERIK_ALINAMADI');
    expect(printErrorCode('lang', new Error('Yazıcının dili çözülemedi'))).toBe('DIL_COZULEMEDI');
    expect(printErrorCode('send', new Error('Read timed out'))).toBe('ZAMAN_ASIMI');
    expect(printErrorCode('dialog', new Error('x'))).toBe('BILINMEYEN');
  });

  it('iş ucu künyesi: BT hedefi, süre, taze token', () => {
    const t = btTarget({ id: '22222222-2222-4222-8222-222222222222', name: 'Çuval Yazıcı', address: 'AA:BB:CC:DD:EE:FF' });
    const a = printJobAttachment(t, Date.now() - 50, 2);
    const b = printJobAttachment(t, Date.now());
    expect(a).toMatchObject({ transport: 'BLUETOOTH', printerName: 'Çuval Yazıcı', printerAddress: 'AA:BB:CC:DD:EE:FF', copies: 2 });
    expect(a.durationMs).toBeGreaterThanOrEqual(0);
    expect(a.clientToken).not.toBe(b.clientToken);
  });

  it('reportPrintOutcome: HATA kod + mesaj taşır, IPTAL taşımaz', async () => {
    onlineManager.setOnline(false);
    const subject = { subjectKind: 'ETIKET_CUVAL' as const, subjectTable: 'sacks' as const, subjectId: '33333333-3333-4333-8333-333333333333' };
    reportPrintOutcome({ subject, target: { transport: 'BLUETOOTH', printerAddress: 'AA' }, startedAt: Date.now(), status: 'HATA', step: 'pair', error: new Error('Eşleşme reddedildi') });
    reportPrintOutcome({ subject, target: { transport: 'SISTEM_PENCERESI' }, startedAt: Date.now(), status: 'IPTAL', step: 'dialog', error: new Error('did not complete') });
    const [h, i] = usePrintReports.getState().items.map((x) => x.body);
    expect(h).toMatchObject({ status: 'HATA', errorCode: 'BT_ESLESME', errorMessage: 'Eşleşme reddedildi', transport: 'BLUETOOTH' });
    expect(i!.status).toBe('IPTAL');
    expect(i!.errorCode).toBeUndefined();
  });
});
