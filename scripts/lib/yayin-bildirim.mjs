// YAYIN BİLDİRİMİ — yayın/terfi SONRASI satıcı portalına İMZALI bildirim (Faz 3d). Tek yardımcı: panel
// (deploy/electron-yayinla.sh), tablet (deploy/mobil-yayinla.mjs) ve terfi (scripts/kanal-kapisi.mjs) buradan yollar.
// ⚠️ ASLA FIRLATMAZ, yayını ASLA DURDURMAZ: yapılandırma yok → "atlandı", ağ/sunucu hatası → "başarısız" + uyarı.
// Tel biçimi satici/sunucu/src/distribution/publications.service.ts ile aynı (bekçi: satici test_yayin_bildirimi).
// Yapılandırma: ~/.tekserp/yayinci/ayar.json {"adres","kid","anahtar"} (repo DIŞI; TEKSERP_YAYINCI_AYAR ile başka dosya;
// TEKSERP_YAYIN_BILDIRIMI=0 kapatır — yayın betiklerini koşan bekçiler bunu koyar).
//   node scripts/lib/yayin-bildirim.mjs anahtar-uret --kid=yayinci-mac-1 [--dizin=<dizin>]   # açık yarıyı portala kaydet
//   node scripts/lib/yayin-bildirim.mjs bildir-yayin --urun=panel --kanal=<kod> --surum=X.Y.Z [--tur= --sha16= --boyut= --vc= --terfi-atla=<cümle>]
//   node scripts/lib/yayin-bildirim.mjs bildir --olay=TERFI_ATLANDI --urun=panel --kanal=<kod> --surum=X.Y.Z [--cumle= …]   # tek olay
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BILDIRIM_TURU = 'tekserp-yayin-bildirimi';
export const IMZA_ONEKI = 'tekserp-yayin-bildirimi.v1\n';
export const IMZA_BASLIGI = 'X-Yayin-Imzasi';
export const VARSAYILAN_DIZIN = path.join(os.homedir(), '.tekserp', 'yayinci');
const AYRINTI_ANAHTARLARI = ['tur', 'sha16', 'boyut', 'vc', 'makine', 'etiket', 'cumle'];

/** Ayar dosyası; yoksa/bozuksa null (çağıran "atlandı" der). */
export function ayarOku(dosya = process.env.TEKSERP_YAYINCI_AYAR || path.join(VARSAYILAN_DIZIN, 'ayar.json')) {
  // Bekçiler yayın betiklerini sahte ssh/git ile koşar: geliştiricinin gerçek ayarı canlı portala bildirim atmasın.
  if (process.env.TEKSERP_YAYIN_BILDIRIMI === '0') return null;
  try {
    const a = JSON.parse(fs.readFileSync(dosya, 'utf8'));
    if (typeof a.adres !== 'string' || typeof a.kid !== 'string' || typeof a.anahtar !== 'string') return null;
    return { adres: a.adres, kid: a.kid, anahtar: path.resolve(path.dirname(dosya), a.anahtar) };
  } catch {
    return null;
  }
}

/** Yeni Ed25519 anahtarı: özel yarı 0600 PEM (dizin 0700), açık yarı (base64url x) döner — portala bu kaydedilir. */
export function anahtarUret({ kid, dizin = VARSAYILAN_DIZIN }) {
  if (!/^[a-z0-9][a-z0-9.-]{2,79}$/.test(kid ?? '')) throw new Error('kid küçük harf/rakam/nokta/tire, 3–80 karakter olmalı');
  fs.mkdirSync(dizin, { recursive: true, mode: 0o700 });
  const dosya = path.join(dizin, `${kid}.pem`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(dosya, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  return { kid, dosya, acikAnahtar: publicKey.export({ format: 'jwk' }).x };
}

/** Kanonik gövde (anahtar sırası sabit); tanınmayan ayrıntı anahtarı düşer, boş değer gönderilmez. */
export function bildirimGovdesi({ kid, zaman = new Date(), olay, urun, kanal, surum, ayrinti = {} }) {
  const temiz = {};
  for (const k of AYRINTI_ANAHTARLARI) {
    const v = ayrinti[k];
    if (v === undefined || v === null || v === '') continue;
    temiz[k] = k === 'boyut' || k === 'vc' ? Number(v) : String(v).slice(0, k === 'cumle' ? 500 : 120);
  }
  return Buffer.from(JSON.stringify({ v: 1, typ: BILDIRIM_TURU, kid, zaman: zaman.toISOString(), olay, urun, kanal, surum, ayrinti: temiz }), 'utf8');
}

export function imzala(govde, ozelAnahtarPem) {
  const anahtar = crypto.createPrivateKey(ozelAnahtarPem);
  return crypto.sign(null, Buffer.concat([Buffer.from(IMZA_ONEKI, 'utf8'), govde]), anahtar).toString('base64url');
}

export function makineAdi() {
  try {
    return `${os.userInfo().username}@${os.hostname().split('.')[0]}`;
  } catch {
    return undefined;
  }
}

/**
 * Bildirimi yollar. Dönüş {durum: 'gonderildi'|'zaten-vardi'|'atlandi'|'basarisiz', not}. ASLA fırlatmaz.
 * `ayar` verilmezse dosyadan; `fetchFn`/`zaman` bekçi içindir.
 */
export async function yayinBildir(olay, { ayar = ayarOku(), fetchFn = globalThis.fetch, zaman = new Date(), zamanAsimiMs = 10_000 } = {}) {
  if (!ayar) return { durum: 'atlandi', not: 'yayın bildirimi yapılandırılmamış (~/.tekserp/yayinci/ayar.json)' };
  try {
    const govde = bildirimGovdesi({ kid: ayar.kid, zaman, ...olay, ayrinti: { makine: makineAdi(), ...(olay.ayrinti ?? {}) } });
    const imza = imzala(govde, fs.readFileSync(ayar.anahtar, 'utf8'));
    const r = await fetchFn(ayar.adres, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [IMZA_BASLIGI]: imza },
      body: govde,
      signal: AbortSignal.timeout(zamanAsimiMs),
    });
    let j = null;
    try {
      j = await r.json();
    } catch {
      j = null;
    }
    if (r.status === 201) return { durum: 'gonderildi', not: j?.data?.bildirimKimligi?.slice(0, 12) ?? '' };
    if (r.status === 200 && j?.data?.tekrar) return { durum: 'zaten-vardi', not: j.data.bildirimKimligi?.slice(0, 12) ?? '' };
    return { durum: 'basarisiz', not: `HTTP ${r.status}${j?.details?.code ? ` ${j.details.code}` : ''}${j?.message ? ` — ${j.message}` : ''}` };
  } catch (e) {
    return { durum: 'basarisiz', not: e?.name === 'TimeoutError' ? 'zaman aşımı' : String(e?.message ?? e) };
  }
}

