// =============================================================================
// PANEL SÜRÜM KÜNYESİ — imzalı yayın künyesi (`typ: tekserp-panel`) · TEK KAYNAK, BAĞIMLILIKSIZ (yalnız node:)
// =============================================================================
// Üç tüketici aynı kuralı buradan alır:
//   · panel ana süreci (`guncelleme-dogrulama.ts`): indirmeden ÖNCE künyeyi, indirdikten SONRA ve kurmadan
//     hemen ÖNCE dosyayı doğrular — doğrulanamayan güncelleme KURULMAZ (fail-closed);
//   · yayın kapısı (`scripts/kanal-kapisi.mjs panel-imza`): imzasız/bozuk künyeli latest.yml YÜKLENMEZ;
//   · imza aracı (`Teks-Erp/scripts/panel-imza.ts`): yükü kurar, imzalar, latest.yml'e yazar.
// Künye latest.yml'in İÇİNDEDİR (`tekserp: {v, bildirim}` — Dağıtım v2 işaretçisinin biçimi; `latest-yml.mjs`):
// electron-updater latest.yml'i js-yaml ile ayrıştırır ve tanımadığı anahtarı olduğu gibi taşır; künyeyi bilmeyen
// eski panel onu yok sayar. Künye ile işaretçi TEK dosyadır ve EN SON yüklenir — aralarında yarım yayın doğmaz.
// İmza katmanı `kunye-jws.mjs` (protokol JWS aynası). Kâhin: `Teks-Erp/scripts/test_panel_imza.ts`.
// =============================================================================
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { anchorLookup, fail, isPlainObject, isSignerKid, ok, signJwsCompact, verifyJwsWithAnchor } from "./kunye-jws.mjs";

export const PANEL_RELEASE_TYP = "tekserp-panel";
/** latest.yml'deki blok anahtarı: `tekserp: {v: 1, bildirim: <JWS>}`. */
export const RELEASE_BLOCK_KEY = "tekserp";
export const RELEASE_DOC_VERSION = 1;
export const RELEASE_PRODUCT = "panel";
export const RELEASE_PLATFORM = "win32-x64";

const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Dağıtım v2 `ReleaseVersionSchema` ile aynı: `+yapı` eki yok, `..` doğamaz (sürüm URL segmentidir). */
const VERSION_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z]{1,20}(\.[0-9A-Za-z]{1,20}){0,3})?$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
/** Kurulum dosyası adı: yol YOK (indirme adresi feed dizininde kalır), yalnız `.exe`. */
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,115}\.exe$/;
const SHA512_HEX_PATTERN = /^[0-9a-f]{128}$/;
const ARTIFACT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const ANCHOR_MAX = 16;

export const RELEASE_ERROR_CODES = Object.freeze([
  "CAPA_BOS",
  "CAPA_GECERSIZ",
  "KUNYE_YOK",
  "KUNYE_BICIM",
  "JWS_BICIM",
  "JWS_BASLIK",
  "JWS_ALG",
  "JWS_TYP",
  "JWS_KID",
  "JWS_IMZA",
  "BELGE_SURUM",
  "BELGE_SEMA",
  "KUNYE_KANAL",
  "KUNYE_SURUM",
  "KUNYE_ESKI",
  "KUNYE_DOSYA",
  "DOSYA_OZETI",
  "DOSYA_OKUNAMADI",
  "LATEST_YML_BICIM",
]);

/**
 * Künye yükü (v:1). Yeni bilgi alanı v:1 içinde eklenebilir ve eski panel onu YOK SAYAR (protokolün `z.object`
 * kuralı); bilinen alanın anlamını daraltan her değişiklik `v`yi artırır. Dönen nesne yalnız bilinen alanlar.
 * `capa`: bu pakete GÖMÜLÜ çapanın kid'leri — paket kurulunca sahadaki panel BİR SONRAKİ sürümü yalnız bunlarla
 * doğrular; yayın kapısı yeni sürümün imzalayanını yayındaki künyenin `capa`sına karşı ölçer (rotasyon kilidi).
 */
