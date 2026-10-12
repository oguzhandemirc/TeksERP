// Cihaz kanıtı istemci ikizi: backend biçimiyle BAYT-EŞİT (Node crypto ile çapraz ölçülür),
// yol/sorgu ayrımı, sır saklama, saat hizası ve ret tanıması.
import { createHmac } from 'crypto';
import * as SecureStore from 'expo-secure-store';
import { buildDeviceProof, hmacSha256Hex, proofPathOf } from '../lib/device-proof';
import {
  __resetDeviceProofForTests, deviceProofFor, getDeviceSecret, isProofRejection, noteServerDate, rememberDeviceSecret,
} from './deviceProof';

const SIR = 'a1'.repeat(32);
const nodeProof = (secret: string, ts: number, method: string, path: string): string =>
  `v1.${ts}.${createHmac('sha256', Buffer.from(secret, 'hex')).update(`v1\n${ts}\n${method}\n${path}`, 'utf8').digest('hex')}`;

describe('cihaz kanıtı (istemci)', () => {
  beforeEach(() => {
    __resetDeviceProofForTests();
    (SecureStore.getItemAsync as jest.Mock).mockReset().mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('HMAC-SHA256 Node ile aynı (kısa, uzun anahtar, Türkçe ileti)', () => {
    for (const key of ['', 'k', 'x'.repeat(64), 'y'.repeat(100)]) {
      const bytes = [...Buffer.from(key, 'utf8')];
      const msg = `şğüİ yol ${key.length}`;
      expect(hmacSha256Hex(bytes, msg)).toBe(createHmac('sha256', Buffer.from(key, 'utf8')).update(msg, 'utf8').digest('hex'));
    }
  });

  it('başlık biçimi backend ile bayt-eşit', () => {
    const ts = 1_760_000_000_123;
    expect(buildDeviceProof(SIR, ts, 'POST', '/api/auth/login-quick-pin')).toBe(nodeProof(SIR, ts, 'POST', '/api/auth/login-quick-pin'));
  });

  it('imzalanan yol: köken, sorgu ve parça atılır', () => {
    expect(proofPathOf('https://10.0.0.5:4443/api/rolls?x=1#a')).toBe('/api/rolls');
    expect(proofPathOf('http://h/api/devices/status')).toBe('/api/devices/status');
    expect(proofPathOf('/api/x?y')).toBe('/api/x');
  });

  it('sır yokken kanıt üretilmez; status cevabındaki sır saklanır ve kullanılır', async () => {
    expect(await deviceProofFor('get', 'https://h/api/rolls')).toBeNull();
    await rememberDeviceSecret({ data: { status: 'APPROVED', deviceSecret: SIR } });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('device_proof_secret', SIR);
    expect(await getDeviceSecret()).toBe(SIR);
    const now = 1_760_000_000_000;
    expect(await deviceProofFor('post', 'https://h/api/auth/login-quick-pin?z=1', now)).toBe(
      nodeProof(SIR, now, 'POST', '/api/auth/login-quick-pin'),
    );
  });

  it('biçimsiz sır yok sayılır', async () => {
    await rememberDeviceSecret({ data: { deviceSecret: 'kısa' } });
    await rememberDeviceSecret({ data: {} });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('saat sunucu Date başlığına hizalanır', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(SIR);
    const local = Date.parse('2026-10-12T10:00:00Z');
    noteServerDate('Sun, 12 Oct 2026 10:30:00 GMT', local);
    const proof = await deviceProofFor('get', '/api/x', local);
    expect(proof?.split('.')[1]).toBe(String(local + 30 * 60 * 1000));
  });

  it('yalnız 401 DEVICE_PROOF_INVALID yeniden deneme tetikler', () => {
    expect(isProofRejection(401, { details: { code: 'DEVICE_PROOF_INVALID' } })).toBe(true);
    expect(isProofRejection(401, { details: { code: 'DEVICE_INACTIVE' } })).toBe(false);
    expect(isProofRejection(403, { details: { code: 'DEVICE_PROOF_INVALID' } })).toBe(false);
  });
});
