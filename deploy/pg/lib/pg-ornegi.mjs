// =============================================================================
// TeksERP — KENDİ PostgreSQL ÖRNEĞİ — TEK YÜKLEM (zero-dep)
// =============================================================================
// Sürüm kaydı (deploy/pg/pg-surumu.json), örnek sözleşmesi (deploy/pg/pg-ornegi.json)
// ve iki şablon (deploy/pg/*.sablon) YALNIZ buradan okunur ve doğrulanır; araçlar
// (pg-sablon.mjs · pg-ikili-dogrula.mjs) ve bekçi (scripts/test_pg_ornegi.mjs) aynı
// yüklemi çağırır. Başka dilde yazan taraf (setup, güncelleyici) aynı JSON'u okur ve
// pg-sablon-vektorleri.json ile kendi üretimini doğrular.
//
// ÜÇ SONUÇ: okunamayan/bozuk dosya `Olculemedi` fırlatır — "yasak yok" DEMEK DEĞİLDİR.
// Tasarım: docs/design/KENDI-POSTGRESQL.md
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SURUM_REL = 'deploy/pg/pg-surumu.json';
export const ORNEK_REL = 'deploy/pg/pg-ornegi.json';
export const VEKTOR_REL = 'deploy/pg/pg-sablon-vektorleri.json';

/** Okunamadı / ayrıştırılamadı — "ihlal yok" ile karışmasın diye ayrı tip. */
export class Olculemedi extends Error {}

export function metinOku(rel, kok = KOK) {
  try {
    return fs.readFileSync(path.join(kok, rel), 'utf8');
  } catch (e) {
    throw new Olculemedi(`${rel} okunamadı: ${e.message}`);
  }
}

export function jsonCoz(metin, rel) {
  try {
    return JSON.parse(metin);
  } catch (e) {
    throw new Olculemedi(`${rel} JSON olarak ayrıştırılamadı: ${e.message}`);
  }
}

export const jsonOku = (rel, kok = KOK) => jsonCoz(metinOku(rel, kok), rel);

export const sha256 = (veri) => crypto.createHash('sha256').update(veri).digest('hex');

const nesneMi = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const tamsayiMi = (x) => Number.isInteger(x);
const SHA256_DESENI = /^[0-9a-f]{64}$/;
const TARIH_DESENI = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ *
 * Sürüm kaydı
 * ------------------------------------------------------------------ */

export const HEDEFLER = ['win-x64'];
/** Resmî ikili kaynağı: yalnız EDB'nin indirme kökü, yalnız HTTPS. */
export const IZINLI_KAYNAK = 'https://get.enterprisedb.com/postgresql/';

/** `<surum>-<derleme>`: aynı sürümün yeni derlemesi de yan yana açılabilsin (geri dönüş). */
export const dizinAdi = (kayit) => `${kayit.surum}-${kayit.derleme}`;

/** EDB dosya adı kalıbı — sürüm/derleme ile url/dosya birlikte değişmek ZORUNDA. */
export const edbDosyaAdi = (surum, derleme) => `postgresql-${surum}-${derleme}-windows-x64-binaries.zip`;

