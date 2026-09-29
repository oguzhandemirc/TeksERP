// =============================================================================
// TeksERP — TERFİ KAPISI (K5) — TEK YÜKLEM
// =============================================================================
// Üretim kanalı (`terfiKaynagi` taşıyan kanal, bugün adnansahin ← testfabrika)
// yalnız hazırlık kanalında YAYINLANMIŞ ve kullanıcının ONAYLADIĞI kodu alır.
// Üç şart, hepsi ölçülür:
//   ① HEAD == `<ürün>-v<X>` etiketinin commit'i (ilk kanala çıkan kodun ta kendisi)
//   ② `terfi/<kanal>/<ürün>-v<X>` AÇIKLAMALI etiketi HEAD'de ve mesajı onay cümlesini taşır
//      (etiket commit'e bağlı → onaylanan kodu ve sürüm notu metnini dondurur)
//   ③ kaynak kanalda yayındaki sürüm ≥ X (VDS dosya sisteminden SSH ile; okunamazsa ÖLÇÜLEMEDİ)
// Dört paketleme/yayın betiği (electron-paketle · electron-yayinla · yayinla-ota ·
// build-apk · mobil-yayinla) AYNI fonksiyonu çağırır; kabuk betikleri CLI'den
// (`scripts/kanal-kapisi.mjs terfi …`).
//
// ⚠️ ÜÇ SONUÇ: uyumlu · ihlal · ÖLÇÜLEMEDİ. Ölçülemeyen şart geçmiş şart değildir.
//
// ⚠️ KAÇIŞ (S4) yalnız KULLANICININ CÜMLESİYLE: `--terfi-atla="<cümle>"`. Boş/kısa
// cümle RED; geçerli cümle yayın defterine ve etiket mesajına yazılır. `terfiKaynagi`
// olmayan kanalda kaçış anlamsızdır → RED (alışkanlık olmasın).
//
// Yayındaki sürüm SSH ile VDS'ten okunur (scripts/lib/yayin-okuma.mjs — güncelleme sunucusu
// anonim okumaya kapalı); bekçiler PATH'e sahte `ssh` koyarak ağsız ölçer.
// =============================================================================

import { execFileSync } from 'node:child_process';

import { KOK, kanalCoz, Olculemedi } from './kanallar.mjs';
import { ayristir, etiketAdi, karsilastir, manifestGovdesindenSurum, terfiEtiketAdi } from './surum.mjs';
import { yayinOku } from './yayin-okuma.mjs';

export const TERFI_URUNLERI = ['panel', 'tablet', 'backend'];
/** Kullanıcı cümlesi — onay (etiket mesajı) ve kaçış (`--terfi-atla`) için aynı asgari. */
export const CUMLE_ASGARI_KARAKTER = 20;
export const CUMLE_ASGARI_KELIME = 3;

/** Kaçış/onay cümlesi: boşluklar tekilleşir (defter TSV'sine sekme/satır sızmaz). */
export function cumleDenetle(ham) {
  const cumle = String(ham ?? '').replace(/\s+/g, ' ').trim();
  const kelime = cumle ? cumle.split(' ').filter((k) => /[\p{L}\p{N}]/u.test(k)).length : 0;
  if (!cumle) return { gecerli: false, cumle, sebep: 'cümle BOŞ' };
  if (cumle.length < CUMLE_ASGARI_KARAKTER || kelime < CUMLE_ASGARI_KELIME) {
    return {
      gecerli: false,
      cumle,
      sebep: `cümle KISA ("${cumle}": ${cumle.length} karakter, ${kelime} kelime — en az ${CUMLE_ASGARI_KARAKTER} karakter ve ${CUMLE_ASGARI_KELIME} kelime)`,
    };
  }
  return { gecerli: true, cumle, sebep: null };
}

/** `terfiKaynagi` — yoksa null (kanal terfi istemez: hazırlık kanalı ya da tek kanallı kurulum). */
export function terfiKaynagi(kayit, kod) {
  const v = kayit?.kanallar?.[kod]?.terfiKaynagi;
  return typeof v === 'string' && v ? v : null;
}

