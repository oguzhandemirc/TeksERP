// =============================================================================
// PANEL İMZA KAPISI — paketleme/yayın betiklerinin panel sürüm künyesi yüklemleri · zero-dep
// =============================================================================
// Künye kuralı TEK kaynaktan: `Electron/electron/guncelleme/*.mjs` — panelin KENDİ doğrulayıcısı. Kapı, sahadaki
// panelin kabul edeceği künyeyi kabul eder; kabul etmeyeceği latest.yml YÜKLENMEZ (yeni panel imzasız ya da
// geçersiz künyeyi reddeder ve güncellemesiz kalır — bu kapı o çıkmazı yayından ÖNCE yakalar).
//   · çapa kapısı (paketleme, derlemeden ÖNCE): boş/bozuk çapalı panel PAKETLENMEZ — hiçbir güncellemeyi
//     doğrulayamayan panel çıkışsız kapıdır;
//   · çapa-paket kapısı (derlemeden SONRA, yayında da): çapa ana sürece gerçekten GÖMÜLMÜŞ mü;
//   · künye kapısı (yayın): imza · kanal · latest.yml bağı · kurulum dosyasının boyu + sha512'si · `capa` = çapa;
//   · rotasyon kilidi (yayın, ssh okuması): yeni sürümün imzalayanı YAYINDAKİ sürümün künyesindeki çapada olmalı
//     (sahadaki panel bir sonraki sürümü kendi gömülü çapasıyla doğrular).
// Sonuç üç değerli değil dört: uyumlu · imzasiz (imzalanabilir) · ihlal · ÖLÇÜLEMEDİ (`Olculemedi` fırlatılır).
// Bekçi: scripts/test_grup_yayin_kapisi.mjs (sahte ssh/scp/curl ile grup yayın betiğinin kendisi).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { KOK, Olculemedi } from './dagitim.mjs';
import { tirnakliGecer } from './panel-kimlik.mjs';
import { checkProductionAnchor, parseJws } from '../../Electron/electron/guncelleme/kunye-jws.mjs';
import { PANEL_RELEASE_TYP, checkUpdateInfo, verifyArtifactFile, verifyReleaseBlock } from '../../Electron/electron/guncelleme/panel-kunye.mjs';
import { parseLatestYml } from '../../Electron/electron/guncelleme/latest-yml.mjs';

export const PANEL_CAPA_REL = 'Electron/electron/guncelleme/imza-capasi.json';

/** Ağaçtaki gömülecek çapa (`{anahtarlar: [{kid, x}]}`); okunamazsa ÖLÇÜLEMEDİ. */
export function panelCapasi(kok = KOK) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(kok, PANEL_CAPA_REL), 'utf8'));
  } catch (e) {
    throw new Olculemedi(`panel imza çapası okunamadı (${PANEL_CAPA_REL}): ${e.message}`);
  }
  if (!Array.isArray(j?.anahtarlar)) throw new Olculemedi(`panel imza çapası biçimsiz: ${PANEL_CAPA_REL} (anahtarlar dizisi yok)`);
  return j.anahtarlar;
}

/** Boş çapa = hiçbir güncellemeyi doğrulayamayan panel (çıkışsız kapı); üretim biçimi dışı kid de RED. */
export function panelCapaFarki(liste) {
  const c = checkProductionAnchor(liste);
  return c.ok ? [] : [`${c.code}: ${c.message}`];
}

/** Paketin ana süreci çapayı ve künye doğrulayıcısını gerçekten taşıyor mu (artefakt otoritesi)? */
export function panelCapaPaketFarki(anaSurec, liste) {
  const f = [];
  for (const k of liste) {
    if (!tirnakliGecer(anaSurec, k.x)) f.push(`ana süreçte (out/main/main.js) çapa anahtarı ${k.kid} yok — çapa derlemeye girmemiş`);
  }
  if (!tirnakliGecer(anaSurec, PANEL_RELEASE_TYP)) f.push(`ana süreçte künye doğrulayıcısı ("${PANEL_RELEASE_TYP}") yok — bu paket imza denetlemez`);
  return f;
}

function ihlal(r) {
  return { sonuc: 'ihlal', satirlar: [`${r.code}: ${r.message}`] };
}

/**
 * Paket dizinindeki latest.yml'in künyesi sahadaki panelin kabul edeceği künye mi? İmzasız → `imzasiz`
 * (yayın betiği imza aracını çağırabilir); okunamayan latest.yml → ÖLÇÜLEMEDİ.
 */
