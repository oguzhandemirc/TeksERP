import { createHash, generateKeyPairSync } from "node:crypto";
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
  RELEASE_DOC_VERSION,
  RELEASE_ERROR_CODES,
  buildReleaseDoc,
  checkPanelRootAnchor,
  compareVersions,
  mergeReleaseRevocations,
  messageFor,
  signReleaseDoc,
  verifyArtifactFile,
  verifyUpdateInfo,
  type ReleaseDoc,
  type VerifiedDistributionRevocation,
} from "../../electron/guncelleme/panel-kunye.mjs";
import { parseLatestYml, withReleaseBlock } from "../../electron/guncelleme/latest-yml.mjs";
import { anahtarUret, hamJws, iso, zincirKur } from "./helpers/istemci-zinciri-fikstur";

/**
 * PANEL SÜRÜM KÜNYESİ (v:2) — doğrulayıcının red tablosu. Her satır bir saldırı ya da yayın hatası biçimidir ve
 * HER BİRİ kurulumu durdurmalıdır (fail-closed). Kabul tek yoldur: çapadaki KÖKÜN imzaladığı ISTEMCI sertifikalı
 * `ist-*` anahtarıyla imzalı, iptal edilmemiş, bu kanalın, kurulu sürümden yeni, latest.yml'deki dosyayla birebir künye.
 */
const Z = zincirKur();
const A = Z.ist;
const CAPA = Z.roots;
const YABANCI_KOK = anahtarUret("kok-yabanci-1");
const KANAL = "adnansahin";
const SURUM = "2.0.0";
const GOVDE = Buffer.from("TeksERP sahte kurulum gövdesi — ".repeat(64));
const SHA = createHash("sha512").update(GOVDE).digest();
const AD = `TeksERP-${SURUM}-Setup.exe`;
const DAY_MS = 24 * 60 * 60 * 1000;

function kunye(ek: Partial<Parameters<typeof buildReleaseDoc>[0]> = {}): ReleaseDoc {
  return buildReleaseDoc({
    kanal: KANAL,
    surum: SURUM,
    commit: "0efe882d",
    yayinZamani: "2026-10-01T01:00:00.000Z",
    paket: { ad: AD, boyut: GOVDE.length, sha512: SHA.toString("hex") },
    capa: [Z.kok.kid],
    ...ek,
  });
}

function ymlMetni(surum = SURUM, dosya = AD) {
  const b64 = SHA.toString("base64");
  return `version: ${surum}\nfiles:\n  - url: ${dosya}\n    sha512: ${b64}\n    size: ${GOVDE.length}\n    isAdminRightsRequired: true\npath: ${dosya}\nsha512: ${b64}\nreleaseDate: '2026-10-01T01:00:00.000Z'\n`;
}

function imzaliYml(token: string, metin = ymlMetni(), iptal?: string) {
  return withReleaseBlock(metin, token, { iptal: iptal ?? null });
}

/** Panelin gördüğü biçim: electron-updater'ın kendi ayrıştırıcısı. */
function panelGorur(metin: string) {
  return parseUpdateInfo(metin, "latest.yml", new URL("https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml")) as unknown;
}

/** Panelin akışı: iptal birleştirme (yerel → belirteç → künye bloğu) → doğrulama. */
const dogrula = (
  info: unknown,
  kurulu = "1.4.2",
  roots: unknown = CAPA,
  g: { kanal?: string; nowMs?: number; yerel?: string | null; belirtec?: string | null } = {},
) => {
  const blok = typeof info === "object" && info !== null ? (info as Record<string, unknown>).tekserp : undefined;
  const m = mergeReleaseRevocations(blok, { roots, stored: g.yerel ?? null, fromToken: g.belirtec ?? null });
  return verifyUpdateInfo(info, { roots, channel: g.kanal ?? KANAL, installedVersion: kurulu, nowMs: g.nowMs ?? Z.simdi, revocation: m.revocation });
};

const imzali = (doc: ReleaseDoc = kunye()) => Z.imzala(doc);