/** Sürüm kaydının iç tutarlılığı (ağa/diske bakmaz). Boş dizi = temiz. */
export function surumKaydiHatalari(k) {
  const h = [];
  if (!nesneMi(k)) return ['pg-surumu kaydı bir nesne değil'];
  if (typeof k.surum !== 'string' || !/^\d+\.\d+$/.test(k.surum)) h.push(`surum "${k.surum}" <ana>.<küçük> değil (PG 10+ iki parçalıdır)`);
  if (typeof k.cizgi !== 'string' || !/^\d+$/.test(k.cizgi)) h.push(`cizgi "${k.cizgi}" sayı değil`);
  else if (typeof k.surum === 'string' && k.surum.split('.')[0] !== k.cizgi) h.push(`cizgi "${k.cizgi}" surum "${k.surum}" ile uyuşmuyor (ana sürüm değişimi otomatik değildir — runbook)`);
  if (typeof k.derleme !== 'string' || !/^\d+$/.test(k.derleme)) h.push(`derleme "${k.derleme}" sayı değil (EDB -N)`);
  // Backend bildiriminin `pg.enAz`ı (harici örneğin kabul edilen en eski küçük sürümü) — yayıncı buradan okur.
  if (typeof k.backendEnAz !== 'string' || !/^\d+\.\d+$/.test(k.backendEnAz)) h.push(`backendEnAz "${k.backendEnAz}" <ana>.<küçük> değil (bildirimin pg.enAz'ı)`);
  else {
    const [enAna, enKucuk] = k.backendEnAz.split('.').map(Number);
    if (String(enAna) !== k.cizgi) h.push(`backendEnAz "${k.backendEnAz}" çizginin (${k.cizgi}) ana sürümünde değil — ana sürüm geçişi otomatik değildir`);
    else if (typeof k.surum === 'string' && /^\d+\.\d+$/.test(k.surum) && enKucuk > Number(k.surum.split('.')[1])) h.push(`backendEnAz "${k.backendEnAz}" sabitlenen sürümden (${k.surum}) yeni — kendi örnek kendi kaydının altında kalır`);
  }
  for (const alan of ['yayinTarihi', 'destekSonu']) {
    if (typeof k[alan] !== 'string' || !TARIH_DESENI.test(k[alan])) h.push(`${alan} "${k[alan]}" YYYY-AA-GG değil`);
  }
  const y = k.yayin;
  if (!nesneMi(y)) {
    h.push('yayin bloğu yok');
  } else {
    for (const hedef of HEDEFLER) if (!y[hedef]) h.push(`yayin.${hedef} yok`);
    for (const [hedef, b] of Object.entries(y)) {
      if (!HEDEFLER.includes(hedef)) h.push(`yayin.${hedef} tanınmayan hedef (${HEDEFLER.join(' | ')})`);
      if (!nesneMi(b)) {
        h.push(`yayin.${hedef} bir nesne değil`);
        continue;
      }
      const beklenen = edbDosyaAdi(k.surum, k.derleme);
      if (b.dosya !== beklenen) h.push(`yayin.${hedef}.dosya "${b.dosya}" — sürüm/derlemeden beklenen "${beklenen}"`);
      if (typeof b.url !== 'string' || !b.url.startsWith(IZINLI_KAYNAK)) h.push(`yayin.${hedef}.url resmî HTTPS kaynağında değil (${IZINLI_KAYNAK}…): "${b.url}"`);
      else if (b.url !== `${IZINLI_KAYNAK}${b.dosya}`) h.push(`yayin.${hedef}.url dosya adını taşımıyor: "${b.url}"`);
      if (!tamsayiMi(b.boyut) || b.boyut <= 0) h.push(`yayin.${hedef}.boyut pozitif tamsayı değil`);
      if (typeof b.sha256 !== 'string' || !SHA256_DESENI.test(b.sha256)) h.push(`yayin.${hedef}.sha256 64 haneli küçük hex değil: "${b.sha256}"`);
      if (b.arsivKok !== 'pgsql') h.push(`yayin.${hedef}.arsivKok "${b.arsivKok}" — EDB zip kökü "pgsql" bekleniyor`);
      if (typeof b.icuSurum !== 'string' || !/^\d+$/.test(b.icuSurum)) h.push(`yayin.${hedef}.icuSurum "${b.icuSurum}" sayı değil (bin/icuuc<N>.dll)`);
      if (!['yok', 'authenticode'].includes(b.imza)) h.push(`yayin.${hedef}.imza "${b.imza}" — "yok" | "authenticode" (ölçülür, varsayılmaz)`);
      if (!nesneMi(b.olcum) || typeof b.olcum.tarih !== 'string' || !TARIH_DESENI.test(b.olcum.tarih)) h.push(`yayin.${hedef}.olcum.tarih yok`);
    }
  }
  const s = k.sahne;
  if (!nesneMi(s)) {
    h.push('sahne bloğu yok');
  } else {
    if (!Array.isArray(s.dahil) || !s.dahil.length || s.dahil.some((d) => typeof d !== 'string' || d.startsWith('/') || d.includes('..'))) h.push('sahne.dahil göreli yol öneki listesi değil');
    if (!Array.isArray(s.haric)) h.push('sahne.haric dizi değil');
    else for (const r of s.haric) {
      try {
        new RegExp(r);
      } catch {
        h.push(`sahne.haric geçersiz düzenli ifade: ${r}`);
      }
    }
    if (!tamsayiMi(s.dosyaSayisi) || s.dosyaSayisi <= 0) h.push('sahne.dosyaSayisi pozitif tamsayı değil');
    if (!tamsayiMi(s.boyut) || s.boyut <= 0) h.push('sahne.boyut pozitif tamsayı değil');
    if (typeof s.icerikSha256 !== 'string' || !SHA256_DESENI.test(s.icerikSha256)) h.push('sahne.icerikSha256 64 haneli küçük hex değil');
  }
  const z = k.zorunlu;
  if (!nesneMi(z)) {
    h.push('zorunlu bloğu yok');
  } else {
    if (!Array.isArray(z.ikililer) || !z.ikililer.length) h.push('zorunlu.ikililer boş');
    if (!Array.isArray(z.uzantilar)) h.push('zorunlu.uzantilar dizi değil');
    if (z.icu !== true) h.push('zorunlu.icu true değil (tr_sort ICU harmanlaması ister)');
  }
  if (!Array.isArray(k.guncellemeSonrasi)) h.push('guncellemeSonrasi dizi değil (boş dizi = sürüm notu ek adım istemiyor)');
  else for (const [i, a] of k.guncellemeSonrasi.entries()) {
    if (!nesneMi(a) || !['sql', 'reindex-icu'].includes(a.tur) || typeof a.gerekce !== 'string' || !a.gerekce.trim()) {
      h.push(`guncellemeSonrasi[${i}] {tur: sql|reindex-icu, gerekce} değil`);
    }
  }
  return h;
}