/** Europe/Istanbul yerel saati, ofsetli ISO (fabrika günü tek kaynak: Istanbul). */
export function istanbulSaati(t = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(t).map((x) => [x.type, x.value]));
  const yerel = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const dk = Math.round((yerel - Math.floor(t.getTime() / 1000) * 1000) / 60000);
  const isaret = dk >= 0 ? '+' : '-';
  const o = Math.abs(dk);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${isaret}${String(Math.floor(o / 60)).padStart(2, '0')}:${String(o % 60).padStart(2, '0')}`;
}

/** Kaçışın etiket mesajı — terfi etiketinde ve (yeni atılıyorsa) sürüm etiketinde aynı metin. */
export function terfiAtlaMesaji({ kod, urun, surum, cumle, saat = istanbulSaati() }) {
  return `TERFİ ATLANDI — ${urun} ${surum} → ${kod} (acil kaçış, kullanıcının cümlesiyle)\n` +
    `saat: ${saat}\n\n${cumle}\n`;
}

/* ------------------------------------------------------------------ *
 * Olgular — git ve kaynak kanal (I/O burada, hüküm saf)
 * ------------------------------------------------------------------ */

function gitOku(kok, args) {
  try {
    return { kod: 0, cikti: execFileSync('git', args, { cwd: kok, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { kod: typeof e.status === 'number' ? e.status : -1, cikti: String(e.stdout ?? '').trim(), hata: String(e.stderr ?? e.message ?? '').trim() };
  }
}

/**
 * Git olguları. Depo okunamıyorsa ÖLÇÜLEMEDİ; etiket yoksa null (ölçüldü, yok).
 * @returns {{bas: string, surumEtiketi: string|null, terfiEtiketi: {tur: string, commit: string|null, mesaj: string}|null}}
 */
export function gitOlgulari({ kod, urun, surum, kok = KOK }) {
  const bas = gitOku(kok, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (bas.kod !== 0 || !/^[0-9a-f]{40,64}$/.test(bas.cikti)) {
    throw new Olculemedi(`git HEAD okunamadı (${kok}): ${bas.hata || bas.cikti || 'çıktı yok'}`);
  }
  const commitOf = (ref) => {
    const r = gitOku(kok, ['rev-parse', '-q', '--verify', `${ref}^{commit}`]);
    if (r.kod === 0 && /^[0-9a-f]{40,64}$/.test(r.cikti)) return r.cikti;
    if (r.kod === 1 && !r.cikti) return null;
    throw new Olculemedi(`git ${ref} çözülemedi: ${r.hata || r.cikti}`);
  };
  const surumEtiketi = commitOf(`refs/tags/${etiketAdi(urun, surum)}`);
  const tref = `refs/tags/${terfiEtiketAdi(kod, urun, surum)}`;
  const tcommit = commitOf(tref);
  let terfiEtiketi = null;
  if (tcommit) {
    const tur = gitOku(kok, ['cat-file', '-t', tref]);
    if (tur.kod !== 0) throw new Olculemedi(`git ${tref} türü okunamadı: ${tur.hata}`);
    const mesaj = tur.cikti === 'tag' ? gitOku(kok, ['for-each-ref', '--format=%(contents)', tref]) : { kod: 0, cikti: '' };
    if (mesaj.kod !== 0) throw new Olculemedi(`git ${tref} mesajı okunamadı: ${mesaj.hata}`);
    terfiEtiketi = { tur: tur.cikti, commit: tcommit, mesaj: mesaj.cikti };
  }
  return { bas: bas.cikti, surumEtiketi, terfiEtiketi };
}

/**
 * Kaynak kanalda yayındaki sürüm(ler). Panel: `latest.yml`; tablet: OTA manifesti + APK künyesi
 * (aynı `tablet-v*` çizgisi — biri ≥ X ise yeter).
 * @returns {Array<{ne: string, url: string, durum: 'var'|'yok'|'olculemedi', surum?: string, neden?: string}>}
 */
export function kaynakSurumleri(kaynakKanal, urun, oku) {
  // Adres → VDS yolu yalnız KAYNAK kanalın kaydından çözülür (başka kanalın dosyası okunamaz).
  oku ??= (url) => yayinOku(url, { kayit: { kanallar: { kaynak: kaynakKanal } } });
  // Backend'in HTTP yayın feed'i YOK (paketle.ps1 zip'i elden/portaldan gider; Faz 3
  // dağıtım kapısı VDS feed'ini ekleyene kadar). ③ şartı ÖLÇÜLEMEZ → terfi ÖLÇÜLEMEDİ =
  // DUR (fail-closed: backend üretim kanalına HTTP kapısıyla otomatik terfi ettirilemez).
  if (urun === 'backend') {
    return [{ ne: 'backend yayın sürümü', url: null, durum: 'olculemedi',
      neden: 'backend HTTP yayın feed\'i Faz 3 dağıtım kapısına kadar YOK — kaynak kanaldaki sürüm ölçülemez' }];
  }
  const y = kaynakKanal.yayin;
  const ozet = (ne, url, r, cikar) => {
    if (r.durum !== 'var') return { ne, url, ...r };
    const surum = cikar(r.govde);
    return ayristir(surum) ? { ne, url, durum: 'var', surum } : { ne, url, durum: 'olculemedi', neden: `${url}: sürüm ayrıştırılamadı` };
  };
  if (urun === 'panel') {
    return [ozet('panel latest.yml', y.panelManifest, oku(y.panelManifest),
      (g) => /^version:\s*['"]?([^\s'"]+)['"]?\s*$/m.exec(g)?.[1] ?? null)];
  }
  return [
    ozet('tablet OTA manifesti', y.otaManifest,
      oku(y.otaManifest),
      (g) => manifestGovdesindenSurum(g)),
    ozet('tablet APK künyesi', y.apkKunye, oku(y.apkKunye), (g) => {
      try {
        return JSON.parse(g)?.versionName ?? null;
      } catch {
        return null;
      }
    }),
  ];
}

/* ------------------------------------------------------------------ *
 * Hüküm — saf
 * ------------------------------------------------------------------ */

/**
 * @param {object} o
 * @param {string} o.kod hedef kanal · @param {string} o.urun panel|tablet · @param {string} o.surum X
 * @param {string|null} o.kaynak terfiKaynagi · @param {object|null} o.git gitOlgulari()
 * @param {Array|null} o.kaynaklar kaynakSurumleri() — null = ölçülmedi (kuru kip)
 * @param {string|undefined} o.atla kullanıcının kaçış cümlesi (verilmediyse undefined)
 * @returns {{sonuc: 'uyumlu'|'ihlal'|'olculemedi', gerekmez?: boolean, atlandi?: {cumle: string}, satirlar: string[]}}
 */
export function terfiHukmu({ kod, urun, surum, kaynak, git, kaynaklar, atla }) {
  if (!kaynak) {
    if (atla !== undefined) {
      return { sonuc: 'ihlal', satirlar: [`"${kod}" kanalı terfi istemiyor (terfiKaynagi yok) — --terfi-atla bu kanalda verilemez.`] };
    }
    return { sonuc: 'uyumlu', gerekmez: true, satirlar: [`"${kod}" kanalı terfi istemiyor (terfiKaynagi yok).`] };
  }
  if (atla !== undefined) {
    const c = cumleDenetle(atla);
    if (!c.gecerli) {
      return { sonuc: 'ihlal', satirlar: [
        `--terfi-atla REDDEDİLDİ: ${c.sebep}.`,
        'Kaçış yalnız KULLANICININ cümlesiyle verilir; cümle yayın defterine ve etiket mesajına yazılır.',
      ] };
    }
    return { sonuc: 'uyumlu', atlandi: { cumle: c.cumle }, satirlar: [
      `TERFİ ATLANDI (${kaynak} → ${kod}, ${urun} ${surum}) — kullanıcının cümlesi: "${c.cumle}"`,
      'Üç şartın hiçbiri ölçülmedi. Cümle yayın defterine ve etiket mesajına yazılır.',
    ] };
  }

  const ihlal = [];
  const olculemedi = [];
  const tamam = [];
  const se = etiketAdi(urun, surum);
  const te = terfiEtiketAdi(kod, urun, surum);
  const kisa = (s) => (s ? s.slice(0, 10) : '-');
  if (!ayristir(surum)) olculemedi.push(`sürüm "${surum}" ayrıştırılamadı`);

  if (git) {
    if (!git.surumEtiketi) ihlal.push(`① ${se} etiketi YOK — ${kod} yalnız ${kaynak} kanalına çıkmış (etiketli) koddan derlenir.`);
    else if (git.surumEtiketi !== git.bas) {
      ihlal.push(`① HEAD (${kisa(git.bas)}) ≠ ${se} (${kisa(git.surumEtiketi)}) — önce: git checkout --detach ${se}`);
    } else tamam.push(`① HEAD == ${se}`);

    const t = git.terfiEtiketi;
    if (!t) ihlal.push(`② ${te} onay etiketi YOK — ${kaynak} testinden sonra kullanıcının cümlesiyle atılır (git tag -a ${te} ${se} -m "<cümle, saat>").`);
    else if (t.tur !== 'tag') ihlal.push(`② ${te} AÇIKLAMALI değil (hafif etiket) — onay cümlesi ve saati taşımaz; git tag -a ile yeniden atılır.`);
    else if (t.commit !== git.bas) ihlal.push(`② ${te} HEAD'de değil (${kisa(t.commit)} ≠ ${kisa(git.bas)}) — onaylanan kod bu değil.`);
    else if (!cumleDenetle(t.mesaj).gecerli) ihlal.push(`② ${te} mesajı onay cümlesini taşımıyor (${cumleDenetle(t.mesaj).sebep}).`);
    else tamam.push(`② ${te} HEAD'de — onay: "${cumleDenetle(t.mesaj).cumle.slice(0, 120)}"`);
  }

  if (kaynaklar === null) {
    tamam.push(`③ ${kaynak} kanalında yayındaki sürüm ÖLÇÜLMEDİ (kuru kip: ağ yok) — gerçek yayında ölçülür`);
  } else if (ayristir(surum)) {
    const yeter = kaynaklar.filter((k) => k.durum === 'var' && karsilastir(k.surum, surum) >= 0);
    if (yeter.length) tamam.push(`③ ${kaynak}: ${yeter.map((k) => `${k.ne} ${k.surum}`).join(' · ')} ≥ ${surum}`);
    else {
      const okunamayan = kaynaklar.filter((k) => k.durum === 'olculemedi');
      const tarif = kaynaklar.map((k) => `${k.ne}: ${k.durum === 'var' ? k.surum : k.durum === 'yok' ? 'yayın yok' : `okunamadı (${k.neden})`}`).join(' · ');
      if (okunamayan.length) olculemedi.push(`③ ${kaynak} kanalında yayındaki sürüm OKUNAMADI — ${tarif}`);
      else ihlal.push(`③ ${kaynak} kanalı GERİDE — ${tarif}; ${urun} ${surum} önce ${kaynak} kanalında yayınlanır ve test edilir.`);
    }
  }

  const satirlar = [...tamam.map((x) => `✓ ${x}`), ...ihlal.map((x) => `✖ ${x}`), ...olculemedi.map((x) => `? ${x}`)];
  if (ihlal.length) return { sonuc: 'ihlal', satirlar };
  if (olculemedi.length) return { sonuc: 'olculemedi', satirlar };
  return { sonuc: 'uyumlu', satirlar };
}