describe("panel künyesi v:2 — kabul", () => {
  it("kök çapasının sertifikaladığı ist- anahtarıyla imzalı, bu kanalın, yeni sürüm, latest.yml ile birebir → KABUL", () => {
    const r = dogrula(panelGorur(imzaliYml(imzali())));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kid).toBe(A.kid);
      expect(r.value.rootKid).toBe(Z.kok.kid);
      expect(r.value.doc).toMatchObject({ v: 2, kanal: KANAL, surum: SURUM, capa: [Z.kok.kid], paket: { ad: AD, boyut: GOVDE.length } });
    }
  });

  it("kapının ayrıştırıcısı ile panelin js-yaml'ı imzalı latest.yml'de (iptalli blok dahil) AYNI bağlı alanları görür", () => {
    const metin = imzaliYml(imzali(), ymlMetni(), Z.iptalBas([{ kid: "ist-baska-1", sertifikaId: "00000000-0000-0000-0000-000000000000" }], 1));
    const kapi = parseLatestYml(metin);
    expect(kapi.ok).toBe(true);
    const panel = panelGorur(metin) as Record<string, unknown>;
    if (kapi.ok) {
      for (const k of ["version", "files", "path", "sha512", "tekserp"] as const) expect(kapi.value[k], k).toEqual(panel[k]);
      expect(Object.keys(kapi.value.tekserp ?? {})).toEqual(["v", "bildirim", "iptal"]);
    }
    expect(dogrula(kapi.ok ? kapi.value : null).ok).toBe(true);
  });

  it("sertifika bitişinden sonra 180 gün içinde KABUL, sonrası SERTIFIKA_SURESI", () => {
    const info = panelGorur(imzaliYml(imzali()));
    const bitis = Z.simdi + 365 * DAY_MS;
    expect(dogrula(info, "1.4.2", CAPA, { nowMs: bitis + 179 * DAY_MS }).ok).toBe(true);
    const r = dogrula(info, "1.4.2", CAPA, { nowMs: bitis + 181 * DAY_MS });
    expect(r.ok ? null : r.code).toBe("SERTIFIKA_SURESI");
  });
});