export function decodeReleaseDoc(payload) {
  if (!isPlainObject(payload)) return fail("BELGE_SEMA", "Künye bir JSON nesnesi değil");
  if (payload.v !== RELEASE_DOC_VERSION) return fail("BELGE_SURUM", `Desteklenmeyen künye sürümü: ${String(payload.v)}`);
  const p = payload;
  const a = isPlainObject(p.paket) ? p.paket : null;
  const bad = [];
  if (p.urun !== RELEASE_PRODUCT) bad.push("urun");
  if (p.platform !== RELEASE_PLATFORM) bad.push("platform");
  if (typeof p.kanal !== "string" || !CHANNEL_PATTERN.test(p.kanal)) bad.push("kanal");
  if (typeof p.surum !== "string" || !VERSION_PATTERN.test(p.surum)) bad.push("surum");
  if (typeof p.commit !== "string" || !COMMIT_PATTERN.test(p.commit)) bad.push("commit");
  if (typeof p.yayinZamani !== "string" || !ISO_PATTERN.test(p.yayinZamani) || Number.isNaN(Date.parse(p.yayinZamani))) bad.push("yayinZamani");
  if (!Array.isArray(p.capa) || p.capa.length === 0 || p.capa.length > ANCHOR_MAX || !p.capa.every(isSignerKid) || new Set(p.capa).size !== p.capa.length) {
    bad.push("capa");
  }
  if (!a) bad.push("paket");
  else {
    if (typeof a.ad !== "string" || !ARTIFACT_NAME_PATTERN.test(a.ad)) bad.push("paket.ad");
    if (!Number.isSafeInteger(a.boyut) || a.boyut < 1 || a.boyut > ARTIFACT_MAX_BYTES) bad.push("paket.boyut");
    if (typeof a.sha512 !== "string" || !SHA512_HEX_PATTERN.test(a.sha512)) bad.push("paket.sha512");
  }
  if (bad.length) return fail("BELGE_SEMA", `Künye alanları geçersiz: ${bad.join(", ")}`);
  return ok({
    v: RELEASE_DOC_VERSION,
    urun: RELEASE_PRODUCT,
    platform: RELEASE_PLATFORM,
    kanal: p.kanal,
    surum: p.surum,
    commit: p.commit,
    yayinZamani: p.yayinZamani,
    paket: { ad: a.ad, boyut: a.boyut, sha512: a.sha512 },
    capa: [...p.capa],
  });
}

/**
 * latest.yml'deki blok (`{v, bildirim}`, KATI — imzasız alan taşımaz) → doğrulanmış künye + imzalayan kid.
 * Sıra: blok → çapa → JWS (typ · kid · imza) → şema → kanal (künye YALNIZ kendi kanalında geçerli).
 */
export function verifyReleaseBlock(block, { keys, channel }) {
  if (block === undefined || block === null) return fail("KUNYE_YOK", "latest.yml imzalı sürüm künyesi taşımıyor");
  if (!isPlainObject(block) || Object.keys(block).some((k) => k !== "v" && k !== "bildirim") || typeof block.bildirim !== "string") {
    return fail("KUNYE_BICIM", "Sürüm künyesi bloğu biçimsiz");
  }
  if (block.v !== RELEASE_DOC_VERSION) return fail("BELGE_SURUM", `Desteklenmeyen künye bloğu sürümü: ${String(block.v)}`);
  const j = verifyJwsWithAnchor(block.bildirim, { typ: PANEL_RELEASE_TYP, keys });
  if (!j.ok) return j;
  const d = decodeReleaseDoc(j.value.payload);
  if (!d.ok) return d;
  if (d.value.kanal !== channel) return fail("KUNYE_KANAL", `Künye "${d.value.kanal}" kanalının, bu panel "${channel}" kanalında`);
  return ok({ doc: d.value, kid: j.value.header.kid });
}

/** sha512: künyede küçük harf hex, latest.yml'de base64 (electron-builder biçimi). */
export function sha512HexToBase64(hex) {
  return Buffer.from(hex, "hex").toString("base64");
}

/**
 * Künye ↔ electron-updater'ın gördüğü güncelleme bilgisi (latest.yml). İndirilecek dosya künyedekinin AYNISI
 * olmalı: tek dosya, aynı ad (yol yok → indirme feed dizininde kalır), aynı boy, aynı sha512.
 */