/* ------------------------------------------------------------------ *
 * Örnek sözleşmesi
 * ------------------------------------------------------------------ */

export const ZORUNLU_INITDB = ['--encoding=UTF8', '--locale=C', '--locale-provider=libc', '--auth=scram-sha-256', '--data-checksums'];
const YASAK_INITDB = [
  [/trust|password|md5|ident|peer/i, 'zayıf kimlik doğrulama yöntemi'],
  [/^--(lc-collate|lc-ctype|icu-locale|builtin-locale)=/, 'collation/ctype ayrı verilemez (tek karar: --locale=C)'],
  [/^--locale=(?!C$)/, 'collation C dışında (sahadaki ölçülmüş DB C)'],
  [/^--(pwprompt|-W)$|^-W$/, 'etkileşimli parola (kurulum etkileşimsiz; parola dosyadan)'],
];
const GORELI_YOL = /^(?![A-Za-z]:|[\\/])(?!.*\.\.)[A-Za-z0-9_.\\-]+$/;

/** Örnek sözleşmesinin iç tutarlılığı. Boş dizi = temiz. */
export function ornekHatalari(o) {
  const h = [];
  if (!nesneMi(o)) return ['pg-ornegi bir nesne değil'];
  if (o.bicim !== 1) h.push(`bicim ${o.bicim} — bu yüklem 1'i tanır`);
  const hz = o.hizmet;
  if (!nesneMi(hz)) h.push('hizmet bloğu yok');
  else {
    if (typeof hz.ad !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{2,79}$/.test(hz.ad)) h.push(`hizmet.ad "${hz.ad}" geçersiz`);
    if (hz.hesap !== `NT SERVICE\\${hz.ad}`) h.push(`hizmet.hesap sanal hesap değil: "${hz.hesap}" (beklenen NT SERVICE\\${hz.ad})`);
    if (hz.baslangic !== 'auto') h.push(`hizmet.baslangic "${hz.baslangic}" — açılışta kalkmalı (auto)`);
    if (typeof hz.cokmeEylemleri !== 'string' || !/^restart\/\d+(\/restart\/\d+)*$/.test(hz.cokmeEylemleri)) h.push('hizmet.cokmeEylemleri restart/<ms>/… değil');
  }
  const d = o.dizinler;
  if (!nesneMi(d)) h.push('dizinler bloğu yok');
  else {
    if (typeof d.varsayilanKok !== 'string' || !/^[A-Za-z]:\\/.test(d.varsayilanKok)) h.push('dizinler.varsayilanKok mutlak Windows yolu değil');
    for (const alan of ['ikiliKok', 'istemciBaglanti', 'veri', 'ornekKaydi', 'yoneticiParolasi']) {
      if (typeof d[alan] !== 'string' || !GORELI_YOL.test(d[alan])) h.push(`dizinler.${alan} köke göreli, '..'sız yol değil: "${d[alan]}"`);
    }
    if (typeof d.veri === 'string' && typeof d.ikiliKok === 'string' && (d.veri + '\\').startsWith(d.ikiliKok + '\\')) h.push('dizinler.veri ikili kökün ALTINDA — güncelleme ikili dizinini değiştirir, veri orada yaşayamaz');
    if (typeof d.veriVarsayilanSurucu !== 'string' || !/^[A-Za-z]:$/.test(d.veriVarsayilanSurucu)) h.push('dizinler.veriVarsayilanSurucu "X:" değil');
  }
  const p = o.port;
  if (!nesneMi(p) || !tamsayiMi(p.baslangic) || !tamsayiMi(p.bitis) || p.baslangic <= 1024 || p.bitis > 65535 || p.baslangic > p.bitis) h.push('port aralığı 1025..65535 içinde başlangıç ≤ bitiş değil');
  else if (p.baslangic !== 5432) h.push(`port.baslangic ${p.baslangic} — PostgreSQL'in bilinen portundan (5432) başlamalı`);
  const i = o.initdb;
  if (!nesneMi(i) || !Array.isArray(i.argumanlar)) h.push('initdb.argumanlar yok');
  else {
    for (const z of ZORUNLU_INITDB) if (!i.argumanlar.includes(z)) h.push(`initdb.argumanlar "${z}" içermiyor`);
    for (const a of i.argumanlar) for (const [desen, neden] of YASAK_INITDB) if (desen.test(a) && a !== '--auth=scram-sha-256') h.push(`initdb argümanı "${a}" YASAK — ${neden}`);
    if (!i.argumanlar.includes(`--username=${i.yoneticiRolu}`)) h.push('initdb --username yoneticiRolu ile aynı değil');
    if (i.parolaDosyasiArgumani !== '--pwfile') h.push('initdb parolası dosyadan (--pwfile) verilmiyor');
  }
  const y = o.yapilandirma;
  if (!nesneMi(y)) h.push('yapilandirma bloğu yok');
  else {
    if (y.includeSatiri !== `include '${y.includeDosyasi}'`) h.push('yapilandirma.includeSatiri includeDosyasi ile uyuşmuyor');
    if (!nesneMi(y.bellek) || !Object.keys(y.bellek).length) h.push('yapilandirma.bellek boş');
    else for (const [ad, f] of Object.entries(y.bellek)) {
      if (!/^[A-Z_]+$/.test(ad)) h.push(`bellek anahtarı "${ad}" şablon yer tutucusu biçiminde değil`);
      if (!nesneMi(f) || typeof f.ayar !== 'string') h.push(`bellek.${ad}.ayar yok`);
      else {
        if (!tamsayiMi(f.yuzde) || f.yuzde < 1 || f.yuzde > 100) h.push(`bellek.${ad}.yuzde 1..100 tamsayı değil`);
        if (!tamsayiMi(f.altMB) || f.altMB < 1) h.push(`bellek.${ad}.altMB pozitif tamsayı değil`);
        if (f.ustMB !== null && (!tamsayiMi(f.ustMB) || f.ustMB < f.altMB)) h.push(`bellek.${ad}.ustMB null ya da ≥ altMB tamsayı değil`);
      }
    }
    if (nesneMi(y.bellek?.SHARED_BUFFERS) && y.bellek.SHARED_BUFFERS.yuzde > 40) h.push('shared_buffers RAM\'in %40\'ını aşamaz (backend aynı makinede)');
  }
  const r = o.roller;
  if (!nesneMi(r) || !nesneMi(r.uygulama) || !nesneMi(r.bakim)) h.push('roller.uygulama / roller.bakim yok');
  else {
    const ozellik = (x) => String(x.ozellik ?? '').split(/\s+/);
    for (const [ad, rol] of Object.entries(r)) {
      if (typeof rol.ad !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(rol.ad)) h.push(`roller.${ad}.ad geçersiz`);
      for (const z of ['LOGIN', 'NOSUPERUSER', 'NOCREATEROLE', 'NOREPLICATION', 'NOBYPASSRLS']) if (!ozellik(rol).includes(z)) h.push(`roller.${ad} "${z}" taşımıyor`);
    }
    if (!ozellik(r.uygulama).includes('NOCREATEDB')) h.push('roller.uygulama NOCREATEDB taşımıyor (kopya/yedek bakım rolünün işi)');
    if (!ozellik(r.bakim).includes('CREATEDB')) h.push('roller.bakim CREATEDB taşımıyor (DB kopyası)');
    if (r.uygulama.ad === r.bakim.ad) h.push('uygulama ve bakım rolü aynı ad');
  }
  const v = o.veritabani;
  if (!nesneMi(v) || !nesneMi(v.ayarlar)) h.push('veritabani.ayarlar yok');
  else for (const [ad, deger] of [['statement_timeout', '50s'], ['idle_in_transaction_session_timeout', '5min'], ['teks.audit_guard', 'on']]) {
    if (v.ayarlar[ad] !== deger) h.push(`veritabani.ayarlar.${ad} "${v.ayarlar[ad]}" (runbook ile aynı "${deger}" bekleniyor)`);
  }
  const pr = o.parola;
  if (!nesneMi(pr) || !tamsayiMi(pr.uzunluk) || pr.uzunluk < 24) h.push('parola.uzunluk ≥ 24 değil');
  else if (typeof pr.alfabe !== 'string' || new Set(pr.alfabe).size !== pr.alfabe.length || pr.alfabe.length < 32 || !/^[A-Za-z0-9]+$/.test(pr.alfabe)) h.push('parola.alfabe tekrarsız ≥32 alfasayısal değil');
  return h;
}

