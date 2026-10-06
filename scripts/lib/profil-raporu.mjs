// =============================================================================
// TeksERP — PROFİL MATRİSİ RAPORU — biçim + yayın kapısının TEK yüklemi (TEK-ORTAK-PAKET §6.4)
// =============================================================================
// Rapor `Teks-Erp/scripts/profil-matrisi.ts` tarafından yazılır:
//   ~/.tekserp/derleme-kayitlari/profil-matrisi-<commit>.json
// Kapı: bir sürüm kök grubun (deploy/dagitim.json zincirinde `terfiKaynagi: null`, bugün
// `test`) DIŞINDAKİ bir gruba çıkmadan önce, o commit için temiz ağaçta üretilmiş ve
// BÜTÜN profilleri yeşil bir rapor ister. Üç sonuçlu: rapor yok/okunamadı = ÖLÇÜLEMEDİ = DUR.
// Kaçış yalnız kullanıcının cümlesiyle (`--profil-matrisi-atla="<cümle>"`); çağıran defterine yazar.
// Yayın betikleri bunu çağırır; hangilerinin çağırması gerektiğini `test_profil_raporu_kapisi.mjs` ölçer.
// =============================================================================
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { grupZinciri, kayitHatalari } from './dagitim.mjs';
import { kacisCumlesiDenetle } from './kullanici-cumlesi.mjs';

export const RAPOR_DIZINI = path.join(homedir(), '.tekserp', 'derleme-kayitlari');
export const PROFIL_DIZINI_REL = 'Teks-Erp/scripts/test-profilleri';
export const KACIS_BAYRAGI = '--profil-matrisi-atla';
/** Kapıyı çağırması gereken yayın betikleri: dağıtım kaydının tüketicisi olan bu desendeki her dosya. */
export const YAYIN_BETIGI_DESENI = /^(deploy\/[^/]*yayinla[^/]*|mobil\/scripts\/yayinla-ota\.mjs)$/;
/** Çağrı izi: betik bu iki addan birini taşımalı (lib ya da CLI). */
export const KAPI_IZLERI = Object.freeze(['profilMatrisiKapisi', 'profil-matrisi-kapisi.mjs']);

/** Profil dosyası özeti — rapordaki `profilOzeti` ile aynı türetim (sha256, ilk 16 hane). */
export function profilOzeti(metin) {
  return createHash('sha256').update(metin).digest('hex').slice(0, 16);
}

export function raporYolu(commit, dizin = RAPOR_DIZINI) {
  return path.join(dizin, `profil-matrisi-${commit}.json`);
}

/** Diskteki profiller → { ad: özet }. Dizin yoksa null. */
export function profilOzetleri(profilDizini) {
  if (!existsSync(profilDizini)) return null;
  const out = {};
  for (const f of readdirSync(profilDizini).filter((x) => x.endsWith('.json')).sort()) {
    out[f.replace(/\.json$/, '')] = profilOzeti(readFileSync(path.join(profilDizini, f), 'utf8'));
  }
  return out;
}

const olculemedi = (sebep) => ({ sonuc: 'olculemedi', sebep });
const ihlal = (sebep) => ({ sonuc: 'ihlal', sebep });

/**
 * Saf yüklem: rapor nesnesi (ya da null) + commit + güncel profil özetleri → gecti | ihlal | olculemedi.
 */