export function checkUpdateInfo(doc, info) {
  if (!isPlainObject(info) || info.version !== doc.surum) {
    return fail("KUNYE_SURUM", `latest.yml sürümü ${String(isPlainObject(info) ? info.version : info)}, imzalı künye ${doc.surum}`);
  }
  const files = info.files;
  if (!Array.isArray(files) || files.length !== 1 || !isPlainObject(files[0])) {
    return fail("KUNYE_DOSYA", "latest.yml tam olarak bir kurulum dosyası listelemeli");
  }
  const f = files[0];
  const b64 = sha512HexToBase64(doc.paket.sha512);
  if (f.url !== doc.paket.ad || f.sha512 !== b64 || f.size !== doc.paket.boyut) {
    return fail("KUNYE_DOSYA", `latest.yml dosyası (${String(f.url)}) imzalı künyedekiyle aynı değil`);
  }
  if ((info.path !== undefined && info.path !== doc.paket.ad) || (info.sha512 !== undefined && info.sha512 !== b64)) {
    return fail("KUNYE_DOSYA", "latest.yml path/sha512 alanları imzalı künyeyle uyuşmuyor");
  }
  return ok(true);
}

const VERSION_PARTS = /^([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,6})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(text) {
  const m = typeof text === "string" ? VERSION_PARTS.exec(text) : null;
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] } : null;
}

function compareIdentifiers(a, b) {
  const an = /^[0-9]+$/.test(a);
  const bn = /^[0-9]+$/.test(b);
  if (an && bn) return Math.sign(Number(a) - Number(b));
  if (an !== bn) return an ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver önceliği (Dağıtım v2 `compareVersions` aynası): −1 · 0 · 1; biri biçimsizse null (fail-closed). */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const c = compareIdentifiers(x.pre[i], y.pre[i]);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return x.pre.length === y.pre.length ? 0 : x.pre.length < y.pre.length ? -1 : 1;
}

/** Eski bir imzalı sürümün yeniden oynatılması (geri indirme) RED: künye kurulu sürümden YENİ olmalı. */
export function checkNewer(doc, installedVersion) {
  const c = compareVersions(doc.surum, installedVersion);
  if (c === null) return fail("KUNYE_ESKI", `Sürümler karşılaştırılamadı: ${doc.surum} ↔ ${String(installedVersion)}`);
  return c > 0 ? ok(true) : fail("KUNYE_ESKI", `Künye sürümü ${doc.surum} kurulu ${installedVersion} sürümünden yeni değil`);
}

/** Panelin indirme ÖNCESİ tek kapısı: çapa → künye → latest.yml bağı → yenilik. */
export function verifyUpdateInfo(info, { keys, channel, installedVersion }) {
  const anchor = anchorLookup(keys);
  if (!anchor.ok) return anchor;
  const r = verifyReleaseBlock(isPlainObject(info) ? info[RELEASE_BLOCK_KEY] : undefined, { keys, channel });
  if (!r.ok) return r;
  const b = checkUpdateInfo(r.value.doc, info);
  if (!b.ok) return b;
  const n = checkNewer(r.value.doc, installedVersion);
  return n.ok ? r : n;
}

/** Dosyanın boyu + sha512'si (hex) — 140 MB'lık kurulum belleğe alınmadan, akışla. */
export function sha512File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    let size = 0;
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      size += chunk.length;
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ size, sha512: hash.digest("hex") }));
  });
}

/** Ölçülen dosya künyedekinin AYNISI mı (boy + sha512)? */
export function checkArtifact(doc, measured) {
  if (!isPlainObject(measured) || measured.size !== doc.paket.boyut || measured.sha512 !== doc.paket.sha512) {
    return fail("DOSYA_OZETI", `Kurulum dosyası imzalı künyeyle eşleşmiyor (${doc.paket.ad})`);
  }
  return ok(true);
}

/** Dosyayı ölçer ve künyeyle kıyaslar; okunamazsa DOSYA_OKUNAMADI (fail-closed). */
export async function verifyArtifactFile(doc, filePath) {
  let measured;
  try {
    measured = await sha512File(filePath);
  } catch (e) {
    return fail("DOSYA_OKUNAMADI", `Kurulum dosyası okunamadı: ${e instanceof Error ? e.message : String(e)}`);
  }
  const c = checkArtifact(doc, measured);
  return c.ok ? ok(measured) : c;
}