/** Yayın betikleri için tek satır: sonuç ne olursa olsun yalnız BASAR. */
export async function yayinBildirVeBas(olay, secenek) {
  const s = await yayinBildir(olay, secenek);
  const satir = {
    gonderildi: `  ✓ portala yayın bildirimi gitti (${olay.olay} ${olay.urun} ${olay.surum} → ${olay.kanal})`,
    'zaten-vardi': `  · portal bu bildirimi zaten almış (${olay.olay} ${olay.urun} ${olay.surum})`,
    atlandi: `  · portala yayın bildirimi atlandı: ${s.not}`,
    basarisiz: `  ⚠️ portala yayın bildirimi GİTMEDİ (yayın etkilenmedi): ${s.not}`,
  }[s.durum];
  console.log(satir);
  return s;
}

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Kanal üretim kanalı mı (kayıtta `terfiKaynagi`)? Okunamazsa false — TERFI satırı atlanır, YAYIN yine gider. */
export function uretimKanaliMi(kanal, kayitDosyasi = path.join(KOK, 'deploy', 'kanallar.json')) {
  try {
    return Boolean(JSON.parse(fs.readFileSync(kayitDosyasi, 'utf8')).kanallar?.[kanal]?.terfiKaynagi);
  } catch {
    return false;
  }
}

/**
 * Yayın SONRASI tek giriş: YAYIN + (kaçış cümlesi varsa TERFI_ATLANDI, yoksa üretim kanalında TERFI — terfi etiketi
 * yayından önce kapıda doğrulandı). Yapılandırma yoksa tek satır basar. ASLA fırlatmaz.
 */
export async function yayinSonrasiBildir({ urun, kanal, surum, ayrinti = {}, terfiAtla }, secenek = {}) {
  const ayar = 'ayar' in secenek ? secenek.ayar : ayarOku();
  const s = { ...secenek, ayar };
  const olaylar = [{ olay: 'YAYIN', urun, kanal, surum, ayrinti }];
  if (terfiAtla !== undefined && terfiAtla !== '') olaylar.push({ olay: 'TERFI_ATLANDI', urun, kanal, surum, ayrinti: { cumle: terfiAtla } });
  else if (uretimKanaliMi(kanal, secenek.kayitDosyasi)) olaylar.push({ olay: 'TERFI', urun, kanal, surum, ayrinti: { etiket: `terfi/${kanal}/${urun}-v${surum}` } });
  if (!ayar) return [await yayinBildirVeBas(olaylar[0], s)];
  const sonuc = [];
  for (const o of olaylar) sonuc.push(await yayinBildirVeBas(o, s));
  return sonuc;
}

function argOku(argv, ad) {
  const a = argv.find((x) => x.startsWith(`--${ad}=`));
  return a === undefined ? undefined : a.slice(ad.length + 3);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [komut, ...argv] = process.argv.slice(2);
  if (komut === 'anahtar-uret') {
    try {
      const r = anahtarUret({ kid: argOku(argv, 'kid'), dizin: argOku(argv, 'dizin') ?? VARSAYILAN_DIZIN });
      console.log(`Özel anahtar: ${r.dosya} (0600, repo DIŞI)\nPortala kaydedilecek açık anahtar (Sürümler → Yayıncılar): ${r.acikAnahtar}`);
    } catch (e) {
      console.error(`anahtar üretilemedi: ${e.message}`);
      process.exit(1);
    }
  } else if (komut === 'bildir-yayin') {
    const ayrinti = Object.fromEntries(['tur', 'sha16', 'boyut', 'vc'].map((k) => [k, argOku(argv, k)]).filter(([, v]) => v !== undefined));
    await yayinSonrasiBildir({ urun: argOku(argv, 'urun'), kanal: argOku(argv, 'kanal'), surum: argOku(argv, 'surum'), ayrinti, terfiAtla: argOku(argv, 'terfi-atla') });
    process.exit(0);
  } else if (komut === 'bildir') {
    const ayrinti = Object.fromEntries(AYRINTI_ANAHTARLARI.map((k) => [k, argOku(argv, k)]).filter(([, v]) => v !== undefined));
    await yayinBildirVeBas({ olay: argOku(argv, 'olay'), urun: argOku(argv, 'urun'), kanal: argOku(argv, 'kanal'), surum: argOku(argv, 'surum'), ayrinti });
    process.exit(0);
  } else {
    console.error('kullanım: anahtar-uret --kid=<kid> | bildir-yayin --urun= --kanal= --surum= [...] | bildir --olay= --urun= --kanal= --surum= [...]');
    process.exit(2);
  }
}