describe("panel künyesi v:2 — RED tablosu (her biri kurulumu durdurur)", () => {
  const gecerli = imzaliYml(imzali());
  const sahte = (mutasyon: (o: Record<string, unknown>) => void) => {
    const o = structuredClone(panelGorur(gecerli)) as Record<string, unknown>;
    mutasyon(o);
    return o;
  };
  const blok = (bildirim: string) => sahte((o) => (o.tekserp = { v: 2, bildirim }));
  const parcalar = imzali().split(".") as [string, string, string];
  const v1Anahtar = anahtarUret("panel-fikstur");
  const v1Kunye = signJwsCompact({ typ: PANEL_RELEASE_TYP, kid: v1Anahtar.kid, payload: { ...kunye(), v: 1 }, privateKey: v1Anahtar.privateKey });
  const yabanciSertifika = Z.sertifikaBas(A, {}, YABANCI_KOK).token;
  const eskiSertifika = Z.sertifikaBas(A, { baslangic: iso(Z.simdi - 900 * DAY_MS), bitis: iso(Z.simdi - 400 * DAY_MS) }).token;
  const imzaAniDisi = Z.imzala(kunye(), { imzaAni: iso(Z.simdi - 60 * DAY_MS) });
  const paketSertifika = Z.sertifikaBas(anahtarUret("pkt-fikstur-1"), { kullanim: "PAKET", kid: "pkt-fikstur-1" }).token;
  const IKINCI = anahtarUret("ist-fikstur-2");
  const ikinciSertifika = Z.sertifikaBas(IKINCI).token;
  const iptalKid = Z.iptalBas([{ kid: A.kid, sertifikaId: "00000000-0000-0000-0000-000000000000" }], 3);

  const tablo: Array<[string, unknown, string, string?]> = [
    ["imzasız latest.yml (eski yayın biçimi)", panelGorur(ymlMetni()), "KUNYE_YOK"],
    ["blok imzasız alan taşıyor", sahte((o) => ((o.tekserp as Record<string, unknown>).not = "x")), "KUNYE_BICIM"],
    ["blok iptali metin değil", sahte((o) => ((o.tekserp as Record<string, unknown>).iptal = 7)), "KUNYE_BICIM"],
    ["⭐ v:1 blok (gömülü panel-* anahtarlı eski künye)", sahte((o) => (o.tekserp = { v: 1, bildirim: v1Kunye })), "BELGE_SURUM"],
    ["blok sürümü bilinmiyor (v:3)", sahte((o) => ((o.tekserp as Record<string, unknown>).v = 3)), "BELGE_SURUM"],
    ["⭐ v:2 blokta panel-* kid'li künye", blok(v1Kunye), "JWS_KID"],
    ["⭐ v:2 blok, zincir geçerli ama yük v:1", blok(hamJws(PANEL_RELEASE_TYP, A, { ...kunye(), v: 1, imzaciSertifikasi: Z.sertifika, imzaZamani: iso(Z.simdi - DAY_MS) })), "BELGE_SURUM"],
    ["yük değiştirilmiş, imza eski (bozuk imza)", blok(`${parcalar[0]}.${b64uEncode(JSON.stringify({ ...JSON.parse(Buffer.from(parcalar[1], "base64url").toString()), surum: "9.9.9" }))}.${parcalar[2]}`), "JWS_IMZA"],
    ["imza baytı bozulmuş", blok(`${parcalar[0]}.${parcalar[1]}.${b64uEncode(Buffer.alloc(64, 7))}`), "JWS_IMZA"],
    ["yanlış typ (tekserp-surum)", blok(hamJws("tekserp-surum", A, { ...kunye(), imzaciSertifikasi: Z.sertifika, imzaZamani: iso(Z.simdi) })), "JWS_TYP"],
    ["alg none", blok(`${b64uEncode(JSON.stringify({ alg: "none", typ: PANEL_RELEASE_TYP, kid: A.kid }))}.${parcalar[1]}.${parcalar[2]}`), "JWS_ALG"],
    ["başlıkta gömülü anahtar (jwk)", blok(`${b64uEncode(JSON.stringify({ alg: "EdDSA", typ: PANEL_RELEASE_TYP, kid: A.kid, jwk: { x: A.x } }))}.${parcalar[1]}.${parcalar[2]}`), "JWS_BASLIK"],
    ["⭐ sertifikasız ist- künye", blok(hamJws(PANEL_RELEASE_TYP, A, { ...kunye() })), "SERTIFIKA_GECERSIZ", "SERTIFIKA_YOK"],
    ["sertifikayı çapada olmayan kök imzalamış", blok(Z.imzala(kunye(), { sertifika: yabanciSertifika })), "SERTIFIKA_GECERSIZ", "KOK_BILINMIYOR"],
    ["PAKET sertifikası (kullanım ISTEMCI değil)", blok(hamJws(PANEL_RELEASE_TYP, A, { ...kunye(), imzaciSertifikasi: paketSertifika, imzaZamani: iso(Z.simdi - DAY_MS) })), "SERTIFIKA_GECERSIZ"],
    ["başka ist- anahtarının sertifikası", blok(hamJws(PANEL_RELEASE_TYP, A, { ...kunye(), imzaciSertifikasi: ikinciSertifika, imzaZamani: iso(Z.simdi - DAY_MS) })), "JWS_KID"],
    ["⭐ süresi 180 günden fazla geçmiş sertifika", blok(Z.imzala(kunye(), { sertifika: eskiSertifika, imzaAni: iso(Z.simdi - 500 * DAY_MS) })), "SERTIFIKA_SURESI", "TOLERANS"],
    ["imza anı sertifika penceresi dışında", blok(imzaAniDisi), "SERTIFIKA_SURESI", "SERTIFIKA_ZAMAN"],
    ["⭐ künye bloğundaki iptal imzalayanı iptal ediyor", panelGorur(imzaliYml(imzali(), ymlMetni(), iptalKid)), "SERTIFIKA_IPTAL"],
    ["kanal başka müşterinin", panelGorur(imzaliYml(imzali(kunye({ kanal: "testfabrika" })))), "KUNYE_KANAL"],
    ["latest.yml sürümü künyeden farklı", panelGorur(imzaliYml(imzali(), ymlMetni("2.0.1", AD))), "KUNYE_SURUM"],
    ["latest.yml başka dosyayı gösteriyor", sahte((o) => ((o.files as Array<Record<string, unknown>>)[0]!.url = "kotu.exe")), "KUNYE_DOSYA"],
    ["latest.yml sha512 değiştirilmiş", sahte((o) => ((o.files as Array<Record<string, unknown>>)[0]!.sha512 = Buffer.alloc(64, 1).toString("base64"))), "KUNYE_DOSYA"],
    ["latest.yml boyu değiştirilmiş", sahte((o) => ((o.files as Array<Record<string, unknown>>)[0]!.size = GOVDE.length + 1)), "KUNYE_DOSYA"],
    ["latest.yml ikinci dosya eklenmiş", sahte((o) => (o.files as unknown[]).push({ url: "ek.exe", sha512: "x", size: 1 })), "KUNYE_DOSYA"],
    ["latest.yml path alanı başka dosya", sahte((o) => (o.path = "kotu.exe")), "KUNYE_DOSYA"],
    ["eski imzalı sürümün yeniden oynatılması (kurulu = künye)", panelGorur(gecerli), "KUNYE_ESKI", "@2.0.0"],
    ["eski imzalı sürüm (kurulu daha yeni)", panelGorur(gecerli), "KUNYE_ESKI", "@2.1.0"],
  ];

  for (const [ad, info, kod, ek] of tablo) {
    it(`${ad} → ${kod}`, () => {
      const kurulu = ek?.startsWith("@") ? ek.slice(1) : "1.4.2";
      const r = dogrula(info, kurulu);
      expect(r.ok, ad).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(kod);
        if (ek && !ek.startsWith("@")) expect(r.detay).toBe(ek);
      }
    });
  }

  it("çapa BOŞ → CAPA_BOS (çapasız panel hiçbir şey kurmaz)", () => {
    const r = dogrula(panelGorur(gecerli), "1.4.2", []);
    expect(r.ok ? null : r.code).toBe("CAPA_BOS");
  });

  it("çapada eski imzacı satırı ({kid, x}) · kök dışı kid · tekrar · sınıfsız → CAPA_GECERSIZ", () => {
    for (const roots of [
      [{ kid: "panel-2026", x: A.x }],
      [{ kid: "panel-2026", x: A.x, classes: ["URETIM"] }],
      [...CAPA, { ...CAPA[0]! }],
      [{ kid: Z.kok.kid, x: Z.kok.x, classes: [] }],
    ]) {
      const r = dogrula(panelGorur(gecerli), "1.4.2", roots);
      expect(r.ok ? null : r.code, JSON.stringify(roots)).toBe("CAPA_GECERSIZ");
    }
  });
});