/* ------------------------------------------------------------------ *
 * Bellek formülü — tamsayı aritmetiği (diller arası bayt-eşit)
 * ------------------------------------------------------------------ */

/** ilk-kurulum.ps1 MbDeger ile aynı: 1024'ün katı GB, değilse MB. */
export const mbBicim = (mb) => (mb % 1024 === 0 ? `${mb / 1024}GB` : `${mb}MB`);

export function bellekHesapla(ramMB, bellek) {
  if (!tamsayiMi(ramMB) || ramMB < 256) throw new Error(`RAM ${ramMB} MB — pozitif tamsayı (≥256) bekleniyor`);
  const sonuc = {};
  for (const [ad, f] of Object.entries(bellek)) {
    let mb = Math.floor((ramMB * f.yuzde) / 100);
    mb = Math.max(mb, f.altMB);
    if (f.ustMB !== null) mb = Math.min(mb, f.ustMB);
    sonuc[ad] = mbBicim(mb);
  }
  return sonuc;
}

/* ------------------------------------------------------------------ *
 * Port kuralı — saf; meşguliyet ölçümü çağıranın işidir
 * ------------------------------------------------------------------ */

/**
 * onceki: bu kurulumun kayıtlı portu (onarım/ikinci koşum) — meşgul görünse de O (dinleyen biziz).
 * istenen: cevap dosyası/sihirbaz portu — meşgulse HATA; sessizce başka port seçilmez.
 */
