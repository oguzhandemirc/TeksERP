// =============================================================================
// BEKÇİ — istemci sürüm künyesi İMZA tarafı (`scripts/panel-imza.ts` · `guven-capasi-ekle.ts istemci-kok`) + kâhin
// =============================================================================
// DB'siz, ağsız. Her şey GEÇİCİ dizinde; HOME geçici dizine çevrilir (~/.tekserp'e yazılmaz), gerçek çapalara
// dokunulmaz (çapa denemesi geçici KOPYADA). Panel doğrulayıcısı bağımlılıksız JS (Electron/electron/guncelleme/);
// protokolün JWS'i (Teks-Erp/src/lib/license/protocol/jws.ts) onun KÂHİNİdir. NE ÖLÇER:
//   §0 kâhin — `TYP.PANEL` = panelin typ'i (kayıt defterinde tekil) · protokol `signJws` ile panel `signReleaseDoc`
//      (v:2) BAYT-EŞİT · bozulmuş belgelerde protokol `verifyJws` ile JWS katmanı `verifyJwsWithAnchor` AYNI kodu verir
//   §0e–§0k istemci zinciri kâhini (`istemci-zinciri.mjs`, künye v:2; ISTEMCI-ANAHTARI-KOK-ALTINDA.md §3.2–§3.4) —
//      sabitler protokolle aynı (180 gün · saat payı · listeler · zod regex kaynağı) · imzalayıcı bayt-eşit · zincir
//      tablosunda protokol parçalarından kurulan referansla AYNI karar (kod · ayrıntı · imzalayan · kök): ⭐ tolerans
//      +1 ms / +1 gün RED · ⭐ `panel-*` kid'li v:2 RED · ⭐ yedek kid'li sertifika çapa değişmeden KABUL · iptal ·
//      sertifika ve dağıtım iptali şeması zod'la aynı kod + çıktı · iptal birleştirme en yüksek `sira`, sahte yok sayılır
//   §1 anahtar dosyası — panel anahtarı parolalı (0600, sürüm 2, düz özel yarı YOK) ve açılır; yanlış parola ·
//      PAKET anahtar dosyası (istemci imzacısı değil) · gevşek izin · düz `d` · depo içine yazım · ezme · biçim dışı
//      kid → RED · `ist-<yıl>-<n>` anahtarı üretilir ve açılır, biçim dışı ist- RED · CLI `anahtar-uret` ist- dışını üretmez
//   §2 imza aracı uçtan uca (gerçek CLI, parola stdin, künye v:2) — ist- anahtarı + varsayılan yoldaki ISTEMCI
//      sertifikası → latest.yml künyeli ve panel KABUL eder; sertifikayı çapada olmayan kök imzalamış · kurulum
//      dosyası latest.yml'den farklı · argv'de parola · gerçek kök çapası · ist- olmayan anahtar · sertifika yok ·
//      başka anahtarın sertifikası · imzalayanı iptal eden `--iptal` → RED ve latest.yml DEĞİŞMEZ; ilgisiz iptal
//      bloğa girer; imzadan sonra kurcalanan latest.yml → dogrula RED; yeniden imza tek blok
//   §2o–§2z tören araçları (I7) — sertifika-ekle: köke bağlı ISTEMCI sertifikası yanına 0600, idempotent; ⭐ x başka
//      anahtarın · başka kid · çapa dışı kök · kullanım ISTEMCI değil · farklı dosya varken → RED, yazılmaz · ⭐ 30 gün
//      kapısı (29 gün RED, 31 gün imzalar; imzala ve yeniden-imzala) · yeniden-imzala: yük aynen, panel kabul eder;
//      kurcalanmış · başka grup · ⭐ imzalayanı iptal edilmiş künye · var olan çıktı → RED · anahtar-ac kid + x, parola basılmaz
//   §3 çapa aracı (geçici kopyada) — gerçek panel kök çapası biçimde · eski `panel` ve `tablet` komutları 64, panel
//      çapası değişmez (`istemci-kok` kendi bekçisi: test_guven_capasi_ekle §8) · ⭐ tablet APK künyesi kodu YOK (K-14):
//      çapa dosyası / imza kitaplığı ağaçta yok, `apk-imzala`/`apk-dogrula` komutu çıkış 2
// ⭐ KALICI SONDA ✓K: §0c bozulma tablosu, §1/§2/§3 ret dalları her koşumda ısırır.
// NEGATİF SONDA (✓B, I2 bir kezlik, 16 mutasyon hepsi ❌): tolerans 181 · ist- önek · kid eşitliği · iptal · kullanım ·
//   uuid [1-9] · datetime ofset · çapa her aile · eşit sira kazanır · saat payı · bayi kuralı · iptal satırı yalnız pkt- ·
//   yalnız birincil -1 · iptal süreden önce · sınıf tavanı · birleştirme sahteyi kabul.
// Koşum: node ../scripts/agir-is.mjs -- npx tsx scripts/test_panel_imza.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, type KeyObject } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { regexes as zodRegex } from "zod/v4/core";
import {
  CERT_USAGES,
  CLOCK_SKEW_MS,
  CertificateSchema,
  DAY_MS,
  IsoTimeSchema,
  LICENSE_CLASSES,
  PACKAGE_ACCEPT_TOLERANCE_DAYS,
  PACKAGE_ACCEPT_TOLERANCE_MS,
  PackageRevocationSchema,
  TYP,
  b64uEncode,
  decodeDocument,
  isPackageCertificateRevoked,
  isoToMs,
  msToIso,
  parseJws,
  pickNewerPackageRevocation,
  prepareTrustAnchor,
  signJws,
  verifyCertificate,
  verifyJws,
  verifyPackageRevocation,
  type CertUsage,
  type CertificateDoc,
  type LicenseClass,
  type RootKey,
  type VerifiedPackageRevocation,
} from "../src/lib/license/protocol";
import { anahtarUret, fiksturKur, hamImzala, sertifikaBas, sertifikaYuku, type TestAnahtari } from "./lib/lisans-fikstur";
import {
  CERT_TYP,
  CERT_USAGES as ZINCIR_KULLANIMLARI,
  CLIENT_ACCEPT_TOLERANCE_DAYS,
  CLIENT_ACCEPT_TOLERANCE_MS,
  CLOCK_SKEW_MS as ZINCIR_SAAT_PAYI,
  DISTRIBUTION_REVOCATION_TYP,
  ISO_DATETIME_PATTERN,
  LICENSE_CLASSES as ZINCIR_SINIFLARI,
  UUID_PATTERN,
  decodeCertificate,
  decodeDistributionRevocation,
  mergeRevocations,
  signClientDocument,
  verifyClientSigned,
  verifyDistributionRevocation,
} from "../../Electron/electron/guncelleme/istemci-zinciri.mjs";
import { generateWrappedPackageKey, writePackageKey } from "./lib/butunluk-imza";
import { CAPA_DOSYALARI, PANEL_CAPA_DOSYASI, istemciKokCapasiOku } from "./lib/guven-capasi";
import { DEPO_KOKU, generatePanelKey, openPanelSigningKey, writePanelKey } from "./lib/panel-imza";
import { main as capaEkle } from "./guven-capasi-ekle";
import { publicKeyFromX, verifyJwsWithAnchor } from "../../Electron/electron/guncelleme/kunye-jws.mjs";
import { PANEL_RELEASE_TYP, buildReleaseDoc, checkPanelRootAnchor, signReleaseDoc, verifyUpdateInfo } from "../../Electron/electron/guncelleme/panel-kunye.mjs";
import { parseLatestYml, withReleaseBlock } from "../../Electron/electron/guncelleme/latest-yml.mjs";
// Bekçi/koşucu gerçek Anahtar Zinciri'ne GİTMEZ: parola okuyan araçlar kasa yerine stdin/dosya kullanır (scripts/lib/parola-kasasi.mjs).
process.env.TEKSERP_PAROLA_KASASI = "kapali";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TEKS = path.resolve(__dirname, "..");
const TEMP = mkdtempSync(path.join(os.tmpdir(), "panel-imza-"));
const PAROLA = "bekci-panel-parolasi-2026";
const pw = (): Promise<Buffer> => Promise.resolve(Buffer.from(PAROLA));
let sayac = 0;
function dizin(ad: string): string {
  const d = path.join(TEMP, `${ad}-${sayac++}`);
  mkdirSync(d, { recursive: true });
  return d;
}
function xOf(privateKey: KeyObject): string {
  return (privateKey.export({ format: "jwk" }) as { x: string }).x;
}