/**
 * Kapının tamamı: olguları toplar, hükmü verir. Kayıt/git okunamazsa ÖLÇÜLEMEDİ (fırlatmaz).
 * @param {{kod: string, urun: string, surum: string, atla?: string, kuru?: boolean, kok?: string, kayit?: object, oku?: Function}} o
 */
export function terfiKapisi({ kod, urun, surum, atla, kuru = false, kok = KOK, kayit, oku }) {
  if (!TERFI_URUNLERI.includes(urun)) return { sonuc: 'olculemedi', satirlar: [`bilinmeyen ürün "${urun}" (${TERFI_URUNLERI.join(' | ')})`] };
  let k;
  try {
    k = kanalCoz(kod, { kok, kayit }).kayit;
  } catch (e) {
    if (e instanceof Olculemedi) return { sonuc: 'olculemedi', satirlar: [e.message] };
    return { sonuc: 'ihlal', satirlar: [e.message, ...(e.satirlar ?? [])] };
  }
  const kaynak = terfiKaynagi(k, kod);
  if (!kaynak || atla !== undefined) return terfiHukmu({ kod, urun, surum, kaynak, git: null, kaynaklar: null, atla });
  if (!k.kanallar[kaynak]) return { sonuc: 'olculemedi', satirlar: [`terfi kaynağı "${kaynak}" kayıtta yok`] };
  if (!ayristir(surum)) return { sonuc: 'olculemedi', satirlar: [`sürüm "${surum ?? ''}" okunamadı/ayrıştırılamadı — terfi şartları hangi sürüm için ölçülecek belirsiz`] };
  let git;
  try {
    git = gitOlgulari({ kod, urun, surum, kok });
  } catch (e) {
    if (e instanceof Olculemedi) return { sonuc: 'olculemedi', satirlar: [`git: ${e.message}`] };
    throw e;
  }
  const kaynaklar = kuru ? null : kaynakSurumleri(k.kanallar[kaynak], urun, oku);
  return terfiHukmu({ kod, urun, surum, kaynak, git, kaynaklar, atla });
}