export function portSec({ mesgul = [], aralik, onceki = null, istenen = null }) {
  const dolu = new Set(mesgul);
  if (onceki !== null) return tamsayiMi(onceki) ? { port: onceki, neden: 'kayıtlı port (önceki kurulum)' } : { hata: `kayıtlı port geçersiz: ${onceki}` };
  if (istenen !== null) {
    if (!tamsayiMi(istenen) || istenen <= 1024 || istenen > 65535) return { hata: `istenen port ${istenen} 1025..65535 dışında` };
    return dolu.has(istenen) ? { hata: `istenen port ${istenen} meşgul — başka port verin ya da boş bırakın` } : { port: istenen, neden: 'istenen port' };
  }
  for (let p = aralik.baslangic; p <= aralik.bitis; p++) if (!dolu.has(p)) return { port: p, neden: p === aralik.baslangic ? 'varsayılan port boş' : `${aralik.baslangic}..${p - 1} meşgul` };
  return { hata: `${aralik.baslangic}..${aralik.bitis} aralığında boş port yok` };
}

/* ------------------------------------------------------------------ *
 * Şablon doldurma
 * ------------------------------------------------------------------ */

const YER_TUTUCU = /\{\{([A-Z_]+)\}\}/g;

export const yerTutuculari = (metin) => [...new Set([...metin.matchAll(YER_TUTUCU)].map((m) => m[1]))];

