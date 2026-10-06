#!/usr/bin/env node
// =============================================================================
// YAYIN BİLDİRİMİ YARDIMCISI (scripts/lib/yayin-bildirim.mjs, Faz 3d) — DB'siz, ağsız (sahte fetch).
//   §1 gövde kanonik: tanınmayan ayrıntı düşer, boş değer gitmez; imza Node'un Ed25519 doğrulamasından geçer
//   §2 ASLA FIRLATMAZ: ayar yok → atlandı · ağ hatası/zaman aşımı/5xx/anahtar yok → başarısız · 201/200-tekrar ayrışır
//   §3 yayın sonrası: YAYIN + üretim kanalında TERFI (etiket adıyla) · hazırlıkta yalnız YAYIN · kaçışta TERFI_ATLANDI
//   §4 kancalar: panel/tablet yayın betikleri ve terfi atlama kaydı yardımcıyı yayından SONRA ve yayını
//      durdurmadan çağırır (✓K sonda: sentetik "durduran" kanca yakalanır)
// Koşum: node scripts/test_yayin_bildirim.mjs
// =============================================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMZA_ONEKI, anahtarUret, bildirimGovdesi, imzala, yayinBildir, yayinSonrasiBildir } from './lib/yayin-bildirim.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let gecti = 0;
let kaldi = 0;
function kontrol(ad, kosul, ayrinti = '') {
  kosul ? gecti++ : kaldi++;
  console.log(`  ${kosul ? '✅' : '❌'} ${ad}${ayrinti ? ` — ${ayrinti}` : ''}`);
}

