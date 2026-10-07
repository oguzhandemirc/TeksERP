// =============================================================================
// PANEL İMZA KAPISI — paketleme/yayın betiklerinin panel sürüm künyesi yüklemleri · zero-dep
// =============================================================================
// Künye kuralı TEK kaynaktan: `Electron/electron/guncelleme/*.mjs` — panelin KENDİ doğrulayıcısı. Kapı, sahadaki
// panelin kabul edeceği künyeyi kabul eder; kabul etmeyeceği latest.yml YÜKLENMEZ (yeni panel imzasız ya da
// geçersiz künyeyi reddeder ve güncellemesiz kalır — bu kapı o çıkmazı yayından ÖNCE yakalar).
//   · çapa kapısı (paketleme, derlemeden ÖNCE): boş/bozuk ya da üretim dışı köklü çapalı panel PAKETLENMEZ —
//     hiçbir güncellemeyi doğrulayamayan panel çıkışsız kapıdır;
//   · çapa-paket kapısı (derlemeden SONRA, yayında da): kök çapası ana sürece gerçekten GÖMÜLMÜŞ mü;
//   · künye kapısı (yayın): zincir (kök → ISTEMCI sertifikası → imza · süre · bloktaki iptal) · kanal · latest.yml
//     bağı · kurulum dosyasının boyu + sha512'si · `capa` = kök çapası;
//   · rotasyon kilidi (yayın, ssh okuması) KÖK düzeyinde: yeni sürümün sertifikasını imzalayan kök YAYINDAKİ sürümün
//     künyesindeki `capa`da olmalı (sahadaki panel bir sonraki sürümü kendi gömülü kökleriyle doğrular).
// Sonuç üç değerli değil dört: uyumlu · imzasiz (imzalanabilir) · ihlal · ÖLÇÜLEMEDİ (`Olculemedi` fırlatılır).
// Bekçi: scripts/test_grup_yayin_kapisi.mjs (sahte ssh/scp/curl ile grup yayın betiğinin kendisi).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { KOK, Olculemedi } from './dagitim.mjs';
import { tirnakliGecer } from './panel-kimlik.mjs';
import { parseJws } from '../../Electron/electron/guncelleme/kunye-jws.mjs';
import {
  PANEL_RELEASE_TYP,
  RELEASE_DOC_VERSION,
  checkPanelRootAnchor,
  checkUpdateInfo,
  mergeReleaseRevocations,
  verifyArtifactFile,
  verifyReleaseBlock,
} from '../../Electron/electron/guncelleme/panel-kunye.mjs';
import { parseLatestYml } from '../../Electron/electron/guncelleme/latest-yml.mjs';

export const PANEL_CAPA_REL = 'Electron/electron/guncelleme/imza-capasi.json';

/** Ağaçtaki gömülecek kök çapası (`{kokler: [{kid, x, classes}]}`); okunamazsa ÖLÇÜLEMEDİ. */
export function panelCapasi(kok = KOK) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(kok, PANEL_CAPA_REL), 'utf8'));
  } catch (e) {
    throw new Olculemedi(`panel imza çapası okunamadı (${PANEL_CAPA_REL}): ${e.message}`);
  }
  if (!Array.isArray(j?.kokler)) throw new Olculemedi(`panel kök çapası biçimsiz: ${PANEL_CAPA_REL} (kokler dizisi yok)`);
  return j.kokler;
}

/** Boş çapa = hiçbir güncellemeyi doğrulayamayan panel (çıkışsız kapı); üretim biçimi (`kok-<yıl>-<n>`) dışı kök de RED. */
export function panelCapaFarki(liste) {
  const c = checkPanelRootAnchor(liste);
  return c.ok ? [] : [`${c.code}: ${c.message}`];
}

/** Paketin ana süreci çapayı ve künye doğrulayıcısını gerçekten taşıyor mu (artefakt otoritesi)? */
export function panelCapaPaketFarki(anaSurec, liste) {
  const f = [];
  for (const k of liste) {
    if (!tirnakliGecer(anaSurec, k.x)) f.push(`ana süreçte (out/main/main.js) kök ${k.kid} yok — çapa derlemeye girmemiş`);
  }
  if (!tirnakliGecer(anaSurec, PANEL_RELEASE_TYP)) f.push(`ana süreçte künye doğrulayıcısı ("${PANEL_RELEASE_TYP}") yok — bu paket imza denetlemez`);
  return f;
}

function ihlal(r) {
  return { sonuc: 'ihlal', satirlar: [`${r.code}${r.detay && r.detay !== r.code ? ` (${r.detay})` : ''}: ${r.message}`] };
}