// ── §0 kâhin ─────────────────────────────────────────────────────────────────
function bolum0(): void {
  console.log("\n§0 kâhin — protokol JWS ↔ panel doğrulayıcısı");
  const typlar = Object.values(TYP);
  check("§0a TYP.PANEL = panelin typ'i (tekserp-panel) ve kayıt defterinde TEKİL", TYP.PANEL === PANEL_RELEASE_TYP && typlar.filter((t) => t === TYP.PANEL).length === 1, TYP.PANEL);
  const f0 = fiksturKur(Z0);
  const ist = anahtarUret("ist-2099-1");
  const istSertifika = sertifikaBas(f0.kok, sertifikaYuku(f0, ist, "ISTEMCI"));
  const doc = buildReleaseDoc({
    kanal: "adnansahin",
    surum: "1.4.3",
    commit: "0efe882d",
    yayinZamani: "2026-10-01T01:00:00.000Z",
    paket: { ad: "TeksERP-1.4.3-Setup.exe", boyut: 12, sha512: createHash("sha512").update("x").digest("hex") },
    capa: [f0.kok.kid],
  });
  const imzaAni = msToIso(Z0 - DAY_MS);
  const v2 = signReleaseDoc({ doc, kid: ist.kid, privateKey: ist.privateKey, certificate: istSertifika, signedAt: imzaAni });
  const v2Protokol = signJws({ typ: TYP.PANEL, kid: ist.kid, payload: { ...doc, imzaciSertifikasi: istSertifika, imzaZamani: imzaAni }, privateKey: ist.privateKey });
  check("§0b protokol signJws ile panel signReleaseDoc (v:2: yük + sertifika + imza anı) BAYT-EŞİT", v2 === v2Protokol && doc.v === 2, `${v2.length} bayt`);
  // §0c–d JWS katmanı (`kunye-jws.mjs`): gömülü çapalı imzacıyla ölçülür.
  const { privateKey } = generateKeyPairSync("ed25519");
  const kid = "panel-2099";
  const panel = signJws({ typ: TYP.PANEL, kid, payload: { ...doc }, privateKey });
  const yabanci = generateKeyPairSync("ed25519").privateKey;
  const anahtarlar = [{ kid, x: xOf(privateKey) }];
  const key = publicKeyFromX(anahtarlar[0]!.x)!;
  const [h, p, s] = panel.split(".") as [string, string, string];
  const bas = (o: unknown): string => b64uEncode(JSON.stringify(o));
  const tablo: Array<[string, string]> = [
    ["geçerli", panel],
    ["imza baytı bozuk", `${h}.${p}.${b64uEncode(Buffer.alloc(64, 3))}`],
    ["yük değişmiş", `${h}.${bas({ ...doc, surum: "9.9.9" })}.${s}`],
    ["typ başka (tekserp-surum)", signJws({ typ: "tekserp-surum", kid, payload: { ...doc }, privateKey })],
    ["bilinmeyen kid", signJws({ typ: TYP.PANEL, kid: "panel-2098", payload: { ...doc }, privateKey: yabanci })],
    ["alg none", `${bas({ alg: "none", typ: TYP.PANEL, kid })}.${p}.${s}`],
    ["alg HS256", `${bas({ alg: "HS256", typ: TYP.PANEL, kid })}.${p}.${s}`],
    ["başlıkta jwk", `${bas({ alg: "EdDSA", typ: TYP.PANEL, kid, jwk: {} })}.${p}.${s}`],
    ["iki parça", `${h}.${p}`],
    ["dolgulu base64", `${h}=.${p}.${s}`],
    ["boş", ""],
    ["çok uzun", `${h}.${"A".repeat(40 * 1024)}.${s}`],
  ];
  const farklar: string[] = [];
  for (const [ad, token] of tablo) {
    const a = verifyJws(token, { typ: TYP.PANEL, findKey: (k) => (k === kid ? key : undefined) });
    const b = verifyJwsWithAnchor(token, { typ: PANEL_RELEASE_TYP, keys: anahtarlar });
    const ka = a.ok ? "OK" : a.code;
    const kb = b.ok ? "OK" : b.code;
    if (ka !== kb) farklar.push(`${ad}: protokol ${ka} ↔ panel ${kb}`);
  }
  check(`§0c ⭐ ${tablo.length} belgelik bozulma tablosunda protokol verifyJws ile JWS katmanı (kunye-jws) AYNI sonucu verir`, farklar.length === 0, farklar.join(" · ") || "aynı");
  const ilk = verifyJwsWithAnchor(panel, { typ: PANEL_RELEASE_TYP, keys: anahtarlar });
  check("§0d körlük zemini: tablonun 'geçerli' satırı gerçekten KABUL, 'bozuk imza' gerçekten JWS_IMZA", ilk.ok && !verifyJwsWithAnchor(tablo[1]![1], { typ: PANEL_RELEASE_TYP, keys: anahtarlar }).ok);
}

// ── §0e–§0k kâhin — istemci zinciri (künye v:2) ──────────────────────────────
// Protokolde ISTEMCI zinciri için tek fonksiyon yok: referans, tasarım §3.2'nin dediği gibi protokolün parçalarından
// (`prepareTrustAnchor` · `verifyCertificate` · `verifyJws` · `isPackageCertificateRevoked` · 180 gün) kurulur ve
// bağımlılıksız aynayla AYNI vektörde (kod + ayrıntı kodu + imzalayan + kök) karşılaştırılır.
type Karar = { kod: string; detay: string; kid?: string; kok?: string };
const Z0 = Date.parse("2099-03-01T00:00:00.000Z");

function protokolKarari(token: unknown, typ: string, g: { roots: RootKey[]; nowMs: number | undefined; iptal: VerifiedPackageRevocation | null }): Karar {
  const a = prepareTrustAnchor(g.roots);
  if (!a.ok) return { kod: a.code === "GUVEN_CAPASI_BOS" ? "CAPA_BOS" : "CAPA_GECERSIZ", detay: a.code };
  const p = parseJws(token);
  if (!p.ok) return { kod: p.code, detay: p.code };
  const { kid } = p.value.header;
  if (p.value.header.typ !== typ) return { kod: "JWS_TYP", detay: "JWS_TYP" };
  if (!/^ist-[a-z0-9-]{1,40}$/.test(kid)) return { kod: "JWS_KID", detay: "JWS_KID" };
  const st = p.value.payload.imzaciSertifikasi;
  const at = p.value.payload.imzaZamani;
  if (typeof st !== "string" || !IsoTimeSchema.safeParse(at).success) return { kod: "SERTIFIKA_GECERSIZ", detay: "SERTIFIKA_YOK" };
  const c = verifyCertificate(st, { roots: g.roots, usage: "ISTEMCI", atMs: isoToMs(at as string) });
  if (!c.ok) return { kod: c.code === "SERTIFIKA_ZAMAN" ? "SERTIFIKA_SURESI" : "SERTIFIKA_GECERSIZ", detay: c.code };
  if (c.value.document.kid !== kid) return { kod: "JWS_KID", detay: "JWS_KID" };
  const j = verifyJws(token, { typ, findKey: (k) => (k === kid ? c.value.key : undefined) });
  if (!j.ok) return { kod: j.code, detay: j.code };
  const n = g.nowMs;
  if (n === undefined || !Number.isFinite(n) || n > isoToMs(c.value.document.bitis) + PACKAGE_ACCEPT_TOLERANCE_MS) return { kod: "SERTIFIKA_SURESI", detay: "TOLERANS" };
  if (isPackageCertificateRevoked(c.value.document, g.iptal)) return { kod: "SERTIFIKA_IPTAL", detay: "SERTIFIKA_IPTAL" };
  return { kod: "OK", detay: "OK", kid, kok: c.value.rootKid };
}

function aynaKarari(token: unknown, typ: string, g: { roots: RootKey[]; nowMs: number | undefined; iptal: string | null }): Karar {
  const iptal = g.iptal === null ? null : verifyDistributionRevocation(g.iptal, g.roots);
  const r = verifyClientSigned(token, { typ, roots: g.roots, nowMs: g.nowMs, revocation: iptal && iptal.ok ? iptal.value : null });
  return r.ok ? { kod: "OK", detay: "OK", kid: r.value.kid, kok: r.value.rootKid } : { kod: r.code, detay: r.detay };
}

const kararMetni = (k: Karar): string => [k.kod, k.detay, k.kid ?? "", k.kok ?? ""].join("/");