/** Eksik değer ya da kullanılmayan değer HATA (fail-closed: yarım doldurulmuş dosya yazılmaz). */
export function sablonDoldur(metin, degerler) {
  const gerekli = yerTutuculari(metin);
  const eksik = gerekli.filter((a) => !(a in degerler));
  if (eksik.length) throw new Error(`şablonda değeri olmayan yer tutucu: ${eksik.join(', ')}`);
  const fazla = Object.keys(degerler).filter((a) => !gerekli.includes(a));
  if (fazla.length) throw new Error(`şablonda karşılığı olmayan değer: ${fazla.join(', ')}`);
  const cikti = metin.replace(YER_TUTUCU, (_, a) => String(degerler[a]));
  if (/\{\{|\}\}/.test(cikti)) throw new Error('doldurulmuş çıktıda {{ }} kaldı');
  return cikti;
}

/** tekserp.conf + pg_hba.conf üretimi. Çıktı UTF-8 (şablon ASCII), LF satır sonu. */
export function yapilandirmaUret({ ramMB, port }, { ornek, confSablon, hbaSablon }) {
  if (!tamsayiMi(port) || port <= 1024 || port > 65535) throw new Error(`port ${port} 1025..65535 dışında`);
  const degerler = { PORT: port, ...bellekHesapla(ramMB, ornek.yapilandirma.bellek) };
  return { conf: sablonDoldur(confSablon, degerler), hba: sablonDoldur(hbaSablon, {}), degerler };
}

/* ------------------------------------------------------------------ *
 * Yasaklar — şablonda da üretilmiş dosyada da aynı yüklem
 * ------------------------------------------------------------------ */

export function asciiHatalari(metin, ad) {
  const h = [];
  metin.split('\n').forEach((s, i) => {
    if (/[^\t\r\x20-\x7e]/.test(s)) h.push(`${ad}:${i + 1} ASCII dışı karakter (PowerShell 5.1 ANSI okur; diller arası bayt eşitliği)`);
  });
  if (metin.includes('\r')) h.push(`${ad} CR içeriyor — satır sonu LF`);
  return h;
}

/** `#` yorumunu tırnak dışında keser. */
function yorumsuz(satir) {
  let tirnak = false;
  for (let i = 0; i < satir.length; i++) {
    const c = satir[i];
    if (c === "'") tirnak = !tirnak;
    else if (c === '#' && !tirnak) return satir.slice(0, i);
  }
  return satir;
}

const tirnaksiz = (v) => v.trim().replace(/^'(.*)'$/, '$1');

/** postgresql.conf sözdizimi: ad = değer (= isteğe bağlı), son yazan kazanır. */
export function confAyristir(metin) {
  const ayarlar = new Map();
  const yonergeler = [];
  for (const [i, ham] of metin.split('\n').entries()) {
    const s = yorumsuz(ham).trim();
    if (!s) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_.]*)\s*(?:=\s*|\s+)(.*)$/.exec(s);
    if (!m) {
      yonergeler.push({ satir: i + 1, hata: `çözülemeyen satır: ${s}` });
      continue;
    }
    const ad = m[1].toLowerCase();
    if (/^include(_if_exists|_dir)?$/.test(ad)) yonergeler.push({ satir: i + 1, ad });
    else ayarlar.set(ad, { deger: tirnaksiz(m[2]), satir: i + 1 });
  }
  return { ayarlar, yonergeler };
}

const CONF_ZORUNLU = [
  ['listen_addresses', '127.0.0.1', 'yalnız bu makine dinlenir'],
  ['unix_socket_directories', '', 'Unix soketi yok'],
  ['password_encryption', 'scram-sha-256', 'parolalar SCRAM ile saklanır'],
  ['timezone', 'UTC', 'sunucu dilimi UTC (fabrika dilimi uygulamada)'],
  ['log_timezone', 'UTC', 'günlük dilimi UTC'],
  ['ssl', 'off', 'ağ yok; sertifikasız ssl=on sunucuyu kaldırmaz'],
];
/** Kimlik doğrulama/dosya yönlendiren ayarlar: şablon dışı bir hba'ya kapı açar. */
const CONF_YASAK_AYAR = ['hba_file', 'ident_file', 'config_file', 'data_directory', 'external_pid_file'];