/** Kapının künye doğrulaması panelinkiyle aynı: kökler · kanal · şimdi · bloğun kendi iptali (yerel/belirteç yok). */
function blokDogrula(blok, { kod, liste }) {
  const iptal = mergeReleaseRevocations(blok, { roots: liste, stored: null, fromToken: null });
  return verifyReleaseBlock(blok, { roots: liste, channel: kod, nowMs: Date.now(), revocation: iptal.revocation });
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
  const r = blokDogrula(p.value.tekserp, { kod, liste });
  if (!r.ok) return ihlal(r);
  const b = checkUpdateInfo(r.value.doc, p.value);
  if (!b.ok) return ihlal(b);
  const a = await verifyArtifactFile(r.value.doc, path.join(dizin, r.value.doc.paket.ad));
  if (!a.ok) return ihlal(a);
  const capa = liste.map((k) => k.kid);
  if (JSON.stringify(r.value.doc.capa) !== JSON.stringify(capa)) {
    return { sonuc: 'ihlal', satirlar: [`künyenin çapa listesi [${r.value.doc.capa.join(', ')}] paketin gömülü kök çapası [${capa.join(', ')}] değil — eski imza ya da başka ağaç`] };
  }
  return {
    sonuc: 'uyumlu',
    satirlar: [`künye geçerli · ${kod} ${r.value.doc.surum} · kid ${r.value.kid} · kök ${r.value.rootKid}`],
    kid: r.value.kid,
    rootKid: r.value.rootKid,
  };
}

/**
 * Rotasyon kilidi (KÖK düzeyinde, tasarım §3.3). `yayindaki` = kanalda yayındaki latest.yml metni (yoksa null).
 * Yayındaki künyesizse o sürüm imza denetlemez (ilk imzalı sürüm ona normal gelir); künyeliyse yeni sürümün
 * sertifikasını imzalayan kök (`yeniKok`) onun `capa`sında olmalı — `ist-*` anahtar değişimi kilide takılmaz.
 * Yayındaki künye v:2 değilse o paneller v:2'yi zaten tanımaz (BELGE_SURUM) ⇒ ihlal.
 * Yayındaki künyenin İMZASI burada doğrulanmaz: metin kendi sunucumuzdan ssh ile okunur, kapı güvenlik sınırı değil
 * bir emniyettir (yanlış anahtarla imzalanıp sahadaki bütün panelleri güncellemesiz bırakan yayını durdurur).
 */
export function panelRotasyonDenetimi({ yayindaki, yeniKok }) {
  if (yayindaki === null || yayindaki.trim() === '') return { sonuc: 'uyumlu', satirlar: ['kanalda yayın yok — rotasyon kısıtı yok'] };
  const p = parseLatestYml(yayindaki);
  if (!p.ok) throw new Olculemedi(`yayındaki latest.yml ayrıştırılamadı: ${p.message}`);
  if (p.value.tekserp === null) {
    return { sonuc: 'uyumlu', satirlar: [`yayındaki ${p.value.version} künyesiz (imza denetlemeyen panel) — ilk imzalı sürüm ona normal gelir`] };
  }
  const j = parseJws(p.value.tekserp.bildirim);
  const yuk = j.ok ? j.value.payload : null;
  const capa = yuk && Array.isArray(yuk.capa) ? yuk.capa : null;
  if (!capa) throw new Olculemedi(`yayındaki ${p.value.version} künyesinin çapa listesi okunamadı`);
  if (p.value.tekserp.v !== RELEASE_DOC_VERSION || yuk.v !== RELEASE_DOC_VERSION) {
    return {
      sonuc: 'ihlal',
      satirlar: [`yayındaki ${p.value.version} künyesi v:${String(yuk.v)} — o paneller v:${RELEASE_DOC_VERSION} künyeyi tanımaz (BELGE_SURUM), bu sürümü KURMAZLAR`],
    };
  }
  if (!capa.includes(yeniKok)) {
    return {
      sonuc: 'ihlal',
      satirlar: [
        `yayındaki ${p.value.version} panelleri yalnız [${capa.join(', ')}] köklerini tanır; ${yeniKok} kökünün sertifikasıyla imzalanan sürümü KURMAZLAR`,
        'Rotasyon: yeni kök önce çapaya eklenir (istemci-kok) ve ESKİ kökün sertifikasıyla imzalanmış bir sürümle sahaya çıkar; ancak sonra yeni kökün sertifikasıyla imzalanır.',
      ],
    };
  }
  return { sonuc: 'uyumlu', satirlar: [`rotasyon: kök ${yeniKok} yayındaki ${p.value.version} çapasında`] };
}

/** Yayındaki (kenardan okunan) latest.yml'in künyesi — `--dogrula` ve yükleme sonrası (dosyasız denetim). */
export function panelUzakKunyeDenetimi({ kod, metin, liste }) {
  const p = parseLatestYml(metin);
  if (!p.ok) return ihlal(p);
  if (p.value.tekserp === null) return { sonuc: 'imzasiz', satirlar: ['yayındaki latest.yml imzalı künye taşımıyor — imza denetleyen paneller bu sürümü KURMAZ'] };
  const r = blokDogrula(p.value.tekserp, { kod, liste });
  if (!r.ok) return ihlal(r);
  const b = checkUpdateInfo(r.value.doc, p.value);
  return b.ok ? { sonuc: 'uyumlu', satirlar: [`yayındaki künye geçerli · ${r.value.doc.surum} · kid ${r.value.kid}`] } : ihlal(b);
}