/**
 * Kaçışın git kaydı: `terfi/<kanal>/<ürün>-vX` açıklamalı etiketi, mesajı kullanıcının cümlesi +
 * saat. Yayın BİTTİKTEN sonra, best-effort (etiketAt ile aynı gerekçe); var olan etiket TAŞINMAZ.
 * @returns {{durum: 'atildi'|'zaten-var'|'basarisiz', ad: string, not?: string}}
 */
export function terfiAtlaKaydi({ kod, urun, surum, cumle, saat, kok = KOK }) {
  const ad = terfiEtiketAdi(kod, urun, surum);
  const g = (...a) => execFileSync('git', a, { cwd: kok, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    if (g('tag', '--list', ad)) return { durum: 'zaten-var', ad };
    g('tag', '-a', ad, '-m', terfiAtlaMesaji({ kod, urun, surum, cumle, saat }));
  } catch (e) {
    return { durum: 'basarisiz', ad, not: String(e?.stderr ?? e?.message ?? e).trim().slice(0, 200) };
  }
  try {
    g('push', 'origin', ad);
  } catch {
    return { durum: 'atildi', ad, not: `uzağa itilemedi — git push origin ${ad}` };
  }
  return { durum: 'atildi', ad };
}

/** Çıktı satırları — dört betik aynı biçimde basar. */
export function terfiRaporu(h, { kod, urun, surum }) {
  const bas = {
    uyumlu: h.gerekmez ? null : h.atlandi ? `⚠  TERFİ KAPISI ATLANDI — ${urun} ${surum} → ${kod}` : `✓ terfi kapısı: ${urun} ${surum} → ${kod}`,
    ihlal: `✖ TERFİ KAPISI — ${urun} ${surum} "${kod}" kanalına çıkamaz`,
    olculemedi: `✖ TERFİ KAPISI ÖLÇÜLEMEDİ — ${urun} ${surum} → ${kod} (ölçülemeyen şart geçmiş şart değildir: DUR)`,
  }[h.sonuc];
  return bas ? [bas, ...h.satirlar.map((s) => `    ${s}`)] : [];
}
