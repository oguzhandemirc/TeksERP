// =============================================================================
// SÖZLEŞME ÖZ-TESTİ — `kos()` çıktısı d9 panel sürücüsüyle BİREBİR mi (jest yok, `node` ile)
// =============================================================================
// Koşum: `node scripts/surucu/kos-sozlesme.mjs` → "TÜMÜ GEÇTİ" (çıkış 0) ya da ilk kıran satır.
// Cihaz/backend GEREKMEZ: sahte Surucu + sahte api/sql. `sonuc.json`ın üst düzey alanları
// ({zaman,api,db,ozet}), adım alanları (dogrulama/durum/ekran/hata/id/rol/sure_ms/yol), üç
// değerli durum ve `gerektirir`→atlandı davranışı d9'un `Electron/e2e/guzergah/guzergah.mjs`
// çıktısıyla aynı olmalı; ayrışırsa 1e iki raporu yan yana okuyamaz.
// =============================================================================
import { kos } from './surucu.mjs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const sahteCihaz = { seri: 'test', ekran: () => '/dev/null' };
const s = { cihaz: sahteCihaz, log: () => {}, agacOzeti: () => 'agac', ekran: () => '/dev/null',
  fiiller: () => ({ git: async()=>{}, tikla: async()=>{}, yaz:()=>{}, numpad:()=>{}, sec: async()=>{}, gor: async()=>{}, bekle: async()=>{}, ekran:()=>{}, surucu: {} }) };
const api = { get: async (uc) => ({ uc, n: uc.includes('bos') ? 0 : 2 }) };
const sql = async (q) => [{ n: 5 }];

const adimlar = [
  { id: 'A1', rol: 'P', yol: 'y', yap: async()=>{}, dogrula: [{ ad: 'uc sayı', uc: '/api/x', oku: (g)=>g.n, beklenen: 2 }] },
  { id: 'A2', rol: 'T', yol: 'y', yap: async()=>{}, dogrula: [{ ad: 'sql yüklem', sql: 'SELECT 1', oku: (r)=>r[0].n, beklenen: (v)=>v>=3 }] },
  { id: 'A3', rol: 'M', yol: 'y', yap: async()=>{ throw new Error('patladı'); } },              // kirmizi (yap hatası)
  { id: 'A4', rol: 'T', yol: 'y', gerektirir: ['A3'], yap: async()=>{} },                        // atlandi (ön koşul A3 kirmizi)
  { id: 'A5', rol: 'P', yol: 'y', yap: async()=>{}, dogrula: [{ ad: 'tutmaz', uc: '/api/bos', oku:(g)=>g.n, beklenen: 9 }] }, // kirmizi (doğrulama)
];

const dizin = mkdtempSync(join(os.tmpdir(), 'kos-sozlesme-'));
await kos(s, adimlar, { ciktiDizini: dizin, api, sql, apiUrl: 'http://x:4110', dbName: 'testdb' });
const dosya = JSON.parse(readFileSync(join(dizin, 'sonuc.json'), 'utf-8'));

const bekle = (kosul, ad) => { if (!kosul) { console.error('❌', ad); process.exit(1); } else console.log('✓', ad); };
bekle(dosya.api === 'http://x:4110' && dosya.db === 'testdb' && typeof dosya.zaman === 'string', 'üst düzey {zaman,api,db}');
bekle(JSON.stringify(dosya.ozet) === JSON.stringify({ yesil: 2, kirmizi: 2, atlandi: 1 }), `özet {yesil:2,kirmizi:2,atlandi:1} (görülen ${JSON.stringify(dosya.ozet)})`);
const a1 = dosya.adimlar.find(a=>a.id==='A1');
bekle(a1.durum === 'yesil' && a1.dogrulama[0].ok && a1.dogrulama[0].gorulen === '2' && a1.dogrulama[0].beklenen === '2', 'A1 yeşil, doğrulama {ad,ok,beklenen,gorulen}');
bekle(dosya.adimlar.find(a=>a.id==='A2').durum === 'yesil', 'A2 sql yüklem yeşil');
bekle(dosya.adimlar.find(a=>a.id==='A3').durum === 'kirmizi', 'A3 yap hatası kırmızı');
bekle(dosya.adimlar.find(a=>a.id==='A4').durum === 'atlandi' && /ön koşul/.test(dosya.adimlar.find(a=>a.id==='A4').hata), 'A4 ön koşul atlandı');
bekle(dosya.adimlar.find(a=>a.id==='A5').durum === 'kirmizi', 'A5 doğrulama tutmadı kırmızı');
const alanlar = Object.keys(dosya.adimlar[0]).sort().join(',');
bekle(alanlar === 'dogrulama,durum,ekran,hata,id,rol,sure_ms,yol', `adım alanları d9 ile bir (${alanlar})`);
console.log('TÜMÜ GEÇTİ');