function bolum0Zincir(): void {
  console.log("\n§0e–§0k kâhin — istemci zinciri (kök → ISTEMCI sertifikası → künye v:2) ↔ protokol");
  check(
    "§0e sabitler protokolle aynı: tolerans = PAKET'in 180 günü · saat payı · sınıf ve kullanım listeleri · typ'ler · zod uuid/datetime regex'i",
    CLIENT_ACCEPT_TOLERANCE_DAYS === PACKAGE_ACCEPT_TOLERANCE_DAYS &&
      CLIENT_ACCEPT_TOLERANCE_MS === PACKAGE_ACCEPT_TOLERANCE_MS &&
      ZINCIR_SAAT_PAYI === CLOCK_SKEW_MS &&
      JSON.stringify(ZINCIR_SINIFLARI) === JSON.stringify(LICENSE_CLASSES) &&
      JSON.stringify(ZINCIR_KULLANIMLARI) === JSON.stringify(CERT_USAGES) &&
      CERT_TYP === TYP.SERTIFIKA &&
      DISTRIBUTION_REVOCATION_TYP === TYP.PAKET_IPTAL &&
      UUID_PATTERN.source === zodRegex.uuid().source &&
      ISO_DATETIME_PATTERN.source === zodRegex.datetime({ precision: null, offset: false, local: false }).source,
    `${CLIENT_ACCEPT_TOLERANCE_DAYS} gün`,
  );

  const f = fiksturKur(Z0);
  const IST1 = anahtarUret("ist-2099-1");
  const IST2 = anahtarUret("ist-2099-2");
  const PANEL = anahtarUret("panel-2099");
  const PAKETK = anahtarUret("paket-2099");
  const PKT = anahtarUret("pkt-2099-1");
  const YABANCI_KOK = anahtarUret("kok-yabanci-1");
  const KOKLER: RootKey[] = [f.kokler[0]!];
  const IKI_KOK: RootKey[] = [...f.kokler];
  const sert = (konu: TestAnahtari, ek: Partial<CertificateDoc> = {}, imzalayan: TestAnahtari = f.kok, kullanim: CertUsage = "ISTEMCI") => {
    const yuk = sertifikaYuku(f, konu, kullanim, ek);
    return { yuk, token: sertifikaBas(imzalayan, yuk) };
  };
  const S1 = sert(IST1);
  const S2 = sert(IST2);
  const BITIS = isoToMs(S1.yuk.bitis);
  const BAS = isoToMs(S1.yuk.baslangic);
  const YUK = { v: 2, urun: "panel", kanal: "test", surum: "1.5.0", capa: [f.kok.kid] };
  const kunye = (imzalayan: TestAnahtari, st: unknown, at: unknown, typ: string = TYP.PANEL, yuk: Record<string, unknown> = YUK): string =>
    hamImzala(typ, imzalayan, { ...yuk, ...(st === undefined ? {} : { imzaciSertifikasi: st }), ...(at === undefined ? {} : { imzaZamani: at }) });
  const iso = msToIso;
  const iptalBas = (satirlar: Array<{ kid: string; sertifikaId: string }>, sira: number, imzalayan: TestAnahtari = f.kok, ek: Record<string, unknown> = {}): string =>
    hamImzala(TYP.PAKET_IPTAL, imzalayan, {
      v: 1,
      iptalId: randomUUID(),
      sira,
      verilis: iso(Z0 - DAY_MS),
      iptaller: satirlar.map((s) => ({ ...s, tarih: iso(Z0 - DAY_MS), neden: "çalındı" })),
      ...ek,
    });
  const IPT_KID = iptalBas([{ kid: IST1.kid, sertifikaId: randomUUID() }], 2);
  const IPT_ID = iptalBas([{ kid: "ist-2099-9", sertifikaId: S1.yuk.sertifikaId }], 3);
  const IPT_PKT = iptalBas([{ kid: PKT.kid, sertifikaId: randomUUID() }], 1);
  const IPT_IST2 = iptalBas([{ kid: IST2.kid, sertifikaId: S2.yuk.sertifikaId }], 4);

  // §0f imza tarafı: aynanın imzalayıcısı protokol signJws ile bayt-eşit.
  const imzaAni = iso(Z0 - DAY_MS);
  const ayna = signClientDocument({ typ: TYP.PANEL, kid: IST1.kid, payload: YUK, privateKey: IST1.privateKey, certificate: S1.token, signedAt: imzaAni });
  const protokol = signJws({ typ: TYP.PANEL, kid: IST1.kid, payload: { ...YUK, imzaciSertifikasi: S1.token, imzaZamani: imzaAni }, privateKey: IST1.privateKey });
  check("§0f aynanın signClientDocument'ı protokol signJws ile BAYT-EŞİT (yük + imzaciSertifikasi + imzaZamani)", ayna === protokol, `${ayna.length} bayt`);
  let imzaReddi = 0;
  for (const g of [
    { kid: PANEL.kid, privateKey: PANEL.privateKey, certificate: S1.token },
    { kid: IST2.kid, privateKey: IST2.privateKey, certificate: S1.token },
  ]) {
    try {
      signClientDocument({ typ: TYP.PANEL, payload: YUK, signedAt: imzaAni, ...g });
    } catch {
      imzaReddi++;
    }
  }
  check("§0f' imzalayıcı panel-* kid'iyle ve başka anahtarın sertifikasıyla imzalamaz", imzaReddi === 2);

  const GECERLI = kunye(IST1, S1.token, imzaAni);
  const YEDEK = kunye(IST2, S2.token, imzaAni);
  const [h, p] = GECERLI.split(".") as [string, string, string];
  const bas = (o: unknown): string => b64uEncode(JSON.stringify(o));
  const sTok = (ek: Partial<CertificateDoc>, konu: TestAnahtari = IST1, imzalayan: TestAnahtari = f.kok, kullanim: CertUsage = "ISTEMCI") => sert(konu, ek, imzalayan, kullanim).token;
  const hamSert = (yuk: Record<string, unknown>, imzalayan: TestAnahtari = f.kok, typ: string = TYP.SERTIFIKA) => hamImzala(typ, imzalayan, yuk);
  const S1Y = S1.yuk as unknown as Record<string, unknown>;
  const kok = { roots: KOKLER, nowMs: Z0, iptal: null as string | null };
  type Vaka = [string, unknown, { roots: RootKey[]; nowMs: number | undefined; iptal: string | null }, string, string?];
  const vakalar: Vaka[] = [
    ["geçerli (birincil ist-2099-1)", GECERLI, kok, "OK"],
    ["⭐ yedek kid'li sertifika (ist-2099-2), çapa DEĞİŞMEDEN", YEDEK, kok, "OK"],
    ["yedek kid'li, iki köklü çapa", YEDEK, { ...kok, roots: IKI_KOK }, "OK"],
    ["⭐ panel-* kid'li v:2 (yükte ISTEMCI sertifikası)", kunye(PANEL, S1.token, imzaAni), kok, "JWS_KID"],
    ["⭐ panel-* kid'li, sertifikasız (v:1 biçimi imza)", hamImzala(TYP.PANEL, PANEL, { ...YUK, v: 1 }), kok, "JWS_KID"],
    ["paket-* kid'li v:2", kunye(PAKETK, S1.token, imzaAni), kok, "JWS_KID"],
    ["pkt-* kid'li, PAKET sertifikalı", kunye(PKT, sTok({}, PKT, f.kok, "PAKET"), imzaAni), kok, "JWS_KID"],
    ["kök kid'iyle doğrudan imza", kunye(f.kok, S1.token, imzaAni), kok, "JWS_KID"],
    ["typ başka (tekserp-surum)", kunye(IST1, S1.token, imzaAni, TYP.SURUM), kok, "JWS_TYP"],
    ["typ başka (tekserp-apk)", kunye(IST1, S1.token, imzaAni, TYP.APK), kok, "JWS_TYP"],
    ["sertifika yok", kunye(IST1, undefined, imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["imza zamanı yok", kunye(IST1, S1.token, undefined), kok, "SERTIFIKA_GECERSIZ"],
    ["imza zamanı ofsetli (+03:00)", kunye(IST1, S1.token, "2099-02-28T03:00:00+03:00"), kok, "SERTIFIKA_GECERSIZ"],
    ["imza zamanı yalnız tarih", kunye(IST1, S1.token, "2099-02-28"), kok, "SERTIFIKA_GECERSIZ"],
    ["imza zamanı sayı", kunye(IST1, S1.token, Z0), kok, "SERTIFIKA_GECERSIZ"],
    ["imza zamanı saniyesiz (zod kabul eder)", kunye(IST1, S1.token, "2099-02-28T10:30Z"), kok, "OK"],
    ["imza zamanı 6 haneli kesirli", kunye(IST1, S1.token, "2099-02-28T10:30:00.123456Z"), kok, "OK"],
    ["sertifika metin değil", kunye(IST1, { a: 1 }, imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika bozuk JWS", kunye(IST1, "a.b.c", imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifikayı yabancı kök imzalamış", kunye(IST1, sTok({}, IST1, YABANCI_KOK), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika imzası bozuk", kunye(IST1, `${S1.token.split(".").slice(0, 2).join(".")}.${b64uEncode(Buffer.alloc(64, 9))}`, imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika typ'i başka (tekserp-hak)", kunye(IST1, hamSert(S1Y, f.kok, TYP.HAK), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika kullanımı INDIRME (ind- kid)", kunye(IST1, sTok({}, anahtarUret("ind-2099"), f.kok, "INDIRME"), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika kullanımı PAKET, kid ist- (önek uyuşmaz)", kunye(IST1, hamSert({ ...S1Y, kullanim: "PAKET" }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika kullanımı tanınmayan", kunye(IST1, hamSert({ ...S1Y, kullanim: "PANEL" }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika v:2", kunye(IST1, hamSert({ ...S1Y, v: 2 }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika bayi tavanı taşıyor", kunye(IST1, hamSert({ ...S1Y, bayi: { bayiId: randomUUID(), moduller: [] } }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika bayi alanı yok", kunye(IST1, hamSert(Object.fromEntries(Object.entries(S1Y).filter(([k]) => k !== "bayi"))), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifikaya tanınmayan alan eklenmiş (zod düşürür)", kunye(IST1, hamSert({ ...S1Y, ekAlan: "x" }), imzaAni), kok, "OK"],
    ["sertifika kimliği büyük harf UUID (zod kabul eder)", kunye(IST1, hamSert({ ...S1Y, sertifikaId: (S1Y.sertifikaId as string).toUpperCase() }), imzaAni), kok, "OK"],
    ["sertifika kimliği sürüm 9 UUID", kunye(IST1, hamSert({ ...S1Y, sertifikaId: "123e4567-e89b-92d3-a456-426614174000" }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika sınıfı boş", kunye(IST1, hamSert({ ...S1Y, siniflar: [] }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika sınıfı tekrarlı", kunye(IST1, hamSert({ ...S1Y, siniflar: ["TEST", "TEST"] }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika bitişi başlangıçtan önce", kunye(IST1, hamSert({ ...S1Y, bitis: iso(BAS - 1) }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika tarihi artık yıl dışı 29 Şubat", kunye(IST1, hamSert({ ...S1Y, baslangic: "2098-02-29T00:00:00Z" }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika açık anahtarı 42 karakter", kunye(IST1, hamSert({ ...S1Y, x: (S1Y.x as string).slice(1) }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika kid'i büyük harfli", kunye(IST1, hamSert({ ...S1Y, kid: "ist-2099-A" }), imzaAni), kok, "SERTIFIKA_GECERSIZ"],
    ["sertifika sınıfı dar kökün yetkisini aşıyor", kunye(IST1, sTok({}, IST1, f.dar), imzaAni), { ...kok, roots: IKI_KOK }, "SERTIFIKA_GECERSIZ"],
    ["sertifika dar kökün sınıflarında", kunye(IST1, sTok({ siniflar: ["TEST"] as LicenseClass[] }, IST1, f.dar), imzaAni), { ...kok, roots: IKI_KOK }, "OK"],
    ["imza anı başlangıçtan saat payı kadar önce (sınır)", kunye(IST1, S1.token, iso(BAS - CLOCK_SKEW_MS)), kok, "OK"],
    ["imza anı başlangıçtan saat payı + 1 ms önce", kunye(IST1, S1.token, iso(BAS - CLOCK_SKEW_MS - 1)), kok, "SERTIFIKA_SURESI"],
    ["imza anı bitişten saat payı + 1 ms sonra", kunye(IST1, S1.token, iso(BITIS + CLOCK_SKEW_MS + 1)), { ...kok, nowMs: BITIS + DAY_MS }, "SERTIFIKA_SURESI"],
    ["imza anı bitişte, şimdi bitiş + 180 gün (sınır)", kunye(IST1, S1.token, iso(BITIS)), { ...kok, nowMs: BITIS + PACKAGE_ACCEPT_TOLERANCE_MS }, "OK"],
    ["⭐ tolerans + 1 ms", kunye(IST1, S1.token, iso(BITIS)), { ...kok, nowMs: BITIS + PACKAGE_ACCEPT_TOLERANCE_MS + 1 }, "SERTIFIKA_SURESI"],
    ["⭐ tolerans + 1 gün", GECERLI, { ...kok, nowMs: BITIS + PACKAGE_ACCEPT_TOLERANCE_MS + DAY_MS }, "SERTIFIKA_SURESI"],
    ["şimdi yok (KABUL kipi saat ister)", GECERLI, { ...kok, nowMs: undefined }, "SERTIFIKA_SURESI"],
    ["şimdi NaN", GECERLI, { ...kok, nowMs: Number.NaN }, "SERTIFIKA_SURESI"],
    ["imzalayan başka ist anahtarı, sertifika birincilin", kunye(IST2, S1.token, imzaAni), kok, "JWS_KID"],
    ["sertifikadaki anahtar imzalayanınki değil (x başka)", kunye(IST1, sTok({ x: IST2.x }), imzaAni), kok, "JWS_IMZA"],
    ["künye yükü imzadan sonra değişmiş", `${h}.${bas({ ...YUK, surum: "9.9.9", imzaciSertifikasi: S1.token, imzaZamani: imzaAni })}.${GECERLI.split(".")[2]}`, kok, "JWS_IMZA"],
    ["künye imzası bozuk", `${h}.${p}.${b64uEncode(Buffer.alloc(64, 3))}`, kok, "JWS_IMZA"],
    ["alg none", `${bas({ alg: "none", typ: TYP.PANEL, kid: IST1.kid })}.${p}.${GECERLI.split(".")[2]}`, kok, "JWS_ALG"],
    ["başlıkta x5c", `${bas({ alg: "EdDSA", typ: TYP.PANEL, kid: IST1.kid, x5c: [] })}.${p}.${GECERLI.split(".")[2]}`, kok, "JWS_BASLIK"],
    ["iki parça", `${h}.${p}`, kok, "JWS_BICIM"],
    ["boş", "", kok, "JWS_BICIM"],
    ["metin değil", 42, kok, "JWS_BICIM"],
    ["çapa boş", GECERLI, { ...kok, roots: [] }, "CAPA_BOS"],
    ["çapada panel-* satırı (kök olmayan)", GECERLI, { ...kok, roots: [...KOKLER, { kid: PANEL.kid, x: PANEL.x, classes: [...LICENSE_CLASSES] }] }, "CAPA_GECERSIZ"],
    ["çapada tekrarlı kök", GECERLI, { ...kok, roots: [...KOKLER, ...KOKLER] }, "CAPA_GECERSIZ"],
    ["çapada tanınmayan sınıf", GECERLI, { ...kok, roots: [{ ...KOKLER[0]!, classes: ["PANEL" as LicenseClass] }] }, "CAPA_GECERSIZ"],
    ["çapada yalnız yabancı kök", GECERLI, { ...kok, roots: [{ kid: YABANCI_KOK.kid, x: YABANCI_KOK.x, classes: [...LICENSE_CLASSES] }] }, "SERTIFIKA_GECERSIZ"],
    ["⭐ iptal: birincilin kid'i", GECERLI, { ...kok, iptal: IPT_KID }, "SERTIFIKA_IPTAL"],
    ["iptal: birincilin sertifika kimliği (başka kid'le)", GECERLI, { ...kok, iptal: IPT_ID }, "SERTIFIKA_IPTAL"],
    ["⭐ birincil iptalliyken yedek kabul (çapa aynı)", YEDEK, { ...kok, iptal: IPT_KID }, "OK"],
    ["iptal yalnız pkt-* satırı → istemciye dokunmaz", GECERLI, { ...kok, iptal: IPT_PKT }, "OK"],
    ["yedek iptalli", YEDEK, { ...kok, iptal: IPT_IST2 }, "SERTIFIKA_IPTAL"],
    ["iptalli ve toleransı geçmiş → süre önce (§3.2 sırası)", GECERLI, { ...kok, iptal: IPT_KID, nowMs: BITIS + 200 * DAY_MS }, "SERTIFIKA_SURESI"],
  ];
  const farklar: string[] = [];
  const beklenmeyen: string[] = [];
  const protIptal = (t: string | null, roots: RootKey[]): VerifiedPackageRevocation | null => {
    if (t === null) return null;
    const r = verifyPackageRevocation(t, roots);
    return r.ok ? r.value : null;
  };
  for (const [ad, token, g, beklenen] of vakalar) {
    const a = protokolKarari(token, TYP.PANEL, { roots: g.roots, nowMs: g.nowMs, iptal: protIptal(g.iptal, g.roots) });
    const b = aynaKarari(token, TYP.PANEL, g);
    if (kararMetni(a) !== kararMetni(b)) farklar.push(`${ad}: protokol ${kararMetni(a)} ↔ ayna ${kararMetni(b)}`);
    if (a.kod !== beklenen) beklenmeyen.push(`${ad}: beklenen ${beklenen}, protokol ${kararMetni(a)}`);
  }
  check(`§0g ⭐ ${vakalar.length} vakalık zincir tablosunda ayna ile protokol AYNI karar (kod · ayrıntı · imzalayan · kök)`, farklar.length === 0, farklar.join(" · ") || "aynı");
  check(`§0g' her vakanın kodu beklenen (kâhinin kendisi de sabit: ⭐ tolerans +1 ms/+1 gün RED · panel-* v:2 RED · yedek KABUL)`, beklenmeyen.length === 0, beklenmeyen.join(" · ") || "beklenen");
  const yedek = verifyClientSigned(YEDEK, { typ: TYP.PANEL, roots: KOKLER, nowMs: Z0, revocation: null });
  check(
    "§0g'' yedek künye: imzalayan ist-2099-2, kök çapadaki tek kök, dönen sertifika yedeğinki",
    yedek.ok && yedek.value.kid === IST2.kid && yedek.value.rootKid === f.kok.kid && yedek.value.certificate.sertifikaId === S2.yuk.sertifikaId,
  );

  // §0h şema aynası: sertifika ve dağıtım iptali — protokolün zod şemasıyla aynı kod ve aynı çıktı.
  const sertMut: Array<[string, Record<string, unknown>]> = [
    ["geçerli", S1Y],
    ["v yok", Object.fromEntries(Object.entries(S1Y).filter(([k]) => k !== "v"))],
    ["v metin", { ...S1Y, v: "1" }],
    ["v 2", { ...S1Y, v: 2 }],
    ["sertifikaId boş", { ...S1Y, sertifikaId: "" }],
    ["sertifikaId nil UUID", { ...S1Y, sertifikaId: "00000000-0000-0000-0000-000000000000" }],
    ["sertifikaId max UUID", { ...S1Y, sertifikaId: "ffffffff-ffff-ffff-ffff-ffffffffffff" }],
    ["sertifikaId max UUID büyük harf", { ...S1Y, sertifikaId: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" }],
    ["sertifikaId varyant c", { ...S1Y, sertifikaId: "123e4567-e89b-42d3-c456-426614174000" }],
    ["kullanim BAYI, bayi null", { ...S1Y, kullanim: "BAYI", kid: "bayi-b1" }],
    ["kullanim BAYI, bayi dolu", { ...S1Y, kullanim: "BAYI", kid: "bayi-b1", bayi: { bayiId: randomUUID(), moduller: ["finance.enabled", "patron-bulut"] } }],
    ["bayi modülü tekrarlı", { ...S1Y, kullanim: "BAYI", kid: "bayi-b1", bayi: { bayiId: randomUUID(), moduller: ["a", "a"] } }],
    ["bayi modülü biçimsiz", { ...S1Y, kullanim: "BAYI", kid: "bayi-b1", bayi: { bayiId: randomUUID(), moduller: ["A.b"] } }],
    ["bayi modülü 65 karakter", { ...S1Y, kullanim: "BAYI", kid: "bayi-b1", bayi: { bayiId: randomUUID(), moduller: [`a${"b".repeat(64)}`] } }],
    ["bayi dizi", { ...S1Y, kullanim: "BAYI", kid: "bayi-b1", bayi: [] }],
    ["kid 61 karakter gövde", { ...S1Y, kid: `ist-${"a".repeat(61)}` }],
    ["kid 60 karakter gövde", { ...S1Y, kid: `ist-${"a".repeat(60)}` }],
    ["kid alt çizgili", { ...S1Y, kid: "ist-2099_1" }],
    ["x 44 karakter", { ...S1Y, x: `${S1Y.x as string}A` }],
    ["x geçersiz karakter", { ...S1Y, x: `${(S1Y.x as string).slice(1)}+` }],
    ["siniflar metin", { ...S1Y, siniflar: "TEST" }],
    ["siniflar tanınmayan", { ...S1Y, siniflar: ["TEST", "PANEL"] }],
    ["baslangic küçük z", { ...S1Y, baslangic: "2099-02-01T00:00:00z" }],
    ["baslangic boşluklu", { ...S1Y, baslangic: "2099-02-01 00:00:00Z" }],
    ["baslangic 24:00", { ...S1Y, baslangic: "2099-02-01T24:00:00Z" }],
    ["baslangic 2096-02-29 (artık)", { ...S1Y, baslangic: "2096-02-29T00:00:00Z" }],
    ["baslangic 2100-02-29 (artık değil)", { ...S1Y, baslangic: "2100-02-29T00:00:00Z" }],
    ["baslangic 2000-02-29 (artık)", { ...S1Y, baslangic: "2000-02-29T00:00:00Z" }],
    ["baslangic 31 Nisan", { ...S1Y, baslangic: "2099-04-31T00:00:00Z" }],
    ["baslangic kesirsiz nokta", { ...S1Y, baslangic: "2099-02-01T00:00:00.Z" }],
    ["baslangic = bitis", { ...S1Y, baslangic: S1Y.bitis }],
    ["bitis sayı", { ...S1Y, bitis: BITIS }],
  ];
  const sFark: string[] = [];
  for (const [ad, yuk] of sertMut) {
    const a = decodeDocument(CertificateSchema, yuk);
    const b = decodeCertificate(yuk);
    const ka = a.ok ? `OK ${JSON.stringify(a.value)}` : a.code;
    const kb = b.ok ? `OK ${JSON.stringify(b.value)}` : b.code;
    if (ka !== kb) sFark.push(`${ad}: protokol ${ka.slice(0, 40)} ↔ ayna ${kb.slice(0, 40)}`);
  }
  check(`§0h ${sertMut.length} sertifika yükünde ayna decodeCertificate ile protokol CertificateSchema AYNI (kod + çıktı)`, sFark.length === 0, sFark.join(" · ") || "aynı");

  const iptalYuku = { v: 1, iptalId: randomUUID(), sira: 5, verilis: iso(Z0), iptaller: [{ kid: IST1.kid, sertifikaId: randomUUID(), tarih: iso(Z0), neden: "x" }] };
  const satir = iptalYuku.iptaller[0]!;
  const iptalMut: Array<[string, Record<string, unknown>]> = [
    ["geçerli", iptalYuku],
    ["boş liste", { ...iptalYuku, iptaller: [] }],
    ["pkt satırı", { ...iptalYuku, iptaller: [{ ...satir, kid: "pkt-2099-1" }] }],
    ["alt- satırı", { ...iptalYuku, iptaller: [{ ...satir, kid: "alt-2099-1" }] }],
    ["paket- satırı", { ...iptalYuku, iptaller: [{ ...satir, kid: "paket-2099" }] }],
    ["kullanim alanlı satır (zod düşürür)", { ...iptalYuku, iptaller: [{ ...satir, kullanim: "ISTEMCI" }] }],
    ["neden 200", { ...iptalYuku, iptaller: [{ ...satir, neden: "ç".repeat(200) }] }],
    ["neden 201", { ...iptalYuku, iptaller: [{ ...satir, neden: "ç".repeat(201) }] }],
    ["neden yok", { ...iptalYuku, iptaller: [{ kid: satir.kid, sertifikaId: satir.sertifikaId, tarih: satir.tarih }] }],
    ["tekrarlı sertifika", { ...iptalYuku, iptaller: [satir, { ...satir, kid: IST2.kid }] }],
    ["256 satır", { ...iptalYuku, iptaller: Array.from({ length: 256 }, () => ({ ...satir, sertifikaId: randomUUID() })) }],
    ["257 satır", { ...iptalYuku, iptaller: Array.from({ length: 257 }, () => ({ ...satir, sertifikaId: randomUUID() })) }],
    ["sira 0", { ...iptalYuku, sira: 0 }],
    ["sira 1.5", { ...iptalYuku, sira: 1.5 }],
    ["sira metin", { ...iptalYuku, sira: "5" }],
    ["sira MAX_SAFE", { ...iptalYuku, sira: Number.MAX_SAFE_INTEGER }],
    ["sira MAX_SAFE + 1", { ...iptalYuku, sira: Number.MAX_SAFE_INTEGER + 1 }],
    ["v 2", { ...iptalYuku, v: 2 }],
    ["verilis ofsetli", { ...iptalYuku, verilis: "2099-03-01T00:00:00+00:00" }],
    ["iptaller nesne", { ...iptalYuku, iptaller: {} }],
  ];
  const iFark: string[] = [];
  for (const [ad, yuk] of iptalMut) {
    const a = decodeDocument(PackageRevocationSchema, yuk);
    const b = decodeDistributionRevocation(yuk);
    const ka = a.ok ? `OK ${JSON.stringify(a.value)}` : a.code;
    const kb = b.ok ? `OK ${JSON.stringify(b.value)}` : b.code;
    if (ka !== kb) iFark.push(`${ad}: protokol ${ka.slice(0, 40)} ↔ ayna ${kb.slice(0, 40)}`);
  }
  check(`§0h' ${iptalMut.length} iptal yükünde ayna ile protokol PackageRevocationSchema AYNI (kod + çıktı)`, iFark.length === 0, iFark.join(" · ") || "aynı");

  // §0i iptal belgesinin imzası: yalnız çapadaki kök, kendi typ'i.
  const iptalTablo: Array<[string, unknown, RootKey[]]> = [
    ["geçerli", IPT_KID, KOKLER],
    ["ist anahtarı imzalamış", iptalBas([{ kid: IST1.kid, sertifikaId: randomUUID() }], 9, IST1), KOKLER],
    ["typ tekserp-iptal", hamImzala(TYP.IPTAL, f.kok, { v: 1, iptalId: randomUUID(), sira: 1, verilis: iso(Z0), iptaller: [] }), KOKLER],
    ["yabancı kök", iptalBas([], 9, YABANCI_KOK), KOKLER],
    ["dar kök imzalamış (çapada)", iptalBas([], 9, f.dar), IKI_KOK],
    ["imza bozuk", `${IPT_KID.split(".").slice(0, 2).join(".")}.${b64uEncode(Buffer.alloc(64, 1))}`, KOKLER],
    ["çapa boş", IPT_KID, []],
    ["biçimsiz", "x", KOKLER],
  ];
  const tFark: string[] = [];
  for (const [ad, token, roots] of iptalTablo) {
    const a = verifyPackageRevocation(token, roots);
    const b = verifyDistributionRevocation(token, roots);
    const ka = a.ok ? `OK ${a.value.rootKid} ${a.value.document.sira}` : a.code;
    const kb = b.ok ? `OK ${b.value.rootKid} ${b.value.document.sira}` : b.code;
    if (ka !== kb) tFark.push(`${ad}: protokol ${ka} ↔ ayna ${kb}`);
  }
  check(`§0i ${iptalTablo.length} iptal belgesinde ayna verifyDistributionRevocation ile protokol verifyPackageRevocation AYNI`, tFark.length === 0, tFark.join(" · ") || "aynı");

  // §0j iptal birleştirme: yerel → belirteç yanıtı → künye bloğu; doğrulanamayan yok sayılır, en yüksek sira kazanır.
  const SAHTE5 = iptalBas([{ kid: IST2.kid, sertifikaId: randomUUID() }], 5, IST1);
  const IPT3B = iptalBas([{ kid: "ist-2099-8", sertifikaId: randomUUID() }], 3);
  const senaryolar: Array<[string, Array<{ kaynak: string; token: string | null }>, string | null]> = [
    ["yerel 2 · sahte 5 · künye 3", [{ kaynak: "yerel", token: IPT_KID }, { kaynak: "belirtec", token: SAHTE5 }, { kaynak: "kunye", token: IPT_ID }], "kunye"],
    ["yerel 3 · künye 2 (geri alınamaz)", [{ kaynak: "yerel", token: IPT_ID }, { kaynak: "kunye", token: IPT_KID }], "yerel"],
    ["yerel 3 · belirteç başka 3 (eşitte önce gelen)", [{ kaynak: "yerel", token: IPT_ID }, { kaynak: "belirtec", token: IPT3B }], "yerel"],
    ["yerel yok · belirteç 4", [{ kaynak: "yerel", token: null }, { kaynak: "belirtec", token: IPT_IST2 }], "belirtec"],
    ["hiçbiri yok", [{ kaynak: "yerel", token: null }], null],
    ["yalnız sahte", [{ kaynak: "kunye", token: SAHTE5 }], null],
  ];
  const mFark: string[] = [];
  for (const [ad, adaylar, beklenen] of senaryolar) {
    let ref: VerifiedPackageRevocation | null = null;
    let refKaynak: string | null = null;
    for (const c of adaylar) {
      if (c.token === null) continue;
      const v = verifyPackageRevocation(c.token, KOKLER);
      if (!v.ok) continue;
      if (pickNewerPackageRevocation(ref, v.value) !== ref) {
        ref = v.value;
        refKaynak = c.kaynak;
      }
    }
    const m = mergeRevocations(KOKLER, adaylar);
    const sahteRed = adaylar.filter((c) => c.token === SAHTE5).length === m.reddedilen.length && m.reddedilen.every((r) => r.code === "KOK_BILINMIYOR");
    if (m.kaynak !== refKaynak || m.kaynak !== beklenen || (m.revocation?.document.iptalId ?? null) !== (ref?.document.iptalId ?? null) || !sahteRed) {
      mFark.push(`${ad}: ayna ${m.kaynak} ↔ protokol ${refKaynak} (beklenen ${beklenen})`);
    }
  }
  check(`§0j ${senaryolar.length} senaryoda iptal birleştirme protokolün pickNewerPackageRevocation'ıyla aynı kaynağı seçer, sahteyi reddedilende raporlar`, mFark.length === 0, mFark.join(" · ") || "aynı");
  const birlesik = mergeRevocations(KOKLER, [{ kaynak: "yerel", token: IPT_PKT }, { kaynak: "kunye", token: IPT_KID }]);
  const sonra = verifyClientSigned(GECERLI, { typ: TYP.PANEL, roots: KOKLER, nowMs: Z0, revocation: birlesik.revocation });
  check("§0k birleşik iptal (yerel pkt-only 1 · künye ist 2) birincili RED, yedeği KABUL eder", !sonra.ok && sonra.code === "SERTIFIKA_IPTAL" && verifyClientSigned(YEDEK, { typ: TYP.PANEL, roots: KOKLER, nowMs: Z0, revocation: birlesik.revocation }).ok);
}

// ── §1 anahtar dosyaları ──────────────────────────────────────────────────────
async function reddeder(fn: () => Promise<unknown>, desen: RegExp): Promise<string | null> {
  try {
    await fn();
    return "RED bekleniyordu, geçti";
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return desen.test(m) ? null : `beklenmeyen hata: ${m}`;
  }
}

interface Anahtarlar {
  readonly panelDosyasi: string;
  readonly panelX: string;
  readonly istDosyasi: string;
  readonly istX: string;
}

async function bolum1(): Promise<Anahtarlar> {
  console.log("\n§1 anahtar dosyaları — panel yayın anahtarı · ist- istemci anahtarı (künye v:2) · PAKET dosyası RED");
  const d = dizin("anahtar");
  const dosya = writePanelKey(d, await generatePanelKey("panel-2099", Buffer.from(PAROLA)));
  const k = JSON.parse(readFileSync(dosya, "utf8")) as Record<string, unknown>;
  check(
    "§1a panel anahtarı: 0600, sürüm 2, parolalı (düz `d` YOK), parola dosyada yok",
    (statSync(dosya).mode & 0o777) === 0o600 && k.tur === "tekserp-panel-anahtar" && k.surum === 2 && !("d" in k) && !readFileSync(dosya, "utf8").includes(PAROLA),
  );
  const acik = await openPanelSigningKey(dosya, pw);
  check("§1b panel anahtarı doğru parolayla açılır, açılan özel yarı dosyadaki açık yarıyla eşleşir", acik.kid === "panel-2099" && xOf(acik.privateKey) === k.x);
  check("§1c yanlış parola → RED", (await reddeder(() => openPanelSigningKey(dosya, () => Promise.resolve(Buffer.from("yanlis-parola-uzun"))), /Parola hatalı/)) === null);
  const paket = writePackageKey(dizin("paket"), await generateWrappedPackageKey("paket-2099", Buffer.from(PAROLA)));
  check("§1d üretim PAKET anahtar dosyası (paket-<yıl>) istemci imza anahtarı olarak AÇILMAZ (APK künyesi seçeneği kalktı)", (await reddeder(() => openPanelSigningKey(paket, pw), /tanınmayan anahtar dosyası türü/)) === null);
  const gevsek = path.join(dizin("gevsek"), "panel-2099.panel.json");
  copyFileSync(dosya, gevsek);
  chmodSync(gevsek, 0o644);
  check("§1f gevşek izinli (644) anahtar dosyası → RED", (await reddeder(() => openPanelSigningKey(gevsek, pw), /chmod 600/)) === null);
  const duz = path.join(dizin("duz"), "panel-2099.panel.json");
  writeFileSync(duz, JSON.stringify({ ...k, d: b64uEncode(randomBytes(32)) }), { mode: 0o600 });
  check("§1g düz özel yarı (`d`) taşıyan panel dosyası → RED (biçimsiz)", (await reddeder(() => openPanelSigningKey(duz, pw), /biçimsiz/)) === null);
  check("§1h depo İÇİNE yazım → RED", (await reddeder(async () => writePanelKey(path.join(DEPO_KOKU, "tmp-panel-anahtari"), await generatePanelKey("panel-2098", Buffer.from(PAROLA))), /depo içine/)) === null);
  check("§1i var olan dosyanın üstüne yazım → RED", (await reddeder(async () => writePanelKey(d, await generatePanelKey("panel-2099", Buffer.from(PAROLA))), /EEXIST/)) === null);
  check("§1j biçim dışı kid (panel-fikstur) ile anahtar üretilmez", (await reddeder(() => generatePanelKey("panel-fikstur", Buffer.from(PAROLA)), /panel-<yıl>/)) === null);
  check("§1k zayıf parola ile anahtar üretilmez", (await reddeder(() => generatePanelKey("panel-2097", Buffer.from("kisa")), /en az 12/)) === null);
  const istDizin = dizin("ist");
  const istDosyasi = writePanelKey(istDizin, await generatePanelKey("ist-2099-1", Buffer.from(PAROLA)));
  const ik = JSON.parse(readFileSync(istDosyasi, "utf8")) as Record<string, unknown>;
  const istAcik = await openPanelSigningKey(istDosyasi, pw);
  check(
    "§1l ist-<yıl>-<n> istemci anahtarı üretilir (0600, parolalı, aynı sarma) ve açılır",
    (statSync(istDosyasi).mode & 0o777) === 0o600 && !("d" in ik) && istAcik.kid === "ist-2099-1" && xOf(istAcik.privateKey) === ik.x,
  );
  check("§1m biçim dışı ist- kid (ist-fikstur · ist-2099) ile anahtar üretilmez", (await reddeder(() => generatePanelKey("ist-fikstur", Buffer.from(PAROLA)), /ist-<yıl>-<n>/)) === null && (await reddeder(() => generatePanelKey("ist-2099", Buffer.from(PAROLA)), /ist-<yıl>-<n>/)) === null);
  const cliDizin = dizin("cli-anahtar");
  const cu = cli(["anahtar-uret", "--kid=panel-2099", `--dizin=${cliDizin}`], `${PAROLA}\n${PAROLA}\n`);
  check("§1n ⭐ CLI anahtar-uret panel-<yıl> üretmez (çıkış 2, dosya yok)", cu.kod === 2 && !existsSync(path.join(cliDizin, "panel-2099.panel.json")), `çıkış ${cu.kod} ${cu.cikti.trim().slice(-120)}`);
  return { panelDosyasi: dosya, panelX: String(k.x), istDosyasi, istX: String(ik.x) };
}

// ── §2 imza aracı uçtan uca ───────────────────────────────────────────────────
interface Kosum {
  readonly kod: number | null;
  readonly cikti: string;
}
function cli(argv: readonly string[], input = ""): Kosum {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/panel-imza.ts", ...argv], {
    cwd: TEKS,
    input,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME: path.join(TEMP, "ev") },
  });
  return { kod: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** electron-builder çıktısı gibi: kurulum dosyası + latest.yml (imzasız). */
function paketDizini(surum = "1.4.3"): { dizin: string; latest: string; exe: string } {
  const d = dizin("paket");
  const ad = `TeksERP-${surum}-Setup.exe`;
  const govde = randomBytes(8192);
  writeFileSync(path.join(d, ad), govde);
  const b64 = createHash("sha512").update(govde).digest("base64");
  writeFileSync(path.join(d, "latest.yml"), `version: ${surum}\nfiles:\n  - url: ${ad}\n    sha512: ${b64}\n    size: ${govde.length}\n    isAdminRightsRequired: true\npath: ${ad}\nsha512: ${b64}\nreleaseDate: '2026-10-01T01:00:00.000Z'\n`);
  return { dizin: d, latest: path.join(d, "latest.yml"), exe: path.join(d, ad) };
}

function capaDosyasi(kokler: ReadonlyArray<RootKey>): string {
  const f = path.join(dizin("capa"), "capa.json");
  writeFileSync(f, JSON.stringify({ kokler }));
  return f;
}

function bolum2(anahtar: Anahtarlar): void {
  console.log("\n§2 imza aracı uçtan uca (gerçek CLI, parola stdin, künye v:2)");
  const simdi = Date.now();
  const f = fiksturKur(simdi);
  const kokler: RootKey[] = [f.kokler[0]!];
  const capa = capaDosyasi(kokler);
  const konu = { kid: "ist-2099-1", x: anahtar.istX } as TestAnahtari;
  const sertYuk = sertifikaYuku(f, konu, "ISTEMCI");
  // Sertifika varsayılan yolda: anahtar dosyasının yanında `<kid>.sertifika.json` (`{sertifika: <JWS>}`).
  writeFileSync(path.join(path.dirname(anahtar.istDosyasi), "ist-2099-1.sertifika.json"), JSON.stringify({ sertifika: sertifikaBas(f.kok, sertYuk) }));
  const sertifikaDosyasi = (token: string): string => {
    const yol = path.join(dizin("sertifika"), "s.json");
    writeFileSync(yol, JSON.stringify({ sertifika: token }));
    return yol;
  };
  const p = paketDizini();
  const imzala = (dizinPaket: string, ek: readonly string[] = [], capaYolu: string | null = capa, anahtarDosyasi = anahtar.istDosyasi): Kosum =>
    cli(["imzala", "--musteri=adnansahin", `--dizin-paket=${dizinPaket}`, `--anahtar=${anahtarDosyasi}`, ...(capaYolu ? [`--capa=${capaYolu}`] : []), ...ek], `${PAROLA}\n`);
  const r = imzala(p.dizin);
  const metin = readFileSync(p.latest, "utf8");
  const info = parseLatestYml(metin);
  const v = info.ok ? verifyUpdateInfo(info.value, { roots: kokler, channel: "adnansahin", installedVersion: "1.4.2", nowMs: Date.now() }) : null;
  check(
    "§2a imzala (ist- anahtarı + varsayılan yoldaki ISTEMCI sertifikası) → çıkış 0, künye v:2 ve panelin doğrulayıcısı KABUL eder",
    r.kod === 0 && v?.ok === true && v.value.kid === "ist-2099-1" && v.value.rootKid === f.kok.kid && /^ {2}v: 2$/m.test(metin),
    r.cikti.trim().slice(-200),
  );
  check("§2b dogrula (aynı çapa) → çıkış 0", cli(["dogrula", "--musteri=adnansahin", `--dizin-paket=${p.dizin}`, `--capa=${capa}`]).kod === 0);
  const ikinci = imzala(p.dizin);
  check("§2c yeniden imza → tek künye bloğu, yine geçerli", ikinci.kod === 0 && (readFileSync(p.latest, "utf8").match(/^tekserp:$/gm) ?? []).length === 1);

  const reddet = (ad: string, kosum: () => Kosum, desen: RegExp, kaynak = paketDizini()): void => {
    const once = readFileSync(kaynak.latest);
    const k = kosum();
    check(`${ad} → RED, latest.yml DEĞİŞMEDİ`, k.kod !== 0 && desen.test(k.cikti) && readFileSync(kaynak.latest).equals(once), `çıkış ${k.kod} ${k.cikti.trim().slice(-160)}`);
  };
  const q = paketDizini();
  const yabanciKok = anahtarUret("kok-yabanci-1");
  reddet("§2d sertifikayı imzalayan kök çapada değil (çapa yalnız kok-yabanci-1)", () => imzala(q.dizin, [], capaDosyasi([{ kid: yabanciKok.kid, x: yabanciKok.x, classes: [...LICENSE_CLASSES] }])), /SERTIFIKA_GECERSIZ/, q);
  const w = paketDizini();
  writeFileSync(w.exe, randomBytes(8192));
  reddet("§2e kurulum dosyası latest.yml'in söylediği değil (eski derleme kalıntısı)", () => imzala(w.dizin), /uyuşmuyor/, w);
  const a = paketDizini();
  reddet("§2f argv'de parola", () => cli(["imzala", "--musteri=adnansahin", `--dizin-paket=${a.dizin}`, `--anahtar=${anahtar.istDosyasi}`, `--capa=${capa}`, "--parola=x"]), /Parola argümandan ALINMAZ/, a);
  const g = paketDizini();
  reddet("§2g gerçek üretim kök çapası (test sertifikasını o kök imzalamadı)", () => imzala(g.dizin, [], null), /SERTIFIKA_GECERSIZ|CAPA_BOS|kullanılamaz/, g);
  const t = paketDizini();
  imzala(t.dizin);
  writeFileSync(t.latest, readFileSync(t.latest, "utf8").replace(/size: (\d+)/, (_m, n: string) => `size: ${Number(n) + 1}`));
  const dk = cli(["dogrula", "--musteri=adnansahin", `--dizin-paket=${t.dizin}`, `--capa=${capa}`]);
  check("§2h imzadan SONRA kurcalanan latest.yml (boy) → dogrula RED (KUNYE_DOSYA)", dk.kod !== 0 && /KUNYE_DOSYA/.test(dk.cikti), dk.cikti.trim().slice(-160));
  const b = cli(["dogrula", "--musteri=testfabrika", `--dizin-paket=${p.dizin}`, `--capa=${capa}`]);
  check("§2i başka kanal adına doğrulama → RED (KUNYE_KANAL)", b.kod !== 0 && /KUNYE_KANAL/.test(b.cikti), b.cikti.trim().slice(-160));
  const j = paketDizini();
  reddet("§2j ⭐ ist- olmayan anahtar (panel-2099, gömülü çapalı v:1 ailesi) panel künyesini imzalamaz", () => imzala(j.dizin, [], capa, anahtar.panelDosyasi), /yalnız ist-\* anahtarı/, j);
  const k = paketDizini();
  reddet("§2k sertifika dosyası yok", () => imzala(k.dizin, [`--sertifika=${path.join(TEMP, "yok.sertifika.json")}`]), /sertifikası okunamadı/, k);
  const m = paketDizini();
  reddet("§2l başka anahtarın sertifikası", () => imzala(m.dizin, [`--sertifika=${sertifikaDosyasi(sertifikaBas(f.kok, sertifikaYuku(f, anahtarUret("ist-2099-2"), "ISTEMCI")))}`]), /bu anahtarın değil/, m);
  const iptalYolu = path.join(dizin("iptal"), "iptal.jws");
  const iptalBas = (satirKid: string, sertifikaId: string): string =>
    hamImzala(TYP.PAKET_IPTAL, f.kok, {
      v: 1,
      iptalId: randomUUID(),
      sira: 1,
      verilis: msToIso(simdi - DAY_MS),
      iptaller: [{ kid: satirKid, sertifikaId, tarih: msToIso(simdi - DAY_MS), neden: "çalındı" }],
    });
  writeFileSync(iptalYolu, iptalBas("ist-2099-1", randomUUID()));
  const n = paketDizini();
  reddet("§2m ⭐ --iptal imzalayanın sertifikasını iptal ediyor → geri doğrulama SERTIFIKA_IPTAL", () => imzala(n.dizin, [`--iptal=${iptalYolu}`]), /SERTIFIKA_IPTAL/, n);
  const baskaIptal = path.join(dizin("iptal"), "baska.jws");
  writeFileSync(baskaIptal, iptalBas("ist-2099-9", randomUUID()));
  const o = paketDizini();
  const oi = imzala(o.dizin, [`--iptal=${baskaIptal}`]);
  const oMetin = readFileSync(o.latest, "utf8");
  check("§2n başka anahtarın iptali bloğa `iptal:` olarak girer, künye geçerli kalır", oi.kod === 0 && /^ {2}iptal: /m.test(oMetin), oi.cikti.trim().slice(-160));
}

// ── §2o–§2z tören araçları (I7): sertifika-ekle · 30 gün kapısı · yeniden-imzala · anahtar-ac ─────────────────
async function bolum2Toren(anahtar: Anahtarlar): Promise<void> {
  console.log("\n§2o–§2z tören araçları — sertifika-ekle (x eşleşmesi) · 30 gün kapısı · yeniden-imzala · anahtar-ac");
  const simdi = Date.now();
  const f = fiksturKur(simdi);
  const kokler: RootKey[] = [f.kokler[0]!];
  const capa = capaDosyasi(kokler);
  const sertDosyasi = (token: string): string => {
    const yol = path.join(dizin("sertifika"), "s.json");
    writeFileSync(yol, JSON.stringify({ sertifika: token }));
    return yol;
  };
  const yeniAnahtar = async (kid: string): Promise<{ dosya: string; konu: TestAnahtari }> => {
    const dosya = writePanelKey(dizin("ist-toren"), await generatePanelKey(kid, Buffer.from(PAROLA)));
    return { dosya, konu: { kid, x: String((JSON.parse(readFileSync(dosya, "utf8")) as { x: string }).x) } as TestAnahtari };
  };
  const sert = (konu: TestAnahtari, ek: Partial<CertificateDoc> = {}, imzalayan: TestAnahtari = f.kok, kullanim: CertUsage = "ISTEMCI") => sertifikaBas(imzalayan, sertifikaYuku(f, konu, kullanim, ek));
  const ekle = (dosya: string, sertYolu: string): Kosum => cli(["sertifika-ekle", `--anahtar=${dosya}`, `--sertifika=${sertYolu}`, `--capa=${capa}`]);
  const yanindaki = (dosya: string, kid: string) => path.join(path.dirname(dosya), `${kid}.sertifika.json`);

  const a3 = await yeniAnahtar("ist-2099-3");
  const iyi = sertDosyasi(sert(a3.konu));
  const e1 = ekle(a3.dosya, iyi);
  const e2 = ekle(a3.dosya, iyi);
  const yazilan = yanindaki(a3.dosya, "ist-2099-3");
  check("§2o sertifika-ekle: köke bağlı ISTEMCI sertifikası (kid + x anahtarınki) → anahtarın yanına 0600; aynısı ikinci kez → 0, dokunulmaz",
    e1.kod === 0 && existsSync(yazilan) && (statSync(yazilan).mode & 0o777) === 0o600 && e2.kod === 0 && /zaten ekli/.test(e2.cikti), `${e1.kod}/${e2.kod} ${e1.cikti.trim().slice(-160)}`);
  const sertRed = async (ad: string, token: (konu: TestAnahtari) => string, desen: RegExp): Promise<void> => {
    const a = await yeniAnahtar("ist-2099-4");
    const k = ekle(a.dosya, sertDosyasi(token(a.konu)));
    check(`${ad} → RED, sertifika EKLENMEDİ`, k.kod !== 0 && desen.test(k.cikti) && !existsSync(yanindaki(a.dosya, "ist-2099-4")), `çıkış ${k.kod} ${k.cikti.trim().split("\n").pop()?.slice(0, 160)}`);
  };
  await sertRed("§2p ⭐ sertifika-ekle: kid aynı ama x BAŞKA anahtarın", () => sert(anahtarUret("ist-2099-4")), /sertifikadaki açık anahtar \(x\) bu anahtar dosyasınınki DEĞİL/);
  await sertRed("§2q sertifika-ekle: sertifika başka kid'in (ist-2099-9)", (konu) => sert({ ...konu, kid: "ist-2099-9" }), /bu anahtarın değil|sertifika başka anahtarın/);
  await sertRed("§2r sertifika-ekle: sertifikayı çapada olmayan kök imzalamış", (konu) => sert(konu, {}, anahtarUret("kok-yabanci-1")), /köke karşı doğrulanamadı \(KOK_BILINMIYOR\)/);
  await sertRed("§2s sertifika-ekle: kullanım ISTEMCI değil (PAKET; şemayı atlayan ham imza)", (konu) => hamImzala(TYP.SERTIFIKA, f.kok, sertifikaYuku(f, konu, "PAKET")), /köke karşı doğrulanamadı \(/);
  writeFileSync(yazilan, JSON.stringify({ sertifika: sert(a3.konu) }), { mode: 0o600 });
  const ezme = ekle(a3.dosya, iyi);
  check("§2t sertifika-ekle: yanında FARKLI sertifika dosyası varsa üstüne yazılmaz → RED", ezme.kod !== 0 && /üstüne yazılmaz/.test(ezme.cikti), ezme.cikti.trim().slice(-160));

  // 30 gün kapısı: bitişe 29 gün kalan sertifikayla imza YOK; 31 günde var (sınır kör değil).
  const a5 = await yeniAnahtar("ist-2099-5");
  const s29 = sertDosyasi(sert(a5.konu, { bitis: msToIso(simdi + 29 * DAY_MS) }));
  const s31 = sertDosyasi(sert(a5.konu, { bitis: msToIso(simdi + 31 * DAY_MS) }));
  const p29 = paketDizini();
  const once29 = readFileSync(p29.latest);
  const i29 = cli(["imzala", "--musteri=test", `--dizin-paket=${p29.dizin}`, `--anahtar=${a5.dosya}`, `--sertifika=${s29}`, `--capa=${capa}`], `${PAROLA}\n`);
  const p31 = paketDizini();
  const i31 = cli(["imzala", "--musteri=test", `--dizin-paket=${p31.dizin}`, `--anahtar=${a5.dosya}`, `--sertifika=${s31}`, `--capa=${capa}`], `${PAROLA}\n`);
  check("§2u ⭐ 30 gün kapısı (imzala): bitişe 29 gün kalan ISTEMCI sertifikası → RED, latest.yml DEĞİŞMEDİ; 31 gün → imzalar",
    i29.kod !== 0 && /< 30\) — bununla İMZALANMAZ/.test(i29.cikti) && readFileSync(p29.latest).equals(once29) && i31.kod === 0, `${i29.kod}/${i31.kod} ${i29.cikti.trim().slice(-160)}`);

  // Yeniden imza: ist-2099-1'in imzaladığı yayındaki künye → ist-2099-3 (yük aynen; kurulum dosyası gerekmez).
  const p = paketDizini();
  const ilk = cli(["imzala", "--musteri=test", `--dizin-paket=${p.dizin}`, `--anahtar=${anahtar.istDosyasi}`, `--sertifika=${sertDosyasi(sert({ kid: "ist-2099-1", x: anahtar.istX } as TestAnahtari))}`, `--capa=${capa}`], `${PAROLA}\n`);
  const yayinda = path.join(dizin("yayinda"), "latest.yml");
  copyFileSync(p.latest, yayinda);
  const cikti = (): string => path.join(dizin("yeniden"), "latest.yml");
  const yeniden = (latest: string, out: string, ek: readonly string[] = [], dosya = a3.dosya, kanal = "test"): Kosum =>
    cli(["yeniden-imzala", `--latest=${latest}`, `--musteri=${kanal}`, `--anahtar=${dosya}`, `--cikti=${out}`, `--capa=${capa}`, ...ek], `${PAROLA}\n`);
  const o1 = cikti();
  const y1 = yeniden(yayinda, o1);
  const yeniMetin = existsSync(o1) ? readFileSync(o1, "utf8") : "";
  const yi = parseLatestYml(yeniMetin);
  const yv = yi.ok ? verifyUpdateInfo(yi.value, { roots: kokler, channel: "test", installedVersion: "1.4.2", nowMs: Date.now() }) : null;
  const govde = (s: string) => s.split("\ntekserp:")[0];
  const yuk = (s: string): Record<string, unknown> => {
    const q = parseLatestYml(s);
    const t = q.ok ? (q.value.tekserp as { bildirim: string }).bildirim : "";
    const { imzaZamani: _a, imzaciSertifikasi: _b, ...geri } = JSON.parse(Buffer.from(t.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    return geri;
  };
  check("§2v ⭐ yeniden-imzala: panel KABUL eder, imzalayan yeni ist-2099-3, paket kaydı + künye yükü AYNEN, yayındaki dosyaya dokunulmaz",
    ilk.kod === 0 && y1.kod === 0 && yv?.ok === true && yv.value.kid === "ist-2099-3" && govde(yeniMetin) === govde(readFileSync(yayinda, "utf8")) && JSON.stringify(yuk(yeniMetin)) === JSON.stringify(yuk(readFileSync(p.latest, "utf8"))) && readFileSync(yayinda).equals(readFileSync(p.latest)),
    `${ilk.kod}/${y1.kod} ${y1.cikti.trim().slice(-160)}`);
  const yenidenRed = (ad: string, k: Kosum, out: string, desen: RegExp): void =>
    check(`${ad} → RED, çıktı YAZILMADI`, k.kod !== 0 && desen.test(k.cikti) && !existsSync(out), `çıkış ${k.kod} ${k.cikti.trim().slice(-160)}`);
  const o29 = cikti();
  yenidenRed("§2w ⭐ 30 gün kapısı (yeniden-imzala): 29 günlük sertifika", yeniden(yayinda, o29, [`--sertifika=${s29}`], a5.dosya), o29, /< 30\) — bununla İMZALANMAZ/);
  const kurcali = path.join(dizin("kurcali"), "latest.yml");
  writeFileSync(kurcali, readFileSync(yayinda, "utf8").replace(/size: (\d+)/, (_m, n: string) => `size: ${Number(n) + 1}`));
  const ok1 = cikti();
  yenidenRed("§2x yeniden-imzala: yayındaki latest.yml künyeyle uyuşmuyor (boy kurcalanmış)", yeniden(kurcali, ok1), ok1, /uyuşmuyor/);
  const ok2 = cikti();
  yenidenRed("§2x' yeniden-imzala: başka grubun künyesi (--musteri=oncu)", yeniden(yayinda, ok2, [], a3.dosya, "oncu"), ok2, /KUNYE_KANAL/);
  const bildirimOf = (metin: string): string => {
    const q = parseLatestYml(metin);
    return q.ok ? String((q.value.tekserp as { bildirim?: unknown } | null)?.bildirim ?? "") : "";
  };
  const ilkSert = parseJws(String((JSON.parse(Buffer.from(bildirimOf(readFileSync(yayinda, "utf8")).split(".")[1]!, "base64url").toString("utf8")) as { imzaciSertifikasi: string }).imzaciSertifikasi));
  const sertId = ilkSert.ok ? String((ilkSert.value.payload as { sertifikaId: string }).sertifikaId) : "";
  const iptalli = path.join(dizin("iptalli"), "latest.yml");
  const iptalJws = hamImzala(TYP.PAKET_IPTAL, f.kok, { v: 1, iptalId: randomUUID(), sira: 1, verilis: msToIso(simdi - DAY_MS), iptaller: [{ kid: "ist-2099-1", sertifikaId: sertId, tarih: msToIso(simdi - 2 * DAY_MS), neden: "çalındı" }] });
  const blok = bildirimOf(readFileSync(yayinda, "utf8"));
  writeFileSync(iptalli, withReleaseBlock(readFileSync(yayinda, "utf8"), blok, { iptal: iptalJws }));
  const ok3 = cikti();
  yenidenRed("§2y ⭐ yeniden-imzala: imzalayanı (ist-2099-1) iptal edilmiş künye — çalınan anahtarın künyesi yeniden imzalanmaz", yeniden(iptalli, ok3), ok3, /yayındaki künye geçerli değil \(SERTIFIKA_IPTAL\)/);
  const var_ = yeniden(yayinda, o1);
  check("§2y' yeniden-imzala: çıktı dosyası zaten var → RED, üstüne yazılmaz", var_.kod !== 0 && /zaten var/.test(var_.cikti) && readFileSync(o1, "utf8") === yeniMetin, var_.cikti.trim().slice(-120));

  // anahtar-ac: yedeğin açılabilirlik ölçümü — kid + x, özel yarı ve parola basılmaz.
  const ac = cli(["anahtar-ac", `--anahtar=${a3.dosya}`, "--json"], `${PAROLA}\n`);
  const acJ = ac.kod === 0 ? (JSON.parse(ac.cikti.trim().split("\n").pop() ?? "{}") as { kid?: string; x?: string; acildi?: boolean }) : {};
  const yanlis = cli(["anahtar-ac", `--anahtar=${a3.dosya}`, "--json"], "yanlis-parola-uzun-1\n");
  check("§2z anahtar-ac: doğru parolayla {kid, x, acildi} (x dosyanınki), çıktıda parola/özel yarı YOK; yanlış parola → RED",
    ac.kod === 0 && acJ.kid === "ist-2099-3" && acJ.x === a3.konu.x && acJ.acildi === true && !ac.cikti.includes(PAROLA) && !/"d"/.test(ac.cikti) && yanlis.kod !== 0 && /Parola hatalı/.test(yanlis.cikti),
    `${ac.kod}/${yanlis.kod} ${yanlis.cikti.trim().slice(-120)}`);
}

// ── §3 çapa aracı ─────────────────────────────────────────────────────────────
function kopyaKok(): string {
  const kok = dizin("depo-kopyasi");
  for (const y of [CAPA_DOSYALARI.kokTs, ...CAPA_DOSYALARI.kokAynalari, CAPA_DOSYALARI.paketTs, CAPA_DOSYALARI.anchorRs, PANEL_CAPA_DOSYASI]) {
    mkdirSync(path.dirname(path.join(kok, y)), { recursive: true });
    copyFileSync(path.join(DEPO_KOKU, y), path.join(kok, y));
  }
  return kok;
}

function sessiz<T>(fn: () => T): T {
  const log = console.log;
  const err = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}

/** K-14: ortak tablette APK künyesi yok — bu yolun koddaki parçaları geri gelirse kırmızı. */
const APK_KUNYE_DOSYALARI = ["mobil/src/lib/apk-imza-capasi.json", "mobil/scripts/lib/apk-kunye.mjs", "Teks-Erp/scripts/lib/apk-imza.ts"] as const;

function bolum3(anahtar: Anahtarlar): void {
  console.log("\n§3 çapa aracı (guven-capasi-ekle.ts) — panel KÖK çapası · `panel` ve `tablet` komutları kalktı (geçici kopyada)");
  const gercek = istemciKokCapasiOku(DEPO_KOKU);
  const uretim = checkPanelRootAnchor([...gercek.liste]);
  check("§3a gerçek ağacın panel çapası kök çapası (kesin JSON düzeni, {kid,x,classes}) ve üretim biçiminde", uretim.ok, gercek.liste.map((k) => k.kid).join(", ") || "BOŞ");
  const paket2026 = (readFileSync(path.join(DEPO_KOKU, CAPA_DOSYALARI.paketTs), "utf8").match(/kid: "(paket-\d{4})", x: "([^"]+)"/) ?? []) as string[];
  const kok = kopyaKok();
  const yaz = (argv: readonly string[]): number => sessiz(() => capaEkle([...argv, `--kok=${kok}`]));
  const panelOku = (): string => readFileSync(path.join(kok, PANEL_CAPA_DOSYASI), "utf8");
  const panelIlk = panelOku();
  check("§3a2 ⭐ eski `panel` komutu → çıkış 64 (kullanım), panel çapası aynı", yaz(["panel", `--paket-kid=${paket2026[1]}`, "--yaz"]) === 64 && panelOku() === panelIlk);
  const tabletKosumlari = [
    ["tablet", `--paket-kid=${paket2026[1]}`, "--yaz"],
    ["tablet", `--dosya=${anahtar.panelDosyasi}`, "--yaz"],
    ["tablet", "--kid=panel-2099", `--x=${anahtar.panelX}`, "--yaz"],
  ].map((argv) => yaz(argv));
  check("§3b ⭐ eski `tablet` komutu (her biçimi) → çıkış 64, panel çapası aynı, tablet çapası doğmaz",
    tabletKosumlari.every((r) => r === 64) && panelOku() === panelIlk && !existsSync(path.join(kok, APK_KUNYE_DOSYALARI[0])), tabletKosumlari.join(","));
  const kalan = APK_KUNYE_DOSYALARI.filter((y) => existsSync(path.join(DEPO_KOKU, y)));
  check("§3c ⭐ tablet APK künyesi kodu ağaçta YOK (çapa · künye kitaplığı · imza kitaplığı)", kalan.length === 0, kalan.join(", ") || "yok");
  const apkKomutlari = ["apk-imzala", "apk-dogrula"].map((k) => cli([k, "--musteri=adnansahin", "--apk=x.apk", "--kunye=surum.json", `--anahtar=${anahtar.panelDosyasi}`], `${PAROLA}\n`));
  check("§3d ⭐ panel-imza.ts apk-imzala / apk-dogrula → çıkış 2 (komut yok)", apkKomutlari.every((r) => r.kod === 2), apkKomutlari.map((r) => `${r.kod} ${r.cikti.trim().slice(-80)}`).join(" | "));
}

async function main(): Promise<void> {
  try {
    bolum0();
    bolum0Zincir();
    const anahtar = await bolum1();
    bolum2(anahtar);
    await bolum2Toren(anahtar);
    bolum3(anahtar);
  } finally {
    rmSync(TEMP, { recursive: true, force: true });
    if (existsSync(path.join(DEPO_KOKU, "tmp-panel-anahtari"))) rmSync(path.join(DEPO_KOKU, "tmp-panel-anahtari"), { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail ? 1 : 0);
}

void main();
