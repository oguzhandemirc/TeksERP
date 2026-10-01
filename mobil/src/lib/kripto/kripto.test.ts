// =============================================================================
// BEKÇİ: saf JS kripto (G6, `lib/kripto` — `@noble/curves` + `@noble/hashes` sarmalayıcısı) — node:crypto /
// RFC 8032 / Wycheproof KÂHİNİ
// =============================================================================
// ⚠️ NEDEN: Hermes'te node:crypto yok; tablet APK künyesi denetlenmiş noble ile doğrulanır ama KİPİ bizim
// seçimimizdir (RFC 8032 katı kip + küçük mertebeli R reddi). Sarmalayıcı bağımsız kâhinlerle ölçülür: SHA'lar node
// ile parça sınırlarında, Ed25519 RFC vektörleri, Wycheproof'un 151 kabul/ret beklentisi, node ile rastgele
// anahtar/bozulma ve KATI kurallar (küçük mertebe · kanonik kodlama · S < L) tek tek — gevşek kip (ZIP-215) kırmızı.
// =============================================================================
import crypto from 'node:crypto';
import { Sha256, hex, sha512 } from './sha2';
import { _testing, ed25519Verify } from './ed25519';
import wycheproof from '../../test/fixtures/wycheproof-ed25519.json';

function anahtar() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, x: publicKey.export({ format: 'jwk' }).x as string };
}

const IMZA = anahtar();
const YABANCI = anahtar();

describe('saf JS kripto — node:crypto kâhini', () => {
  it('SHA-256 akışlı: rastgele boy + rastgele parça sınırı node ile birebir', () => {
    const boylar = [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 65_537];
    for (const n of [...boylar, ...Array.from({ length: 40 }, (_, i) => (i * 7919) % 5000)]) {
      const m = crypto.randomBytes(n);
      const h = new Sha256();
      for (let o = 0; o < n; ) {
        const p = Math.min(n - o, 1 + ((o * 31 + n) % 131));
        h.update(m.subarray(o, o + p));
        o += p;
      }
      expect(hex(h.digest())).toBe(crypto.createHash('sha256').update(m).digest('hex'));
    }
  });

  it('SHA-512 node ile birebir (Ed25519 özeti)', () => {
    for (let n = 0; n < 300; n += 7) {
      const m = crypto.randomBytes(n);
      expect(hex(sha512(m))).toBe(crypto.createHash('sha512').update(m).digest('hex'));
    }
  });

  it('Ed25519 RFC 8032 §7.1 TEST 1 + TEST 2', () => {
    const v = [
      ['d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', '',
        'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'],
      ['3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c', '72',
        '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'],
    ];
    for (const [a, m, s] of v) {
      expect(ed25519Verify(Buffer.from(a, 'hex'), Buffer.from(m, 'hex'), Buffer.from(s, 'hex'))).toBe(true);
      const bozuk = Buffer.from(s, 'hex');
      bozuk[10] ^= 1;
      expect(ed25519Verify(Buffer.from(a, 'hex'), Buffer.from(m, 'hex'), bozuk)).toBe(false);
    }
  });

  it('Ed25519 rastgele anahtar/ileti: kabul ve her bozulma node ile aynı karar', () => {
    for (let i = 0; i < 25; i++) {
      const k = anahtar();
      const acik = Buffer.from(k.x, 'base64url');
      const m = crypto.randomBytes(20 + i);
      const s = crypto.sign(null, m, k.privateKey);
      expect(ed25519Verify(acik, m, s)).toBe(true);
      const s2 = Buffer.from(s);
      s2[i % 64] ^= 1 << (i % 8);
      expect(ed25519Verify(acik, m, s2)).toBe(crypto.verify(null, m, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: k.x }, format: 'jwk' }), s2));
      const m2 = Buffer.from(m);
      m2[0] ^= 1;
      expect(ed25519Verify(acik, m2, s)).toBe(false);
      expect(ed25519Verify(Buffer.from(YABANCI.x, 'base64url'), m, s)).toBe(false);
    }
  });

});

describe('Ed25519 — Wycheproof EdDSA vektörleri', () => {
  it('Wycheproof EdDSA (151 vektör): her kabul/ret beklentisi birebir — node:crypto da aynı', () => {
    const farklar: string[] = [];
    let sayi = 0;
    for (const g of wycheproof.gruplar) {
      const pk = Buffer.from(g.pk, 'hex');
      const nodeAnahtar = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pk.toString('base64url') }, format: 'jwk' });
      for (const t of g.testler) {
        sayi++;
        const m = Buffer.from(t.msg, 'hex');
        const sig = Buffer.from(t.sig, 'hex');
        const beklenen = t.sonuc === 'valid';
        if (ed25519Verify(pk, m, sig) !== beklenen) farklar.push(`#${t.id} ${t.bayrak.join(',')}`);
        let nodeKarar = false;
        try {
          nodeKarar = crypto.verify(null, m, nodeAnahtar, sig);
        } catch {
          nodeKarar = false;
        }
        if (nodeKarar !== beklenen) farklar.push(`node #${t.id}`);
      }
    }
    expect(sayi).toBe(151);
    expect(farklar).toEqual([]);
  });

});