export function raporDenetle(rapor, commit, ozetler) {
  if (rapor === null || rapor === undefined) return olculemedi(`bu commit için profil matrisi raporu yok (${commit.slice(0, 12)})`);
  if (typeof rapor !== 'object' || Array.isArray(rapor)) return olculemedi('rapor nesne değil');
  if (rapor.commit !== commit) return olculemedi(`rapor başka commit'e ait (${String(rapor.commit).slice(0, 12)} ≠ ${commit.slice(0, 12)})`);
  if (!ozetler || Object.keys(ozetler).length === 0) return olculemedi('test profilleri dizini boş ya da yok');
  if (rapor.agacTemiz !== true) return ihlal('rapor kirli ağaçta üretilmiş (commit edilmemiş değişiklik) — matrisi temiz ağaçta yeniden koş');
  if (!Array.isArray(rapor.profiller)) return olculemedi('rapor profil listesi taşımıyor');
  if (rapor.sonuc !== 'YESIL') return ihlal(`matris sonucu ${rapor.sonuc ?? 'yok'}`);
  const raporda = new Map(rapor.profiller.map((p) => [p?.ad, p]));
  for (const [ad, ozet] of Object.entries(ozetler)) {
    const p = raporda.get(ad);
    if (!p) return ihlal(`'${ad}' profili raporda yok — bütün profiller koşulmalı`);
    if (p.sonuc !== 'YESIL') return ihlal(`'${ad}' profili ${p.sonuc}`);
    if (p.profilOzeti !== ozet) return ihlal(`'${ad}' profili rapordan sonra değişmiş (özet ${p.profilOzeti} ≠ ${ozet})`);
  }
  for (const ad of raporda.keys()) if (!(ad in ozetler)) return ihlal(`raporda dizinde olmayan profil var: '${ad}'`);
  return { sonuc: 'gecti', sebep: `${Object.keys(ozetler).length} profil yeşil` };
}

/** Rapor dosyasını okur: yok → null; bozuk → { bozuk: mesaj }. */
export function raporOku(commit, dizin = RAPOR_DIZINI) {
  const yol = raporYolu(commit, dizin);
  if (!existsSync(yol)) return null;
  try {
    return JSON.parse(readFileSync(yol, 'utf8'));
  } catch (e) {
    return { bozuk: e.message };
  }
}

/**
 * Yayın kapısı. `kayit` = ayrıştırılmış dağıtım kaydı; `atla` = kaçış cümlesi (verilmediyse undefined).
 * Dönüş: { sonuc: 'gecti'|'muaf'|'atlandi'|'ihlal'|'olculemedi', sebep, cumle? }.
 */
export function profilMatrisiKapisi({ grup, commit, kayit, raporDizini = RAPOR_DIZINI, profilDizini, atla }) {
  const kayitH = kayit && typeof kayit === 'object' ? kayitHatalari(kayit) : ['kayıt nesne değil'];
  if (kayitH.length > 0) return olculemedi(`dağıtım kaydı geçersiz: ${kayitH[0]}`);
  const gruplar = kayit.gruplar;
  const g = gruplar.find((x) => x?.kod === grup);
  if (!g) return olculemedi(`"${grup}" kayıtlı bir güncelleme grubu değil`);
  const { zincir } = grupZinciri(gruplar);
  if (g.terfiKaynagi === null && zincir?.[0] === grup) return { sonuc: 'muaf', sebep: `"${grup}" kök gruptur; matris raporu ondan SONRAKİ gruplara çıkarken istenir` };
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) return olculemedi(`commit tam sha değil (${commit})`);
  const okunan = raporOku(commit, raporDizini);
  const durum = okunan && 'bozuk' in okunan
    ? olculemedi(`rapor okunamadı: ${okunan.bozuk}`)
    : raporDenetle(okunan, commit, profilOzetleri(profilDizini));
  if (durum.sonuc === 'gecti' || atla === undefined) return durum;
  const c = kacisCumlesiDenetle(atla);
  if (!c.gecerli) return ihlal(`${KACIS_BAYRAGI}: ${c.sebep} (kapı: ${durum.sebep})`);
  return { sonuc: 'atlandi', sebep: `kullanıcı cümlesiyle atlandı (kapı: ${durum.sonuc} — ${durum.sebep})`, cumle: c.cumle };
}

/**
 * Bağlantı ölçümü: dağıtım kaydının tüketicisi olan her yayın betiği kapıyı çağırmalı.
 * `oku(rel)` dosya metnini (ya da undefined) döner. Dönüş: eksik/okunamayan betik listesi.
 */
export function baglantiEksikleri(tuketiciler, oku) {
  const eksik = [];
  for (const rel of tuketiciler.filter((f) => YAYIN_BETIGI_DESENI.test(f))) {
    const metin = oku(rel);
    if (typeof metin !== 'string') eksik.push(`${rel}: okunamadı`);
    else if (!KAPI_IZLERI.some((iz) => metin.includes(iz))) eksik.push(`${rel}: profil matrisi kapısını çağırmıyor`);
  }
  return eksik;
}