describe("panel künyesi v:2 — şema ve imzalayıcı", () => {
  it("künye şeması: çapa listesi yok / kök olmayan çapa kid'i / sha512 biçimsiz → imzalanamaz (BELGE_SEMA)", () => {
    expect(RELEASE_DOC_VERSION).toBe(2);
    expect(() => kunye({ capa: [] })).toThrow(/capa/);
    expect(() => kunye({ capa: ["panel-2026"] })).toThrow(/capa/);
    expect(() => kunye({ paket: { ad: AD, boyut: GOVDE.length, sha512: "abc" } })).toThrow(/paket\.sha512/);
    expect(() => kunye({ paket: { ad: "../kotu.exe", boyut: 1, sha512: SHA.toString("hex") } })).toThrow(/paket\.ad/);
  });

  it("imzalayıcı ist- olmayan anahtarı, başka anahtarın sertifikasını ve Ed25519 olmayan anahtarı REDDEDER", () => {
    const ikinciSertifika = Z.sertifikaBas(anahtarUret("ist-fikstur-2")).token;
    const imza = (kid: string, privateKey = A.privateKey, certificate = Z.sertifika) =>
      signReleaseDoc({ doc: kunye(), kid, privateKey, certificate, signedAt: iso(Z.simdi) });
    expect(() => imza("panel-2026")).toThrow();
    expect(() => imza(A.kid, A.privateKey, ikinciSertifika)).toThrow(/sertifika/);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey;
    expect(() => imza(A.kid, rsa)).toThrow(/Ed25519/);
  });

  it("her red kodunun Türkçe operatör metni var (SERTIFIKA_* dahil)", () => {
    for (const kod of ["SERTIFIKA_GECERSIZ", "SERTIFIKA_SURESI", "SERTIFIKA_IPTAL"]) expect(RELEASE_ERROR_CODES).toContain(kod);
    for (const kod of RELEASE_ERROR_CODES) expect(messageFor(kod), kod).toMatch(/kurulmadı/);
  });
});