export async function panelKunyeDenetimi({ kod, dizin, liste }) {
  let metin;
  try {
    metin = fs.readFileSync(path.join(dizin, 'latest.yml'), 'utf8');
  } catch (e) {
    throw new Olculemedi(`latest.yml okunamadı: ${e.message}`);
  }
  const p = parseLatestYml(metin);
  if (!p.ok) return ihlal(p);
  if (p.value.tekserp === null) return { sonuc: 'imzasiz', satirlar: ['latest.yml imzalı sürüm künyesi taşımıyor'] };
  const r = verifyReleaseBlock(p.value.tekserp, { keys: liste, channel: kod });
  if (!r.ok) return ihlal(r);
  const b = checkUpdateInfo(r.value.doc, p.value);
  if (!b.ok) return ihlal(b);
  const a = await verifyArtifactFile(r.value.doc, path.join(dizin, r.value.doc.paket.ad));
  if (!a.ok) return ihlal(a);
  const capa = liste.map((k) => k.kid);
  if (JSON.stringify(r.value.doc.capa) !== JSON.stringify(capa)) {
    return { sonuc: 'ihlal', satirlar: [`künyenin çapa listesi [${r.value.doc.capa.join(', ')}] paketin gömülü çapası [${capa.join(', ')}] değil — eski imza ya da başka ağaç`] };
  }
  return { sonuc: 'uyumlu', satirlar: [`künye geçerli · ${kod} ${r.value.doc.surum} · kid ${r.value.kid}`], kid: r.value.kid };
}

/**
 * Rotasyon kilidi. `yayindaki` = kanalda yayındaki latest.yml metni (yoksa null). Yayındaki künyesizse o sürüm
 * imza denetlemez (geçiş: ilk imzalı sürüm ona normal gelir); künyeliyse yeni imzalayan onun `capa`sında olmalı.
 * Yayındaki künyenin İMZASI burada doğrulanmaz: metin kendi sunucumuzdan ssh ile okunur, kapı güvenlik sınırı değil
 * bir emniyettir (yanlış anahtarla imzalanıp sahadaki bütün panelleri güncellemesiz bırakan yayını durdurur).
 */
export function panelRotasyonDenetimi({ yayindaki, yeniKid }) {
  if (yayindaki === null || yayindaki.trim() === '') return { sonuc: 'uyumlu', satirlar: ['kanalda yayın yok — rotasyon kısıtı yok'] };
  const p = parseLatestYml(yayindaki);
  if (!p.ok) throw new Olculemedi(`yayındaki latest.yml ayrıştırılamadı: ${p.message}`);
  if (p.value.tekserp === null) {
    return { sonuc: 'uyumlu', satirlar: [`yayındaki ${p.value.version} künyesiz (imza denetlemeyen panel) — ilk imzalı sürüm ona normal gelir`] };
  }
  const j = parseJws(p.value.tekserp.bildirim);
  const capa = j.ok && Array.isArray(j.value.payload.capa) ? j.value.payload.capa : null;
  if (!capa) throw new Olculemedi(`yayındaki ${p.value.version} künyesinin çapa listesi okunamadı`);
  if (!capa.includes(yeniKid)) {
    return {
      sonuc: 'ihlal',
      satirlar: [
        `yayındaki ${p.value.version} panelleri yalnız [${capa.join(', ')}] anahtarlarını tanır; ${yeniKid} ile imzalanan sürümü KURMAZLAR`,
        'Rotasyon: yeni kid önce çapaya eklenir ve ESKİ anahtarla imzalanmış bir sürümle sahaya çıkar; ancak sonra yeni anahtarla imzalanır.',
      ],
    };
  }
  return { sonuc: 'uyumlu', satirlar: [`rotasyon: ${yeniKid} yayındaki ${p.value.version} çapasında`] };
}

/** Yayındaki (kenardan okunan) latest.yml'in künyesi — `--dogrula` ve yükleme sonrası (dosyasız denetim). */
export function panelUzakKunyeDenetimi({ kod, metin, liste }) {
  const p = parseLatestYml(metin);
  if (!p.ok) return ihlal(p);
  if (p.value.tekserp === null) return { sonuc: 'imzasiz', satirlar: ['yayındaki latest.yml imzalı künye taşımıyor — imza denetleyen paneller bu sürümü KURMAZ'] };
  const r = verifyReleaseBlock(p.value.tekserp, { keys: liste, channel: kod });
  if (!r.ok) return ihlal(r);
  const b = checkUpdateInfo(r.value.doc, p.value);
  return b.ok ? { sonuc: 'uyumlu', satirlar: [`yayındaki künye geçerli · ${r.value.doc.surum} · kid ${r.value.kid}`] } : ihlal(b);
}