/** Kanca denetimi: yardımcı çağrılıyor mu, çağrı yayını durdurabilir mi? Bulgu listesi (boş = uyumlu). */
export function kancaBulgulari(ad, metin, { cagri, sonrasinda, durdurmaz }) {
  const out = [];
  const i = metin.indexOf(cagri);
  if (i < 0) return [`${ad}: "${cagri}" çağrısı yok`];
  if (sonrasinda && !(metin.indexOf(sonrasinda) >= 0 && metin.indexOf(sonrasinda) < i)) out.push(`${ad}: çağrı "${sonrasinda}" adımından ÖNCE`);
  if (durdurmaz && !durdurmaz.test(metin.slice(i, i + 600))) out.push(`${ad}: çağrı yayını durdurabilir (hata yutulmuyor)`);
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yayin-bildirim-'));
try {
  console.log('\n§1 gövde ve imza');
  const a = anahtarUret({ kid: 'bekci-yayinci', dizin: tmp });
  const govde = bildirimGovdesi({ kid: a.kid, zaman: new Date('2026-09-30T10:00:00Z'), olay: 'YAYIN', urun: 'panel', kanal: 'testfabrika', surum: '1.4.0', ayrinti: { tur: 'kurulum', boyut: '42', bilinmeyen: 'x', etiket: '' } });
  const j = JSON.parse(govde.toString());
  kontrol('§1a anahtar sırası sabit, tanınmayan/boş ayrıntı düşer, boyut sayı', Object.keys(j).join() === 'v,typ,kid,zaman,olay,urun,kanal,surum,ayrinti' && JSON.stringify(j.ayrinti) === '{"tur":"kurulum","boyut":42}', JSON.stringify(j.ayrinti));
  const imza = imzala(govde, fs.readFileSync(a.dosya, 'utf8'));
  const acik = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: a.acikAnahtar }, format: 'jwk' });
  const dogru = crypto.verify(null, Buffer.concat([Buffer.from(IMZA_ONEKI), govde]), acik, Buffer.from(imza, 'base64url'));
  const onekSiz = crypto.verify(null, govde, acik, Buffer.from(imza, 'base64url'));
  kontrol('§1b imza önekli bayt dizisinde doğrulanır, öneksizde doğrulanMAZ (alan ayrımı)', dogru && !onekSiz && imza.length === 86);
  kontrol('§1c özel anahtar dosyası 0600', (fs.statSync(a.dosya).mode & 0o777) === 0o600);

  console.log('\n§2 asla fırlatmaz');
  const ayar = { adres: 'https://portal.invalid/yayin/bildirim', kid: a.kid, anahtar: a.dosya };
  const olay = { olay: 'YAYIN', urun: 'panel', kanal: 'testfabrika', surum: '1.4.0' };
  const yanit = (status, data) => async () => ({ status, json: async () => ({ data }) });
  const r = {
    ayarsiz: await yayinBildir(olay, { ayar: null }),
    ag: await yayinBildir(olay, { ayar, fetchFn: async () => { throw new Error('ECONNREFUSED'); } }),
    sunucu: await yayinBildir(olay, { ayar, fetchFn: yanit(500, null) }),
    anahtarsiz: await yayinBildir(olay, { ayar: { ...ayar, anahtar: path.join(tmp, 'yok.pem') }, fetchFn: yanit(201, {}) }),
    yeni: await yayinBildir(olay, { ayar, fetchFn: yanit(201, { bildirimKimligi: 'a'.repeat(64) }) }),
    tekrar: await yayinBildir(olay, { ayar, fetchFn: yanit(200, { tekrar: true, bildirimKimligi: 'a'.repeat(64) }) }),
  };
  kontrol('§2a ayar yok atlandı · ağ/5xx/anahtar yok başarısız · 201 gönderildi · 200 tekrar zaten-vardi', r.ayarsiz.durum === 'atlandi' && r.ag.durum === 'basarisiz' && r.sunucu.durum === 'basarisiz' && r.anahtarsiz.durum === 'basarisiz' && r.yeni.durum === 'gonderildi' && r.tekrar.durum === 'zaten-vardi', Object.values(r).map((x) => x.durum).join('/'));
  const zamanAsimi = await yayinBildir(olay, { ayar, zamanAsimiMs: 50, fetchFn: (_u, o) => new Promise((_, red) => { const bekle = setTimeout(() => {}, 5000); o.signal.addEventListener('abort', () => { clearTimeout(bekle); red(Object.assign(new Error('t'), { name: 'TimeoutError' })); }); }) });
  kontrol('§2b zaman aşımı başarısız ("zaman aşımı")', zamanAsimi.durum === 'basarisiz' && zamanAsimi.not === 'zaman aşımı', zamanAsimi.not);

  console.log('\n§3 yayın sonrası olaylar');
  const kayit = path.join(tmp, 'kanallar.json');
  fs.writeFileSync(kayit, JSON.stringify({ kanallar: { uretimk: { tur: 'uretim', terfiKaynagi: 'hazirlikk' }, hazirlikk: { tur: 'hazirlik' } } }));
  const giden = [];
  const topla = async (_u, o) => {
    giden.push(JSON.parse(Buffer.from(o.body).toString()));
    return { status: 201, json: async () => ({ data: {} }) };
  };
  const sessiz = console.log;
  console.log = () => {};
  await yayinSonrasiBildir({ urun: 'panel', kanal: 'uretimk', surum: '1.4.0' }, { ayar, fetchFn: topla, kayitDosyasi: kayit });
  const uretim = giden.splice(0).map((x) => `${x.olay}:${x.ayrinti.etiket ?? ''}`);
  await yayinSonrasiBildir({ urun: 'tablet', kanal: 'hazirlikk', surum: '2.0.0' }, { ayar, fetchFn: topla, kayitDosyasi: kayit });
  const hazirlik = giden.splice(0).map((x) => x.olay);
  await yayinSonrasiBildir({ urun: 'panel', kanal: 'uretimk', surum: '1.4.1', terfiAtla: 'acil düzeltme kullanıcı onayıyla' }, { ayar, fetchFn: topla, kayitDosyasi: kayit });
  const kacis = giden.splice(0).map((x) => x.olay);
  const ayarsizSonuc = await yayinSonrasiBildir({ urun: 'panel', kanal: 'uretimk', surum: '1.4.2' }, { ayar: null, kayitDosyasi: kayit });
  console.log = sessiz;
  kontrol('§3a üretim: YAYIN + TERFI (etiket terfi/<kanal>/<ürün>-vX)', uretim.join() === 'YAYIN:,TERFI:terfi/uretimk/panel-v1.4.0', uretim.join());
  kontrol('§3b hazırlık: yalnız YAYIN · kaçış: YAYIN + TERFI_ATLANDI (TERFI yok)', hazirlik.join() === 'YAYIN' && kacis.join() === 'YAYIN,TERFI_ATLANDI', `${hazirlik.join()} | ${kacis.join()}`);
  kontrol('§3c ayar yoksa tek satır (atlandı), istek yok', ayarsizSonuc.length === 1 && ayarsizSonuc[0].durum === 'atlandi');

  console.log('\n§4 kancalar');
  const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');
  const bulgu = [
    ...kancaBulgulari('electron-grup-yayinla.sh', oku('deploy/electron-grup-yayinla.sh'), { cagri: 'yayin-bildirim.mjs" bildir-yayin', sonrasinda: '# --- YAYIN DEFTERİ', durdurmaz: /\|\| echo/ }),
    ...kancaBulgulari('mobil-grup-yayinla.mjs', oku('deploy/mobil-grup-yayinla.mjs'), { cagri: 'await yayinSonrasiBildir(', sonrasinda: 'etiketAt(\'tablet\'' }),
    ...kancaBulgulari('kanal-kapisi.mjs', oku('scripts/kanal-kapisi.mjs'), { cagri: 'void yayinBildirVeBas(', sonrasinda: 'terfiAtlaKaydi({' }),
  ];
  kontrol('§4a üç kanca yardımcıyı yayından/kayıttan SONRA çağırır, kabuk kancası hatayı yutar', bulgu.length === 0, bulgu.join(' | '));
  const sonda = kancaBulgulari('sonda.sh', '# --- YAYIN DEFTERİ\nnode x/yayin-bildirim.mjs" bildir-yayin --urun=panel\nnext', { cagri: 'yayin-bildirim.mjs" bildir-yayin', sonrasinda: '# --- YAYIN DEFTERİ', durdurmaz: /\|\| echo/ });
  const once = kancaBulgulari('sonda2.sh', 'node x/yayin-bildirim.mjs" bildir-yayin || echo\n# --- YAYIN DEFTERİ', { cagri: 'yayin-bildirim.mjs" bildir-yayin', sonrasinda: '# --- YAYIN DEFTERİ', durdurmaz: /\|\| echo/ });
  kontrol('§4b ✓K sentetik: hatayı yutmayan kanca ve yayından ÖNCE çağrı yakalanır', sonda.length === 1 && /durdurabilir/.test(sonda[0]) && once.length === 1 && /ÖNCE/.test(once[0]), `${sonda.join()} | ${once.join()}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi > 0 ? 1 : 0);