/** sablon=true: yer tutucular serbest; false: üretilmiş dosya (her değer somut). */
export function confYasaklari(metin, { sablon }) {
  const h = asciiHatalari(metin, 'tekserp.conf');
  const { ayarlar, yonergeler } = confAyristir(metin);
  for (const y of yonergeler) h.push(y.hata ? `tekserp.conf:${y.satir} ${y.hata}` : `tekserp.conf:${y.satir} "${y.ad}" yönergesi YASAK (başka dosya zinciri denetimi deler)`);
  for (const [ad, beklenen, neden] of CONF_ZORUNLU) {
    const a = ayarlar.get(ad);
    if (!a) h.push(`tekserp.conf ${ad} YOK — ${neden}`);
    else if (a.deger !== beklenen) h.push(`tekserp.conf:${a.satir} ${ad} = '${a.deger}' — '${beklenen}' olmalı (${neden})`);
  }
  for (const ad of CONF_YASAK_AYAR) if (ayarlar.has(ad)) h.push(`tekserp.conf:${ayarlar.get(ad).satir} ${ad} YASAK (kimlik doğrulama/dosya yönlendirmesi)`);
  const port = ayarlar.get('port');
  if (!port) h.push('tekserp.conf port YOK');
  else if (sablon ? port.deger !== '{{PORT}}' : !/^\d+$/.test(port.deger) || +port.deger <= 1024 || +port.deger > 65535) {
    h.push(`tekserp.conf:${port.satir} port = ${port.deger} — ${sablon ? '{{PORT}} yer tutucusu' : '1025..65535 tamsayı'} olmalı`);
  }
  for (const [ad, a] of ayarlar) {
    if (/\btrust\b/i.test(a.deger)) h.push(`tekserp.conf:${a.satir} ${ad} değerinde "trust"`);
    if (!sablon && /\{\{|\}\}/.test(a.deger)) h.push(`tekserp.conf:${a.satir} ${ad} doldurulmamış yer tutucu taşıyor`);
  }
  return h;
}

const HBA_TIP = 'host';
const HBA_ADRES = '127.0.0.1/32';
const HBA_YONTEM = 'scram-sha-256';

/** Her kayıt: host · (replication DIŞI) db · kullanıcı · 127.0.0.1/32 · scram-sha-256 — başka hiçbir şey. */
export function hbaYasaklari(metin) {
  const h = asciiHatalari(metin, 'pg_hba.conf');
  let kayit = 0;
  for (const [i, ham] of metin.split('\n').entries()) {
    const s = ham.replace(/#.*$/, '').trim();
    if (!s) continue;
    const alan = s.split(/\s+/);
    const yer = `pg_hba.conf:${i + 1}`;
    if (/^include(_if_exists|_dir)?$/i.test(alan[0])) {
      h.push(`${yer} "${alan[0]}" YASAK (şablon dışı kural zinciri)`);
      continue;
    }
    kayit += 1;
    if (alan[0] !== HBA_TIP) h.push(`${yer} tür "${alan[0]}" — yalnız "${HBA_TIP}" (Unix soketi/ssl türleri yok)`);
    if (alan.length !== 5) h.push(`${yer} ${alan.length} alan — tam beş (tür db kullanıcı adres yöntem), seçenek yok`);
    const [, db, , adres, yontem] = alan;
    if (db && db.split(',').some((d) => d.toLowerCase() === 'replication')) h.push(`${yer} replication bağlantısı YASAK`);
    if (adres !== HBA_ADRES) h.push(`${yer} adres "${adres}" — yalnız ${HBA_ADRES}`);
    if (yontem !== HBA_YONTEM) h.push(`${yer} yöntem "${yontem}" — yalnız ${HBA_YONTEM} (trust/md5/password/ident/sspi YOK)`);
  }
  if (!kayit) h.push('pg_hba.conf hiç kayıt taşımıyor (her bağlantı reddedilir — uygulama da bağlanamaz)');
  return h;
}
