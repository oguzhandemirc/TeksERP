import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// Panelin GERÇEK ayrıştırıcısı: electron-updater latest.yml'i bu fonksiyonla (js-yaml) okur — kapının gördüğü ile
// panelin gördüğü aynı mı sorusu bununla ölçülür.
import { parseUpdateInfo } from "electron-updater/out/providers/Provider";
import {
  PRODUCTION_SIGNER_KID,
  b64uEncode,
  checkProductionAnchor,
  signJwsCompact,
} from "../../electron/guncelleme/kunye-jws.mjs";
import {
  PANEL_RELEASE_TYP,
  RELEASE_ERROR_CODES,
  buildReleaseDoc,
  compareVersions,
  messageFor,
  signReleaseDoc,
  verifyArtifactFile,
  verifyUpdateInfo,
  type ReleaseDoc,
} from "../../electron/guncelleme/panel-kunye.mjs";
import { parseLatestYml, withReleaseBlock } from "../../electron/guncelleme/latest-yml.mjs";

/**
 * PANEL SÜRÜM KÜNYESİ — doğrulayıcının red tablosu. Her satır bir saldırı ya da yayın hatası biçimidir ve
 * HER BİRİ kurulumu durdurmalıdır (fail-closed). Kabul tek yoldur: çapadaki anahtarla imzalı, bu kanalın,
 * kurulu sürümden yeni, latest.yml'deki dosyayla birebir künye.
 */
function anahtar(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, x: publicKey.export({ format: "jwk" }).x as string };
}
const A = anahtar("panel-fikstur");
const YABANCI = anahtar("panel-yabanci");
const CAPA = [{ kid: A.kid, x: A.x }];
const KANAL = "adnansahin";
const SURUM = "2.0.0";
const GOVDE = Buffer.from("TeksERP sahte kurulum gövdesi — ".repeat(64));
const SHA = createHash("sha512").update(GOVDE).digest();
const AD = `TeksERP-${SURUM}-Setup.exe`;

function kunye(ek: Partial<Parameters<typeof buildReleaseDoc>[0]> = {}): ReleaseDoc {
  return buildReleaseDoc({
    kanal: KANAL,
    surum: SURUM,
    commit: "0efe882d",
    yayinZamani: "2026-10-01T01:00:00.000Z",
    paket: { ad: AD, boyut: GOVDE.length, sha512: SHA.toString("hex") },
    capa: [A.kid],
    ...ek,
  });
}

function ymlMetni(surum = SURUM, dosya = AD) {
  const b64 = SHA.toString("base64");
  return `version: ${surum}\nfiles:\n  - url: ${dosya}\n    sha512: ${b64}\n    size: ${GOVDE.length}\n    isAdminRightsRequired: true\npath: ${dosya}\nsha512: ${b64}\nreleaseDate: '2026-10-01T01:00:00.000Z'\n`;
}

function imzaliYml(token: string, metin = ymlMetni()) {
  return withReleaseBlock(metin, token);
}

/** Panelin gördüğü biçim: electron-updater'ın kendi ayrıştırıcısı. */
function panelGorur(metin: string) {
  return parseUpdateInfo(metin, "latest.yml", new URL("https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml")) as unknown;
}

const dogrula = (info: unknown, kurulu = "1.4.2", keys: unknown = CAPA, kanal = KANAL) =>
  verifyUpdateInfo(info, { keys, channel: kanal, installedVersion: kurulu });

const imzali = (doc: ReleaseDoc = kunye(), k: { kid: string; privateKey: KeyObject } = A) =>
  signReleaseDoc({ doc, kid: k.kid, privateKey: k.privateKey });

describe("panel künyesi — kabul", () => {
  it("çapadaki anahtarla imzalı, bu kanalın, yeni sürüm, latest.yml ile birebir → KABUL", () => {
    const r = dogrula(panelGorur(imzaliYml(imzali())));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kid).toBe(A.kid);
      expect(r.value.doc).toMatchObject({ kanal: KANAL, surum: SURUM, paket: { ad: AD, boyut: GOVDE.length } });
    }
  });

  it("kapının ayrıştırıcısı ile panelin js-yaml'ı imzalı latest.yml'de AYNI bağlı alanları görür", () => {
    const metin = imzaliYml(imzali());
    const kapi = parseLatestYml(metin);
    expect(kapi.ok).toBe(true);
    const panel = panelGorur(metin) as Record<string, unknown>;
    if (kapi.ok) {
      for (const k of ["version", "files", "path", "sha512", "tekserp"] as const) expect(kapi.value[k], k).toEqual(panel[k]);
    }
    expect(dogrula(kapi.ok ? kapi.value : null).ok).toBe(true);
  });
});