describe("dağıtım iptali birleştirme — yerel → belirteç → künye bloğu", () => {
  const info = panelGorur(imzaliYml(imzali()));
  const iptal = (sira: number, kid = A.kid) => Z.iptalBas([{ kid, sertifikaId: "00000000-0000-0000-0000-000000000000" }], sira);
  const sahteIptal = hamJws("tekserp-paketiptal", YABANCI_KOK, { v: 1 });

  it("⭐ belirteç yanıtındaki iptal imzalayanı iptal ediyorsa → SERTIFIKA_IPTAL", () => {
    const r = dogrula(info, "1.4.2", CAPA, { belirtec: iptal(2) });
    expect(r.ok ? null : r.code).toBe("SERTIFIKA_IPTAL");
  });

  it("yerelde saklanan iptal (yanıt iptalsiz olsa da) → SERTIFIKA_IPTAL", () => {
    const r = dogrula(info, "1.4.2", CAPA, { yerel: iptal(2) });
    expect(r.ok ? null : r.code).toBe("SERTIFIKA_IPTAL");
  });

  it("en yüksek sira kazanır; EŞİT sırada yerel kalır (çırpınmaz); sahte aday yok sayılır", () => {
    const yerel = iptal(5, "ist-baska-1");
    const esit = mergeReleaseRevocations({ v: 2, bildirim: "x", iptal: iptal(5) }, { roots: CAPA, stored: yerel, fromToken: null });
    expect(esit.kaynak).toBe("yerel");
    const yuksek = mergeReleaseRevocations({ v: 2, bildirim: "x", iptal: iptal(6) }, { roots: CAPA, stored: yerel, fromToken: iptal(4) });
    expect(yuksek.kaynak).toBe("kunye");
    expect((yuksek.revocation as VerifiedDistributionRevocation).document.sira).toBe(6);
    const sahte = mergeReleaseRevocations(undefined, { roots: CAPA, stored: "bozuk.yerel.dosya", fromToken: sahteIptal });
    expect(sahte.revocation).toBeNull();
    expect(sahte.reddedilen.map((x) => x.kaynak)).toEqual(["yerel", "belirtec"]);
  });

  it("başka anahtarın iptali imzalayanı DURDURMAZ", () => {
    expect(dogrula(info, "1.4.2", CAPA, { belirtec: iptal(9, "ist-baska-1") }).ok).toBe(true);
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
  it("imzacı üretim çapası (tablet APK künyesi) yalnız paket-<yıl>[-<n>] / panel-<yıl>[-<n>] kid'i kabul eder", () => {
    expect(PRODUCTION_SIGNER_KID.test("paket-2026")).toBe(true);
    expect(PRODUCTION_SIGNER_KID.test("panel-2026-2")).toBe(true);
    expect(PRODUCTION_SIGNER_KID.test("panel-fikstur")).toBe(false);
    expect(checkProductionAnchor([{ kid: "panel-2026", x: A.x }]).ok).toBe(true);
    const r = checkProductionAnchor([{ kid: "panel-fikstur", x: A.x }]);
    expect(r.ok ? null : r.code).toBe("CAPA_GECERSIZ");
  });

  it("panel kök çapası (paketleme): yalnız kok-<yıl>-<n>; fikstür kökü ve boş çapa RED", () => {
    expect(checkPanelRootAnchor([{ kid: "kok-2026-1", x: Z.kok.x, classes: ["URETIM"] }]).ok).toBe(true);
    const f = checkPanelRootAnchor(CAPA);
    expect(f.ok ? null : f.code).toBe("CAPA_GECERSIZ");
    const bos = checkPanelRootAnchor([]);
    expect(bos.ok ? null : bos.code).toBe("CAPA_BOS");
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
