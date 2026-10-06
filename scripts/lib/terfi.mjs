// =============================================================================
// TeksERP — TERFİ KAPISI (K5) — TEK YÜKLEM
// =============================================================================
// Terfi alan grup (dağıtım kaydında `terfiKaynagi` taşıyan grup; grup uyarlaması `scripts/lib/grup-yayin.mjs`)
// yalnız kaynak grupta YAYINLANMIŞ ve kullanıcının ONAYLADIĞI kodu alır. Üç şart, hepsi ölçülür:
//   ① HEAD == `<ürün>-v<X>` etiketinin commit'i (ilk gruba çıkan kodun ta kendisi)
//   ② `terfi/<grup>/<ürün>-v<X>` AÇIKLAMALI etiketi HEAD'de ve mesajı onay cümlesini taşır
//      (etiket commit'e bağlı → onaylanan kodu ve sürüm notu metnini dondurur)
//   ③ kaynak grupta yayındaki sürüm ≥ X (VDS dosya sisteminden SSH ile; okunamazsa ÖLÇÜLEMEDİ)
// Grup yükleyicileri ve `scripts/grup-yayin-kapisi.mjs` bu dosyanın olgu + hüküm işlevlerini çağırır.
//
// ⚠️ ÜÇ SONUÇ: uyumlu · ihlal · ÖLÇÜLEMEDİ. Ölçülemeyen şart geçmiş şart değildir.
//
// ⚠️ KAÇIŞ (S4) yalnız KULLANICININ CÜMLESİYLE: `--terfi-atla="<cümle>"`. Boş/kısa
// cümle RED; geçerli cümle yayın defterine ve etiket mesajına yazılır. `terfiKaynagi`
// olmayan grupta (kök grup) kaçış anlamsızdır → RED (alışkanlık olmasın).
//
// Yayındaki sürüm SSH ile VDS'ten okunur (scripts/lib/yayin-okuma.mjs — güncelleme sunucusu
// anonim okumaya kapalı); bekçiler PATH'e sahte `ssh` koyarak ağsız ölçer.
// =============================================================================

import { execFileSync } from 'node:child_process';

import { KOK, Olculemedi } from './dagitim.mjs';
import { ayristir, etiketAdi, karsilastir, manifestGovdesindenSurum, terfiEtiketAdi } from './surum.mjs';
import { yayinOku } from './yayin-okuma.mjs';
import { isaretciSurumu } from './backend-yayin.mjs';
import { cumleDenetle, istanbulSaati } from './kullanici-cumlesi.mjs';

/** Cümle yüklemi `kullanici-cumlesi.mjs`te (PAKET `--ci-atla` da kullanır); eski tüketiciler buradan alır. */
export { CUMLE_ASGARI_KARAKTER, CUMLE_ASGARI_KELIME, cumleDenetle, istanbulSaati } from './kullanici-cumlesi.mjs';

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

/** Kaynak kanalın `son.json`undaki bildirimin sürümü (imza yayıncıda değil güncelleyicide doğrulanır). */
function ozetBackend(url, r) {
  const ne = 'backend son.json';
  if (r.durum !== 'var') return { ne, url, ...r };
  const surum = isaretciSurumu(r.govde);
  return surum ? { ne, url, durum: 'var', surum } : { ne, url, durum: 'olculemedi', neden: `${url}: bildirim sürümü okunamadı` };
}

/**
 * Kaynak kanalda yayındaki sürüm(ler). Panel: `latest.yml`; tablet: OTA manifesti + APK künyesi
 * (aynı `tablet-v*` çizgisi — biri ≥ X ise yeter).
 * @returns {Array<{ne: string, url: string, durum: 'var'|'yok'|'olculemedi', surum?: string, neden?: string}>}
 */
export function kaynakSurumleri(kaynakKanal, urun, oku) {
  // Adres → VDS yolu yalnız KAYNAK kanalın kaydından çözülür (başka kanalın dosyası okunamaz).
  oku ??= (url) => yayinOku(url, { kayit: { kanallar: { kaynak: kaynakKanal } } });
  const y = kaynakKanal.yayin;
  // Backend (Dağıtım v2): kaynak kanalın `son.json` işaretçisindeki imzalı bildirimin sürümü.
  if (urun === 'backend') return [ozetBackend(y.backendManifest, oku(y.backendManifest))];
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
    // `karsilastir` biçimsiz (ör. prova ön sürümü) tarafta null döner; `null >= 0` JS'te TRUE'dur — açık denetim şart.
    const yeter = kaynaklar.filter((k) => {
      const c = k.durum === 'var' ? karsilastir(k.surum, surum) : null;
      return c !== null && c >= 0;
    });
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