describe("panel künyesi — RED tablosu (her biri kurulumu durdurur)", () => {
  const gecerli = imzaliYml(imzali());
  const sahte = (mutasyon: (o: Record<string, unknown>) => void) => {
    const o = structuredClone(panelGorur(gecerli)) as Record<string, unknown>;
    mutasyon(o);
    return o;
  };
  const blok = (bildirim: string) => sahte((o) => (o.tekserp = { v: 1, bildirim }));
  const parcalar = (imzali().split(".") as [string, string, string]);

  const tablo: Array<[string, unknown, string, unknown?]> = [
    ["imzasız latest.yml (bugünkü yayın biçimi)", panelGorur(ymlMetni()), "KUNYE_YOK"],
    ["blok imzasız alan taşıyor", sahte((o) => ((o.tekserp as Record<string, unknown>).not = "x")), "KUNYE_BICIM"],
    ["blok sürümü bilinmiyor", sahte((o) => ((o.tekserp as Record<string, unknown>).v = 2)), "BELGE_SURUM"],
    ["yük değiştirilmiş, imza eski (bozuk imza)", blok(`${parcalar[0]}.${b64uEncode(JSON.stringify({ ...kunye(), surum: "9.9.9" }))}.${parcalar[2]}`), "JWS_IMZA"],
    ["imza baytı bozulmuş", blok(`${parcalar[0]}.${parcalar[1]}.${b64uEncode(Buffer.alloc(64, 7))}`), "JWS_IMZA"],
    ["yanlış typ (backend bildirimi tekserp-surum)", blok(signJwsCompact({ typ: "tekserp-surum", kid: A.kid, payload: { ...kunye() }, privateKey: A.privateKey })), "JWS_TYP"],
    ["bilinmeyen kid (çapada olmayan anahtar)", blok(imzali(kunye(), YABANCI)), "JWS_KID"],
    ["alg none", blok(`${b64uEncode(JSON.stringify({ alg: "none", typ: PANEL_RELEASE_TYP, kid: A.kid }))}.${parcalar[1]}.${parcalar[2]}`), "JWS_ALG"],
    ["başlıkta gömülü anahtar (jwk)", blok(`${b64uEncode(JSON.stringify({ alg: "EdDSA", typ: PANEL_RELEASE_TYP, kid: A.kid, jwk: { x: YABANCI.x } }))}.${parcalar[1]}.${parcalar[2]}`), "JWS_BASLIK"],
    ["kanal başka müşterinin", panelGorur(imzaliYml(imzali(kunye({ kanal: "testfabrika" })))), "KUNYE_KANAL"],
    ["latest.yml sürümü künyeden farklı", panelGorur(imzaliYml(imzali(), ymlMetni("2.0.1", AD))), "KUNYE_SURUM"],
    ["latest.yml başka dosyayı gösteriyor", sahte((o) => ((o.files as Array<Record<string, unknown>>)[0]!.url = "kotu.exe")), "KUNYE_DOSYA"],
    ["latest.yml sha512 değiştirilmiş", sahte((o) => ((o.files as Array<Record<string, unknown>>)[0]!.sha512 = Buffer.alloc(64, 1).toString("base64"))), "KUNYE_DOSYA"],
    ["latest.yml boyu değiştirilmiş", sahte((o) => ((o.files as Array<Record<string, unknown>>)[0]!.size = GOVDE.length + 1)), "KUNYE_DOSYA"],
    ["latest.yml ikinci dosya eklenmiş", sahte((o) => (o.files as unknown[]).push({ url: "ek.exe", sha512: "x", size: 1 })), "KUNYE_DOSYA"],
    ["latest.yml path alanı başka dosya", sahte((o) => (o.path = "kotu.exe")), "KUNYE_DOSYA"],
    ["eski imzalı sürümün yeniden oynatılması (kurulu = künye)", panelGorur(gecerli), "KUNYE_ESKI", "2.0.0"],
    ["eski imzalı sürüm (kurulu daha yeni)", panelGorur(gecerli), "KUNYE_ESKI", "2.1.0"],
  ];

  for (const [ad, info, kod, kurulu] of tablo) {
    it(`${ad} → ${kod}`, () => {
      const r = dogrula(info, (kurulu as string | undefined) ?? "1.4.2");
      expect(r.ok, ad).toBe(false);
      if (!r.ok) expect(r.code).toBe(kod);
    });
  }

  it("çapa BOŞ → CAPA_BOS (çapasız panel hiçbir şey kurmaz)", () => {
    const r = dogrula(panelGorur(gecerli), "1.4.2", []);
    expect(r.ok ? null : r.code).toBe("CAPA_BOS");
  });

  it("çapada hazırlık PAKET anahtarı ya da tekrar → CAPA_GECERSIZ", () => {
    for (const keys of [[{ kid: "paket-hazirlik", x: A.x }], [...CAPA, { kid: "panel-baska", x: A.x }], [{ kid: "kok-2026-1", x: A.x }]]) {
      const r = dogrula(panelGorur(gecerli), "1.4.2", keys);
      expect(r.ok ? null : r.code, JSON.stringify(keys)).toBe("CAPA_GECERSIZ");
    }
  });

  it("künye şeması: çapa listesi yok / sha512 biçimsiz → imzalanamaz (BELGE_SEMA)", () => {
    expect(() => kunye({ capa: [] })).toThrow(/capa/);
    expect(() => kunye({ paket: { ad: AD, boyut: GOVDE.length, sha512: "abc" } })).toThrow(/paket\.sha512/);
    expect(() => kunye({ paket: { ad: "../kotu.exe", boyut: 1, sha512: SHA.toString("hex") } })).toThrow(/paket\.ad/);
  });

  it("imzalayıcı hazırlık anahtarını ve Ed25519 olmayan anahtarı REDDEDER", () => {
    expect(() => signReleaseDoc({ doc: kunye(), kid: "paket-hazirlik", privateKey: A.privateKey })).toThrow();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey;
    expect(() => signReleaseDoc({ doc: kunye(), kid: A.kid, privateKey: rsa })).toThrow(/Ed25519/);
  });

  it("her red kodunun Türkçe operatör metni var", () => {
    for (const kod of RELEASE_ERROR_CODES) expect(messageFor(kod), kod).toMatch(/kurulmadı/);
  });
});

