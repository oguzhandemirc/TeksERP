// =============================================================================
// G2 MUAFİYET BELGESİ (satıcı) — etkinleşmemiş eski fabrika kurulumuna etkinleştirme kilidinden muafiyet. Kendi _test DB'si.
//   §1 zarf: fabrikanın imzalı etkinleştirme/taşıma isteğinden kurulum anahtarı + parmak izi okunur; kurcalanmış gövde,
//      başka anahtarla imzalı istek, yoklama amaçlı ya da biçimsiz zarf 400 ZARF_BICIM/GOVDE_GECERSIZ; ESKİ zarf (saatler
//      önce imzalı) kabul (tazelik değil sahiplik)
//   §2 kök planı (ara yokken): belge kökle imzalı, sertifikasız; anahtar kimliği + parmak izi zarftakiyle aynı; çapaya
//      karşı doğrulanır; kayıt `kurulum_kaydi` MUAFIYET_VERILDI (anahtar + imzacı)
//   §3 kapılar: etkin kurulum · iptal kurulum · anahtarı başka kuruluma bağlı · zarfın lisans kimliği başka → 409;
//      plan uyuşmazlığı 409 (parola kullanılmaz); yanlış parola 400 IMZA_PAROLASI_HATALI; kapsamsız imza RED
//   §4 ara imzacı planı: ara varsa belge ara imzalı, KENDİ sertifikası gömülü, HAK sertifikası olarak doğrulanır
//   §5 imza alt süreci: kök, ara sertifikalı muafiyeti basmaz (YETKISIZ)
// ⭐ KALICI SONDA ✓K (her koşumda): §2a belge GERÇEKTEN imzalı ve doğrulanıyor (kör RED değil) · §1d eski zarf GERÇEKTEN kabul.
// NEGATİF SONDA (2026-10-12, dosya DIŞI, cp + shasum ile geri alındı): `assertExemptible` durum koşulu kaldırıldı → §3a · §3b ❌;
//   `verifyRequest` çağrısı kaldırıldı → §1b ❌ · §1c ❌.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_muafiyet_belgesi.ts   (kendi _test DB'si)
// =============================================================================
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ExemptionSchema, TYP, decodeDocument, installationKeyId, parseJws, signRequest, wrapEnvelope, type LicenseClass } from "../src/lisans-protokol";
import { kurulumAnahtariUret, sertifikaBas, sertifikaYuku, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { KeyStore } from "../src/keys/key-store";
import { runAsCli } from "../src/lib/request-scope";
import type { VendorContext } from "../src/services/context";
import { ORTAM, TEST_KOK_PAROLASI, anahtarOrtamiKur, eskiDerlemeEtkin, etkinlestirmeGovdesi, hedefDbKapisi, kapat, kontrol, kurulumFiksturu, sonuc, temizleKurulumlar } from "./lib/test-ortam";

process.env.TEKSERP_PAROLA_KASASI = "kapali";

const ARA_PAROLASI = "bekci-ara-parolasi-muafiyet";
const ARA_SINIFLARI: LicenseClass[] = ["URETIM", "DR", "DEMO", "TEST"];

function zarfUret(g: { anahtar: TestAnahtari; govde: Record<string, unknown>; amac?: "etkinlestir" | "tasima" | "yokla"; kurulumId?: string | null; zamanMs?: number; imzalayan?: TestAnahtari; govdeMetni?: string }): string {
  const metin = JSON.stringify(g.govde);
  const istek = signRequest({
    installationId: g.kurulumId ?? null,
    purpose: g.amac ?? "etkinlestir",
    body: metin,
    key: { privateKey: (g.imzalayan ?? g.anahtar).privateKey, nowMs: g.zamanMs ?? Date.now() },
  });
  return wrapEnvelope(istek, g.govdeMetni ?? metin);
}

async function hataKodu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "HATA_YOK";
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string };
    return `${e.status ?? "?"} ${e.code ?? e.message ?? String(err)}`;
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f } = ortam;
  let ctx: VendorContext = ortam.ctx;
  const { prisma } = await import("../src/lib/prisma");
  const svc = await import("../src/services/exemption.service");
  const { signWithWrappedKey } = await import("../src/keys/signer");
  const kurulumlar: string[] = [];
  const kidler: string[] = [...ortam.kidler, f.ara.kid];
  const muafiyet = (kurulumDbId: string, zarf: string, g: { imzaci?: "ARA" | "KOK"; parola?: string } = {}) =>
    runAsCli(() =>
      svc.prepareExemption(ctx, {
        installationDbId: kurulumDbId,
        zarf,
        reason: "eski kurulum — bugünkü gibi sürsün",
        expectedSigner: g.imzaci ?? "KOK",
        password: passwordBuffer(g.parola ?? TEST_KOK_PAROLASI),
        nowMs: Date.now(),
      }),
    );
  try {
    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    const govde = etkinlestirmeGovdesi({ kod: k.kod, kurulumId: null, anahtar, parmakIzi: f.parmakIzi });

    console.log("\n§1 zarf");
    const kimlik = svc.exemptionIdentityFromEnvelope(zarfUret({ anahtar, govde }));
    kontrol("§1a etkinleştirme zarfından anahtar kimliği + parmak izi", kimlik.anahtarKimligi === installationKeyId(anahtar.x) && JSON.stringify(kimlik.parmakIzi) === JSON.stringify(f.parmakIzi) && kimlik.kurulumId === null);
    const kurcali = await hataKodu(async () => svc.exemptionIdentityFromEnvelope(zarfUret({ anahtar, govde, govdeMetni: JSON.stringify({ ...govde, parmakIzi: { ...f.parmakIzi, f1: null } }) })));
    kontrol("§1b kurcalanmış gövde (parmak izi değişti) → 400 ZARF_BICIM", kurcali === "400 ZARF_BICIM", kurcali);
    const yabanci = await hataKodu(async () => svc.exemptionIdentityFromEnvelope(zarfUret({ anahtar, govde, imzalayan: kurulumAnahtariUret() })));
    kontrol("§1c başka anahtarla imzalı istek (gövdedeki anahtarın sahibi değil) → 400 ZARF_BICIM", yabanci === "400 ZARF_BICIM", yabanci);
    const eski = svc.exemptionIdentityFromEnvelope(zarfUret({ anahtar, govde, zamanMs: Date.now() - 6 * 3600_000 }));
    kontrol("§1d ✓K 6 saat önce imzalı zarf KABUL (tazelik değil sahiplik)", eski.anahtarKimligi === installationKeyId(anahtar.x));
    const yokla = await hataKodu(async () => svc.exemptionIdentityFromEnvelope(zarfUret({ anahtar, govde, amac: "yokla", kurulumId: k.kurulumId })));
    const bicimsiz = await hataKodu(async () => svc.exemptionIdentityFromEnvelope("bu bir zarf değil"));
    kontrol("§1e yoklama amaçlı zarf 400 GOVDE_GECERSIZ · biçimsiz metin 400 ZARF_BICIM", yokla === "400 GOVDE_GECERSIZ" && bicimsiz === "400 ZARF_BICIM", `${yokla} | ${bicimsiz}`);
    const tasimaGovdesi = { v: 1, acikAnahtar: anahtar.x, parmakIzi: f.parmakIzi, ortam: ORTAM, gerekce: null };
    const tasima = svc.exemptionIdentityFromEnvelope(zarfUret({ anahtar, govde: tasimaGovdesi, amac: "tasima" }));
    kontrol("§1f taşıma isteği zarfı da kimlik verir", tasima.anahtarKimligi === installationKeyId(anahtar.x));

    console.log("\n§2 kök planı");
    const plan = await svc.previewExemptionSigner(ctx, { installationDbId: k.kurulumDbId, nowMs: Date.now() });
    kontrol("§2 plan: ara yokken KÖK", plan.imzaci === "KOK" && plan.kid === f.kok.kid, JSON.stringify(plan));
    const p = await muafiyet(k.kurulumDbId, zarfUret({ anahtar, govde }));
    const jws = parseJws(p.jws);
    const doc = jws.ok ? decodeDocument(ExemptionSchema, jws.value.payload) : null;
    kontrol(
      "§2a ✓K belge kökle imzalı (typ muafiyet), sertifikasız, anahtar + parmak izi zarftakiyle aynı",
      jws.ok && jws.value.header.typ === TYP.MUAFIYET && jws.value.header.kid === f.kok.kid && doc?.ok === true && doc.value.imzaciSertifikasi === undefined &&
        doc.value.kurulumAnahtarKimligi === installationKeyId(anahtar.x) && JSON.stringify(doc.value.parmakIzi) === JSON.stringify(f.parmakIzi),
      jws.ok ? JSON.stringify(jws.value.header) : "",
    );
    const r = await prisma.$transaction((tx) => svc.recordExemptionTx(tx, p, "bekci"));
    const kayit = await prisma.kurulumKaydi.findFirst({ where: { kurulumId: k.kurulumDbId, olay: "MUAFIYET_VERILDI" } });
    kontrol("§2b kurulum kaydı MUAFIYET_VERILDI (anahtar + imzacı + muafiyet kimliği)", kayit?.anahtarKimligi === r.anahtarKimligi && (kayit?.ayrinti as { muafiyetId?: string; imzaci?: string } | null)?.muafiyetId === r.muafiyetId && r.imzaci === "KOK");
    const dosya = svc.exemptionFile(p, k.lisansNo);
    kontrol("§2c dosya biçimi {v:1, muafiyet} (fabrikanın çevrimdışı yanıt ucu tanır) + lisans no'lu ad", dosya.dosya.v === 1 && dosya.dosya.muafiyet === p.jws && /^muafiyet-TKS-\d{4}-\d{4}-\d{8}\.json$/.test(dosya.dosyaAdi), dosya.dosyaAdi);

    console.log("\n§3 kapılar");
    await eskiDerlemeEtkin(k.kurulumDbId, f);
    const etkin = await hataKodu(() => muafiyet(k.kurulumDbId, zarfUret({ anahtar, govde })));
    const etkinTx = await hataKodu(() => prisma.$transaction((tx) => svc.recordExemptionTx(tx, p, "bekci")));
    kontrol("§3a etkin kurulum → 409 (hazırlıkta ve kayıtta — TOCTOU)", etkin === "409 DURUM_CAKISMASI" && etkinTx === "409 DURUM_CAKISMASI", `${etkin} | ${etkinTx}`);
    await prisma.kurulum.update({ where: { id: k.kurulumDbId }, data: { durum: "IPTAL" } });
    const iptal = await hataKodu(() => muafiyet(k.kurulumDbId, zarfUret({ anahtar, govde })));
    kontrol("§3b iptal kurulum → 409", iptal === "409 DURUM_CAKISMASI", iptal);
    const k2 = await kurulumFiksturu(ctx);
    kurulumlar.push(k2.kurulumDbId);
    const k3 = await kurulumFiksturu(ctx);
    kurulumlar.push(k3.kurulumDbId);
    const bagli = kurulumAnahtariUret();
    await prisma.kurulum.update({ where: { id: k3.kurulumDbId }, data: { anahtarKimligi: installationKeyId(bagli.x), acikAnahtar: bagli.x } });
    const bagliSonuc = await hataKodu(() => muafiyet(k2.kurulumDbId, zarfUret({ anahtar: bagli, govde: etkinlestirmeGovdesi({ kod: k2.kod, kurulumId: null, anahtar: bagli, parmakIzi: f.parmakIzi }) })));
    kontrol("§3c anahtarı başka kuruluma bağlı → 409", bagliSonuc === "409 DURUM_CAKISMASI", bagliSonuc);
    const a2 = kurulumAnahtariUret();
    const baskaKimlik = await hataKodu(() =>
      muafiyet(k2.kurulumDbId, zarfUret({ anahtar: a2, kurulumId: k3.kurulumId, govde: etkinlestirmeGovdesi({ kod: k2.kod, kurulumId: k3.kurulumId, anahtar: a2, parmakIzi: f.parmakIzi }) })),
    );
    kontrol("§3d zarfın lisans kimliği başka kurulumun → 409", baskaKimlik === "409 DURUM_CAKISMASI", baskaKimlik);
    const z2 = zarfUret({ anahtar: a2, govde: etkinlestirmeGovdesi({ kod: k2.kod, kurulumId: null, anahtar: a2, parmakIzi: f.parmakIzi }) });
    const uyusmaz = await hataKodu(() => muafiyet(k2.kurulumDbId, z2, { imzaci: "ARA", parola: "kullanilmayan" }));
    const yanlis = await hataKodu(() => muafiyet(k2.kurulumDbId, z2, { parola: "yanlis-parola-bekci" }));
    kontrol("§3e plan uyuşmazlığı 409 · yanlış parola 400 IMZA_PAROLASI_HATALI", uyusmaz === "409 DURUM_CAKISMASI" && yanlis === "400 IMZA_PAROLASI_HATALI", `${uyusmaz} | ${yanlis}`);
    const kapsamsiz = await hataKodu(() =>
      svc.prepareExemption(ctx, { installationDbId: k2.kurulumDbId, zarf: z2, reason: "x", expectedSigner: "KOK", password: passwordBuffer(TEST_KOK_PAROLASI), nowMs: Date.now() }),
    );
    kontrol("§3f kapsamsız (portal/CLI dışı) imza RED", kapsamsiz.startsWith("500"), kapsamsiz);

    console.log("\n§4 ara imzacı planı");
    const sertifika = sertifikaBas(f.kok, sertifikaYuku(f, f.ara, "HAK", { siniflar: ARA_SINIFLARI }));
    writeKeyFileExclusive(
      path.join(ortam.dizin, `${f.ara.kid}.ara.json`),
      await wrapPrivateKey({ tur: "tekserp-ara-anahtar", kid: f.ara.kid, siniflar: ARA_SINIFLARI, sertifika }, f.ara.privateKey, passwordBuffer(ARA_PAROLASI)),
    );
    ctx = { ...ctx, keys: KeyStore.load(ctx.config) };
    const planAra = await svc.previewExemptionSigner(ctx, { installationDbId: k2.kurulumDbId, nowMs: Date.now() });
    const pa = await muafiyet(k2.kurulumDbId, z2, { imzaci: "ARA", parola: ARA_PAROLASI });
    const ja = parseJws(pa.jws);
    kontrol(
      "§4a ara varken plan ARA; belge ara imzalı, KENDİ HAK sertifikası gömülü",
      planAra.imzaci === "ARA" && ja.ok && ja.value.header.kid === f.ara.kid && (ja.value.payload as { imzaciSertifikasi?: string }).imzaciSertifikasi === sertifika && pa.imzaci === "ARA",
      JSON.stringify(planAra),
    );

    console.log("\n§5 imza alt süreci");
    const yuk = { v: 1, muafiyetId: randomUUID(), kurulumAnahtarKimligi: installationKeyId(a2.x), parmakIzi: f.parmakIzi, verilis: new Date().toISOString(), gerekce: "sonda", imzaciSertifikasi: sertifika };
    const kokAra = await hataKodu(() =>
      runAsCli(() => signWithWrappedKey({ keyFile: path.join(ortam.dizin, `${f.kok.kid}.kok.json`), typ: TYP.MUAFIYET, payload: yuk, password: passwordBuffer(TEST_KOK_PAROLASI) })),
    );
    kontrol("§5a kök, ara sertifikalı muafiyeti basmaz", /Kök, ara imzacı sertifikalı muafiyeti imzalamaz|YETKISIZ/.test(kokAra), kokAra);
  } finally {
    await temizleKurulumlar(kurulumlar, kidler);
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