describe('Ed25519 KATI kurallar — node:crypto\'dan sıkı olduğu yerler', () => {
  it('KATI: küçük mertebeli açık anahtar (birim nokta) ile HER iletiye geçen sahte imza reddedilir', () => {
    // A = O iken [k]A = O → R = [s]B her ileti için denklemi sağlar (kofaktörsüz gevşek doğrulayıcı kabul eder).
    const tohum = crypto.randomBytes(32);
    const h = crypto.createHash('sha512').update(tohum).digest();
    h[0] &= 248;
    h[31] &= 127;
    h[31] |= 64;
    let a = BigInt(0);
    for (let i = 31; i >= 0; i--) a = (a << BigInt(8)) | BigInt(h[i]);
    const L = (BigInt(1) << BigInt(252)) + BigInt('27742317777372353535851937790883648493');
    let sSay = a % L;
    const sB = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      sB[i] = Number(sSay & BigInt(0xff));
      sSay >>= BigInt(8);
    }
    const R = crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), tohum]), format: 'der', type: 'pkcs8' }))
      .export({ format: 'jwk' }).x as string;
    const sahte = Buffer.concat([Buffer.from(R, 'base64url'), sB]);
    const birim = Buffer.alloc(32);
    birim[0] = 1;
    for (const ileti of [Buffer.from('apk künyesi'), Buffer.from('başka ileti')]) expect(ed25519Verify(birim, ileti, sahte)).toBe(false);
  });

  it('KATI: küçük mertebeli A ya da R kodlaması ve kanonik olmayan y reddedilir', () => {
    const kucuk = [
      '0100000000000000000000000000000000000000000000000000000000000000',
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      '0000000000000000000000000000000000000000000000000000000000000000',
      '0000000000000000000000000000000000000000000000000000000000000080',
      '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
      '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
    ];
    const kanoniksiz = ['edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', 'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'];
    const acik = Buffer.from(IMZA.x, 'base64url');
    const m = Buffer.from('ileti');
    const s = crypto.sign(null, m, IMZA.privateKey);
    for (const e of [...kucuk, ...kanoniksiz]) {
      expect(ed25519Verify(Buffer.from(e, 'hex'), m, s)).toBe(false);
      expect(ed25519Verify(acik, m, Buffer.concat([Buffer.from(e, 'hex'), s.subarray(32)]))).toBe(false);
    }
    expect(ed25519Verify(acik, m, s)).toBe(true);
  });

});

describe('Ed25519 KATI kodlama — nokta çözümü birim ölçümü', () => {
  it('KATI kodlama: y ≥ p (kanonik olmayan) ve x=0 iken işaret biti 1 → geçersiz; küçük mertebe tanınır', () => {
    const le = (y: number, isaret = false): Buffer => {
      const b = Buffer.alloc(32);
      b[0] = y;
      if (isaret) b[31] |= 0x80;
      return b;
    };
    const pArti = (k: number): Buffer => {
      const b = Buffer.from('edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', 'hex');
      b[0] += k; // p + k (k ≤ 18) — y = k noktasının kanonik OLMAYAN kodlaması
      return b;
    };
    expect(_testing.isValidEncoding(le(3))).toBe(true);
    expect(_testing.isValidEncoding(pArti(3))).toBe(false);
    expect(_testing.isValidEncoding(le(1))).toBe(true);
    expect(_testing.isValidEncoding(le(1, true))).toBe(false); // birim noktada x = 0 → işaret biti 1 olamaz
    expect(_testing.isValidEncoding(le(2))).toBe(false); // eğri üzerinde değil
    expect(_testing.isSmallOrder(le(3))).toBe(false);
    expect(_testing.isSmallOrder(Buffer.from(IMZA.x, 'base64url'))).toBe(false);
    for (const e of ['0100000000000000000000000000000000000000000000000000000000000000', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      '0000000000000000000000000000000000000000000000000000000000000000', '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a']) {
      expect(_testing.isSmallOrder(Buffer.from(e, 'hex'))).toBe(true);
    }
  });

  it('Ed25519 s ≥ L (kanonik olmayan imza) ve biçimsiz boy reddedilir', () => {
    const acik = Buffer.from(IMZA.x, 'base64url');
    const m = Buffer.from('ileti');
    const s = crypto.sign(null, m, IMZA.privateKey);
    const L = (BigInt(1) << BigInt(252)) + BigInt('27742317777372353535851937790883648493');
    let sSay = BigInt(0);
    for (let i = 63; i >= 32; i--) sSay = (sSay << BigInt(8)) | BigInt(s[i]);
    let yeni = sSay + L;
    const s2 = Buffer.from(s);
    for (let i = 32; i < 64; i++) {
      s2[i] = Number(yeni & BigInt(0xff));
      yeni >>= BigInt(8);
    }
    expect(ed25519Verify(acik, m, s2)).toBe(false);
    expect(ed25519Verify(acik.subarray(0, 31), m, s)).toBe(false);
    expect(ed25519Verify(acik, m, s.subarray(0, 63))).toBe(false);
  });
});