describe("indirilen dosya — künyeyle ölçülür", () => {
  const dizin = mkdtempSync(join(tmpdir(), "panel-kunye-"));
  afterAll(() => rmSync(dizin, { recursive: true, force: true }));

  it("aynı bayt → kabul; tek bayt farkı → DOSYA_OZETI; dosya yok → DOSYA_OKUNAMADI", async () => {
    const dosya = join(dizin, AD);
    writeFileSync(dosya, GOVDE);
    expect((await verifyArtifactFile(kunye(), dosya)).ok).toBe(true);
    const bozuk = Buffer.from(GOVDE);
    bozuk[10] = bozuk[10]! ^ 1;
    writeFileSync(dosya, bozuk);
    const r = await verifyArtifactFile(kunye(), dosya);
    expect(r.ok ? null : r.code).toBe("DOSYA_OZETI");
    const yok = await verifyArtifactFile(kunye(), join(dizin, "yok.exe"));
    expect(yok.ok ? null : yok.code).toBe("DOSYA_OKUNAMADI");
  });
});

describe("üretim çapası ve sürüm karşılaştırma", () => {
  it("üretim çapası yalnız paket-<yıl>[-<n>] / panel-<yıl>[-<n>] kid'i kabul eder", () => {
    expect(PRODUCTION_SIGNER_KID.test("paket-2026")).toBe(true);
    expect(PRODUCTION_SIGNER_KID.test("panel-2026-2")).toBe(true);
    expect(PRODUCTION_SIGNER_KID.test("panel-fikstur")).toBe(false);
    expect(checkProductionAnchor([{ kid: "panel-2026", x: A.x }]).ok).toBe(true);
    const r = checkProductionAnchor(CAPA);
    expect(r.ok ? null : r.code).toBe("CAPA_GECERSIZ");
  });

  it("semver önceliği; biçimsiz sürüm null (fail-closed)", () => {
    expect(compareVersions("1.4.3", "1.4.2")).toBe(1);
    expect(compareVersions("1.4.2", "1.4.2")).toBe(0);
    expect(compareVersions("1.4.2-rc.1", "1.4.2")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.4", "1.4.2")).toBeNull();
  });
});

describe("latest.yml dar ayrıştırıcısı — panelin js-yaml'ından FARKLI okuyacağı dosyayı reddeder", () => {
  it("tırnaklı boy dizgidir (js-yaml gibi) — sayı sanılıp kapıdan geçmez", () => {
    const metin = imzaliYml(imzali(), ymlMetni().replace(`size: ${GOVDE.length}`, `size: '${GOVDE.length}'`));
    const kapi = parseLatestYml(metin);
    expect(kapi.ok && kapi.value.files[0]!.size).toBe(String(GOVDE.length));
    expect((panelGorur(metin) as { files: Array<{ size: unknown }> }).files[0]!.size).toBe(String(GOVDE.length));
    expect(dogrula(kapi.ok ? kapi.value : null).ok).toBe(false);
  });

  it("yorum · sekme · bilinmeyen blok · tekrar eden anahtar · CR → LATEST_YML_BICIM", () => {
    for (const bozuk of [
      `${ymlMetni()}# yorum\n`,
      ymlMetni().replace("version:", "version:\t"),
      `${ymlMetni()}releaseNotes:\n  - x\n`,
      `${ymlMetni()}version: 9.9.9\n`,
      ymlMetni().replace(/\n/g, "\r\n"),
    ]) {
      const r = parseLatestYml(bozuk);
      expect(r.ok ? null : r.code, JSON.stringify(bozuk.slice(-30))).toBe("LATEST_YML_BICIM");
    }
  });

  it("künye bloğu yazımı: yoksa eklenir, varsa DEĞİŞTİRİLİR (tek blok), geri kalan bayt bayt aynı", () => {
    const ilk = withReleaseBlock(ymlMetni(), imzali());
    const ikinci = withReleaseBlock(ilk, imzali(kunye({ yayinZamani: "2026-10-01T02:00:00.000Z" })));
    expect(ikinci.match(/^tekserp:$/gm)).toHaveLength(1);
    expect(ikinci.startsWith(ymlMetni())).toBe(true);
  });
});