// ── İmza tarafı (yayın makinesi) — panelde çağrılmaz ─────────────────────────
/** Künye yükünü kurar ve AYNI şemadan geçirir (doğrulayan ne kabul ediyorsa imzalayan yalnız onu üretir). */
export function buildReleaseDoc({ kanal, surum, commit, yayinZamani, paket, capa }) {
  const d = decodeReleaseDoc({
    v: RELEASE_DOC_VERSION,
    urun: RELEASE_PRODUCT,
    platform: RELEASE_PLATFORM,
    kanal,
    surum,
    commit,
    yayinZamani,
    paket: isPlainObject(paket) ? { ad: paket.ad, boyut: paket.boyut, sha512: paket.sha512 } : paket,
    capa,
  });
  if (!d.ok) throw new Error(`buildReleaseDoc: ${d.message}`);
  return d.value;
}

/** Künyeyi imzalar; yük yeniden şemadan geçer (yalnız bilinen alanlar imzalanır). */
export function signReleaseDoc({ doc, kid, privateKey }) {
  const d = decodeReleaseDoc(doc);
  if (!d.ok) throw new Error(`signReleaseDoc: ${d.message}`);
  return signJwsCompact({ typ: PANEL_RELEASE_TYP, kid, payload: d.value, privateKey });
}

// ── Operatör dili ────────────────────────────────────────────────────────────
const MESSAGES = Object.freeze({
  CAPA_BOS: "Bu panelde güncelleme imza anahtarı tanımlı değil; güncelleme doğrulanamadığı için kurulmadı.",
  CAPA_GECERSIZ: "Bu paneldeki güncelleme imza anahtarı listesi bozuk; güncelleme doğrulanamadığı için kurulmadı.",
  KUNYE_YOK: "Sunulan güncelleme imzasız (sürüm künyesi yok); güvenlik nedeniyle kurulmadı.",
  KUNYE_BICIM: "Sunulan güncellemenin sürüm künyesi bozuk; güvenlik nedeniyle kurulmadı.",
  JWS_BICIM: "Sunulan güncellemenin imzası okunamadı; güvenlik nedeniyle kurulmadı.",
  JWS_BASLIK: "Sunulan güncellemenin imzası tanınmayan biçimde; güvenlik nedeniyle kurulmadı.",
  JWS_ALG: "Sunulan güncellemenin imza türü kabul edilmiyor; güvenlik nedeniyle kurulmadı.",
  JWS_TYP: "Sunulan imza bir panel sürüm künyesi değil; güvenlik nedeniyle kurulmadı.",
  JWS_KID: "Sunulan güncelleme tanınmayan bir anahtarla imzalanmış; güvenlik nedeniyle kurulmadı.",
  JWS_IMZA: "Sunulan güncellemenin imzası doğrulanamadı; güvenlik nedeniyle kurulmadı.",
  BELGE_SURUM: "Sunulan güncellemenin künye sürümü bu panelce bilinmiyor; kurulmadı.",
  BELGE_SEMA: "Sunulan güncellemenin künyesi eksik ya da geçersiz alan taşıyor; kurulmadı.",
  KUNYE_KANAL: "Sunulan güncelleme başka bir müşterinin kanalına ait; kurulmadı.",
  KUNYE_SURUM: "Sürüm dosyası (latest.yml) imzalı künyeyle uyuşmuyor; kurulmadı.",
  KUNYE_ESKI: "Sunulan güncelleme kurulu sürümden yeni değil (eski sürüm yeniden sunulmuş); kurulmadı.",
  KUNYE_DOSYA: "Sunulan kurulum dosyası imzalı künyedekiyle aynı değil; kurulmadı.",
  DOSYA_OZETI: "İndirilen kurulum dosyası imzalı künyeyle eşleşmiyor; kurulmadı ve silindi.",
  DOSYA_OKUNAMADI: "İndirilen kurulum dosyası okunamadı; kurulmadı.",
  LATEST_YML_BICIM: "Sürüm dosyası (latest.yml) beklenen biçimde değil; kurulmadı.",
});

/** Kodun operatöre görünen Türkçe karşılığı (tanınmayan kod da kurulmamış güncelleme demektir). */
export function messageFor(code) {
  return MESSAGES[code] ?? "Güncelleme güvenlik denetiminden geçemedi; kurulmadı.";
}
