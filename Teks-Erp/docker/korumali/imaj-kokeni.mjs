// =============================================================================
// KORUMALI LINUX İMAJININ CI KÖKENİ — saf hüküm (bağımlılıksız; imaja GİRMEZ: Dockerfile.dockerignore izin listesi dışı)
// =============================================================================
// Resmî taban imaj `korumali-paket.yml` işi `docker-linux-x64`te derlenir; iş, imaj arşivinden ÖLÇTÜĞÜ künyeyi
// (`imaj-kunye.json`) ayrı küçük yapıt olarak yükler. Mac'te `imaj-imzala.mjs --ci-kosu=<id>` parola sorulmadan
// ÖNCE: künyeyi o koşudan indirir, yerel tabanı `docker save` arşivinden ölçer ve bu hükmü verir. Üç sonuç:
// uyumlu · ihlal · ÖLÇÜLEMEDİ (ikisi de RED). İş akışı adı/yolu, dal, başarı ayrıca `scripts/lib/ci-kokeni.ts`te.
// =============================================================================

export const KUNYE_SURUMU = 1;
export const KUNYE_DOSYASI = 'imaj-kunye.json';
export const KUNYE_YAPITI = 'korumali-imaj-kunye-linux-x64';
export const IMAJ_YAPITI = 'korumali-imaj-linux-x64';
export const IMAJ_ARSIVI = 'tekserp-korumali-imzasiz-linux-x64.tar.gz';
export const PLATFORM = 'linux/amd64';

const SHA40 = /^[0-9a-f]{40}$/;
const OZET = /^sha256:[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SURUM = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const pozitifTam = (x) => Number.isSafeInteger(x) && x > 0;
const nesne = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const kisa = (s) => String(s ?? '(yok)').slice(0, 19);

/** Künyenin biçimi; boş dizi = biçimli. */
export function kunyeDenetle(k) {
  if (!nesne(k)) return ['künye nesne değil'];
  const e = [];
  if (k.v !== KUNYE_SURUMU) e.push(`v ${JSON.stringify(k.v)} (beklenen ${KUNYE_SURUMU})`);
  if (typeof k.commit !== 'string' || !SHA40.test(k.commit)) e.push('commit 40 haneli sha değil');
  if (!pozitifTam(k.runId)) e.push('runId pozitif tam sayı değil');
  if (!pozitifTam(k.runAttempt)) e.push('runAttempt pozitif tam sayı değil');
  if (typeof k.surum !== 'string' || !SURUM.test(k.surum)) e.push('surum biçimsiz');
  if (typeof k.platform !== 'string' || !k.platform) e.push('platform yok');
  if (typeof k.configOzeti !== 'string' || !OZET.test(k.configOzeti)) e.push('configOzeti sha256:<64> değil');
  if (!Array.isArray(k.diffIds) || k.diffIds.length === 0 || !k.diffIds.every((d) => typeof d === 'string' && OZET.test(d))) e.push('diffIds boş ya da biçimsiz');
  if (!nesne(k.native) || typeof k.native.dosya !== 'string' || typeof k.native.sha256 !== 'string' || !HEX64.test(k.native.sha256)) e.push('native {dosya, sha256} biçimsiz');
  if (!nesne(k.arsiv) || k.arsiv.dosya !== IMAJ_ARSIVI || typeof k.arsiv.sha256 !== 'string' || !HEX64.test(k.arsiv.sha256)) e.push('arsiv {dosya, sha256} biçimsiz');
  return e;
}

/**
 * Künye ↔ koşu ↔ yerel taban. `kosuId`: `--ci-kosu` değeri (metin) · `kosuCommit`: koşunun `head_sha`sı ·
 * `kunye`: indirilen künye (yoksa null) · `taban`: yerel tabanın ARŞİVDEN ölçümü {kimlik, platform, diffIds, revision} (yoksa null).
 * @returns {{ sonuc: 'uyumlu' | 'ihlal' | 'olculemedi', satirlar: string[] }}
 */
export function imajKokeniHukmu({ kosuId, kosuCommit, kunye, taban }) {
  const olc = (m) => ({ sonuc: 'olculemedi', satirlar: [m] });
  if (typeof kosuId !== 'string' || !/^\d{1,20}$/.test(kosuId)) return olc(`--ci-kosu biçimsiz: "${kosuId}"`);
  if (kunye === null || kunye === undefined) return olc(`koşu ${kosuId} künyesi (${KUNYE_DOSYASI}) yok`);
  const b = kunyeDenetle(kunye);
  if (b.length) return olc(`künye biçimsiz: ${b.join(', ')}`);
  if (typeof kosuCommit !== 'string' || !SHA40.test(kosuCommit)) return olc(`koşu ${kosuId} commit'i ölçülemedi`);
  if (!nesne(taban) || typeof taban.kimlik !== 'string' || !OZET.test(taban.kimlik) || !Array.isArray(taban.diffIds) || typeof taban.platform !== 'string') {
    return olc('yerel taban imaj arşivden ölçülemedi');
  }
  const ih = [];
  if (String(kunye.runId) !== kosuId) ih.push(`künye koşu ${kunye.runId} için — verilen --ci-kosu ${kosuId}`);
  if (kunye.platform !== PLATFORM) ih.push(`künye platformu ${kunye.platform} (${PLATFORM} bekleniyor)`);
  if (taban.platform !== PLATFORM) ih.push(`taban platformu ${taban.platform} (${PLATFORM} bekleniyor)`);
  if (kunye.commit !== kosuCommit) ih.push(`künye commit'i ${kunye.commit.slice(0, 12)} — koşunun commit'i ${kosuCommit.slice(0, 12)}`);
  if (taban.revision !== kunye.commit) ih.push(`taban revision etiketi ${String(taban.revision ?? '(yok)').slice(0, 12)} — künye commit'i ${kunye.commit.slice(0, 12)}`);
  const n = Math.max(kunye.diffIds.length, taban.diffIds.length);
  const fark = [];
  for (let i = 0; i < n; i += 1) if (kunye.diffIds[i] !== taban.diffIds[i]) fark.push(i);
  if (kunye.diffIds.length !== taban.diffIds.length) ih.push(`katman sayısı: künye ${kunye.diffIds.length} · taban ${taban.diffIds.length}`);
  else if (fark.length) ih.push(`katman ${fark[0] + 1} farklı: künye ${kisa(kunye.diffIds[fark[0]])}… · taban ${kisa(taban.diffIds[fark[0]])}…`);
  if (taban.kimlik !== kunye.configOzeti) ih.push(`imaj kimliği (config özeti) taban ${kisa(taban.kimlik)}… · künye ${kisa(kunye.configOzeti)}…`);
  if (ih.length) return { sonuc: 'ihlal', satirlar: ih };
  return {
    sonuc: 'uyumlu',
    satirlar: [`imaj kökeni: koşu ${kosuId} · ${kunye.commit.slice(0, 12)} · ${kunye.diffIds.length} katman · ${kisa(kunye.configOzeti)}… · ${PLATFORM}`],
  };
}
