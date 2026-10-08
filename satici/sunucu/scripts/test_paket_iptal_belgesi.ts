// =============================================================================
// DAĞITIM İPTALİ DEFTERİ (`tekserp-paketiptal`; PAKET-ANAHTARI-KOK-ALTINDA §2.4 D4 · ISTEMCI-ANAHTARI-KOK-ALTINDA §3.4 I6)
// — içe aktarma (ekleme-yalnız defter) · kira yanıtında `paketIptal` (HER kuruluma) · `donem-ice-aktar`. Kendi _test DB'si.
//   §1 içe aktarma (`importPackageRevocation`): `pkt-*` + `ist-*` satırlı kök imzalı belge EKLENDI · aynı belge VARDI ·
//      aynı sıra başka belge 409 · düşük sıra 409 · sıra atlayabilir · önceki satırı (kid + sertifika kimliği) düşüren
//      belge 409 · aynı iptal kimliği başka sırada 409 · kök dışı imzacı / `tekserp-iptal` türü 400 (deftere girmez) · iki defter karışmaz (`tekserp-paketiptal` `iptal_belgesi`ne girmez)
//   §2 satır GÜNCELLENEMEZ ve (beyansız) SİLİNEMEZ — tetikleyici; `sira >= 1` CHECK
//   §3 kira yanıtı (gerçek satıcı süreci): yeteneksiz (eski) kurulumun etkinleştirmesi ve yoklaması da, `paket-zinciri`
//      bildireni de en yüksek sıralı belgeyi `paketIptal`de alır; kiraya sıra pini GİRMEZ; çevrimdışı uzatma dosyası da taşır
//   §4 tek seçim: kira yanıtını yalnız `licenseResponse` kurar ve `paketIptal`i kendi gövdesinde `leasePackageRevocation`dan seçer
//   §5 `donem-ice-aktar`: `paketIptal` alanı içe aktarılır (EKLENDI, tekrar VARDI); biçimsiz alan RED (çıkış 1)
// ⭐ KALICI SONDA ✓K (her koşumda): §1a geçerli belge GERÇEKTEN eklenir · §3a defter doluyken yanıt GERÇEKTEN taşır
//    (her yere null veren kör seçim yeşil veremez) · §4c tarayıcı sentetik seçimsiz gövdeyi ve ikinci boğazı yakalar.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_paket_iptal_belgesi.ts   (kendi _test DB'si)
// =============================================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ENDPOINTS, PROTOCOL_VERSION, TYP, msToIso, parseJws, verifyPackageRevocation } from "../src/lisans-protokol";
import { anahtarUret, hamImzala, iptalBas, iptalYuku, kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { lockInstallation } from "../src/lib/locks";
import {
  SATICI_KOKU,
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kiraIdOf,
  kiraYuku,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleIptalBelgeleri,
  temizleKurulumlar,
  temizlePaketIptalBelgeleri,
  yoklamaGovdesi,
} from "./lib/test-ortam";
// Bekçi/koşucu gerçek Anahtar Zinciri'ne GİTMEZ: parola okuyan araçlar kasa yerine stdin/dosya kullanır (scripts/lib/parola-kasasi.mjs).
process.env.TEKSERP_PAROLA_KASASI = "kapali";

const YUKLEYEN = "bekci-paket-iptal";
const CLI_YUKLEYEN = "cli:donem-ice-aktar";

interface Satir {
  kid: string;
  sertifikaId: string;
  tarih: string;
  neden: string;
}

const satir = (kid: string, neden = "bekçi"): Satir => ({ kid, sertifikaId: randomUUID(), tarih: msToIso(Date.now()), neden });

function yuk(sira: number, iptaller: Satir[], iptalId: string = randomUUID()): Record<string, unknown> {
  return { v: PROTOCOL_VERSION, iptalId, sira, verilis: msToIso(Date.now()), iptaller };
}

/** §4 — yanıtı kuran boğaz: `LicenseResponseSchema` ve `paketIptal` anahtarı hangi dosyalarda, `licenseResponse` gövdesi seçimi çağırıyor mu. */
export function responseThroat(files: { name: string; text: string }[]): { schemaFiles: string[]; fieldFiles: string[]; bodySelects: boolean } {
  const clean = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const schemaFiles: string[] = [];
  const fieldFiles: string[] = [];
  let bodySelects = false;
  for (const { name, text } of files) {
    const c = clean(text);
    if (/\bLicenseResponseSchema\b/.test(c)) schemaFiles.push(name);
    if (/\bpaketIptal\b/.test(c)) fieldFiles.push(name);
    const at = c.search(/export async function licenseResponse\(/);
    if (at >= 0) {
      const open = c.indexOf("{", c.indexOf("): Promise<LicenseResponse>", at));
      let depth = 0;
      let end = open;
      for (; end < c.length; end++) {
        if (c[end] === "{") depth++;
        else if (c[end] === "}" && --depth === 0) break;
      }
      bodySelects = /await leasePackageRevocation\(db, keys\)/.test(c.slice(open, end));
    }
  }
  return { schemaFiles: schemaFiles.sort(), fieldFiles: fieldFiles.sort(), bodySelects };
}

function srcFiles(dir: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "lisans-protokol") out.push(...srcFiles(p));
    } else if (n.endsWith(".ts")) out.push({ name: path.relative(SATICI_KOKU, p), text: readFileSync(p, "utf8") });
  }
  return out;
}

function cli(argv: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", ...argv], {
    cwd: SATICI_KOKU,
    encoding: "utf8",
    input: "",
    env: { PATH: process.env.PATH ?? "", ...env },
    timeout: 120_000,
  });
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { importPackageRevocation } = await import("../src/services/package-revocation.service");
  const { importRevocation } = await import("../src/services/revocation.service");
  const { issueExtensionFileTx } = await import("../src/services/extension-file.service");
  const temizlenecek: string[] = [];
  const tmp = mkdtempSync(path.join(os.tmpdir(), "satici-paket-iptal-"));
  let sunucu: Awaited<ReturnType<typeof sunucuBaslat>> | null = null;
  try {
    await temizlePaketIptalBelgeleri(YUKLEYEN);
    await temizlePaketIptalBelgeleri(CLI_YUKLEYEN);
    await temizleIptalBelgeleri(YUKLEYEN);
    const yabanci = await prisma.paketIptalBelgesi.count();
    kontrol("§0 dağıtım iptali defterinde bu bekçinin dışında satır yok (sıra karşılaştırması bu satırlara göre)", yabanci === 0, `${yabanci} satır`);

    console.log("\n§1 içe aktarma");
    const ekle = (token: string) => importPackageRevocation({ token, anchor: ctx.keys.anchor, actor: YUKLEYEN }).then((r) => r.durum, (e: { status?: number; code?: string }) => `${e.status} ${e.code}`);
    const pkt = satir("pkt-2027-1");
    const ist = satir("ist-2027-1");
    const s1 = hamImzala(TYP.PAKET_IPTAL, f.kok, yuk(1, [pkt, ist]));
    const s1Sonuc = await ekle(s1);
    const s1Satir = await prisma.paketIptalBelgesi.findUnique({ where: { sira: 1 } });
    kontrol("§1a ✓K pkt-* + ist-* satırlı kök imzalı belge EKLENDI (kidler iki aile, imzalayan kök)",
      s1Sonuc === "EKLENDI" && s1Satir?.kidler.join() === "ist-2027-1,pkt-2027-1" && s1Satir.imzalayanKid === f.kok.kid && s1Satir.belge === s1, `${s1Sonuc} ${s1Satir?.kidler.join()}`);
    const denetim = s1Satir ? await prisma.denetim.findFirst({ where: { varlikId: s1Satir.id, olay: "PAKET_IPTAL_BELGESI_YUKLENDI" } }) : null;
    kontrol("§1b denetim satırı yazıldı (PAKET_IPTAL_BELGESI_YUKLENDI, belge metni özette yok)", !!denetim && !JSON.stringify(denetim.ozet).includes(s1.slice(0, 40)));
    kontrol("§1c aynı belge tekrar → VARDI (idempotent, ikinci satır yok)", (await ekle(s1)) === "VARDI" && (await prisma.paketIptalBelgesi.count()) === 1);
    const s1b = hamImzala(TYP.PAKET_IPTAL, f.kok, yuk(1, [pkt, ist]));
    kontrol("§1d aynı sıra BAŞKA belge → 409", (await ekle(s1b)) === "409 DURUM_CAKISMASI");
    const pkt2 = satir("pkt-2027-2");
    const s3 = hamImzala(TYP.PAKET_IPTAL, f.kok, yuk(3, [pkt, ist, pkt2]));
    const s2 = hamImzala(TYP.PAKET_IPTAL, f.kok, yuk(2, [pkt, ist, pkt2]));
    const s3Sonuc = await ekle(s3);
    const s2Sonuc = await ekle(s2);
    kontrol("§1e sıra yalnız artar: 3 EKLENDI (atlayabilir), sonra düşük sıra 2 → 409", s3Sonuc === "EKLENDI" && s2Sonuc === "409 DURUM_CAKISMASI", `${s3Sonuc} / ${s2Sonuc}`);
    const dusurenIst = hamImzala(TYP.PAKET_IPTAL, f.kok, yuk(4, [pkt, pkt2]));
    const dusurenPkt = hamImzala(TYP.PAKET_IPTAL, f.kok, yuk(4, [ist, pkt2]));
    const kidDegisen = hamImzala(TYP.PAKET_IPTAL, f.kok, yuk(4, [pkt, ist, { ...pkt2, kid: "pkt-2027-9" }]));
    const r1 = await ekle(dusurenIst);
    const r2 = await ekle(dusurenPkt);
    const r3 = await ekle(kidDegisen);
    kontrol("§1f önceki satırı DÜŞÜREN belge → 409 (ist satırı da, pkt satırı da, aynı sertifikanın kid'i değişen de)",
      [r1, r2, r3].every((r) => r === "409 DURUM_CAKISMASI"), `${r1} / ${r2} / ${r3}`);
    const s3Kimlik = (await prisma.paketIptalBelgesi.findUniqueOrThrow({ where: { sira: 3 } })).iptalId;
    const ayniKimlik = await ekle(hamImzala(TYP.PAKET_IPTAL, f.kok, yuk(5, [pkt, ist, pkt2], s3Kimlik)));
    kontrol("§1g aynı iptal kimliği başka sırada → 409 (tekillik ihlali 'tekrar deneyin' değil)", ayniKimlik === "409 DURUM_CAKISMASI", ayniKimlik);
    const pktImzaci = anahtarUret("pkt-2027-3");
    const disKok = await ekle(hamImzala(TYP.PAKET_IPTAL, anahtarUret("kok-fikstur-9"), yuk(9, [pkt, ist, pkt2])));
    const pktImzali = await ekle(hamImzala(TYP.PAKET_IPTAL, pktImzaci, yuk(9, [pkt, ist, pkt2])));
    const eskiTur = await ekle(iptalBas(f.kok, iptalYuku(f, { sira: 9, iptaller: [] })));
    kontrol("§1h çapa dışı kök · PAKET anahtarının kendi imzası · `tekserp-iptal` türü → 400 (deftere girmez)",
      /^400 (KOK_BILINMIYOR|JWS_IMZA)$/.test(disKok) && pktImzali === "400 KOK_BILINMIYOR" && eskiTur === "400 JWS_TYP", `${disKok} / ${pktImzali} / ${eskiTur}`);
    const karisma = await importRevocation({ token: s3, anchor: ctx.keys.anchor, actor: YUKLEYEN }).then((r) => r.durum, (e: { status?: number; code?: string }) => `${e.status} ${e.code}`);
    kontrol("§1i iki defter karışmaz: `tekserp-paketiptal` sertifika iptal defterine GİRMEZ (400)", /^400 /.test(karisma) && (await prisma.iptalBelgesi.count({ where: { yukleyen: YUKLEYEN } })) === 0, karisma);
    kontrol("§1j defterde yalnız kabul edilenler: sıra 1 ve 3", (await prisma.paketIptalBelgesi.findMany({ orderBy: { sira: "asc" } })).map((r) => r.sira).join() === "1,3");

    console.log("\n§2 tetikleyici + CHECK");
    let guncelleme = "GECTI";
    let silme = "GECTI";
    try {
      await prisma.paketIptalBelgesi.update({ where: { sira: 1 }, data: { yukleyen: "kurcalama" } });
    } catch (err) {
      guncelleme = (err as Error).message;
    }
    try {
      await prisma.paketIptalBelgesi.deleteMany({ where: { sira: 1 } });
    } catch (err) {
      silme = (err as Error).message;
    }
    kontrol("§2a defter satırı GÜNCELLENEMEZ ve (beyansız) SİLİNEMEZ — tetikleyici", /Defter satırı değiştirilemez/.test(guncelleme) && /Defter satırı değiştirilemez/.test(silme), `${guncelleme.slice(-80)} | ${silme.slice(-80)}`);
    let sifir = "GECTI";
    try {
      await prisma.paketIptalBelgesi.create({ data: { iptalId: randomUUID(), sira: 0, belge: "x", imzalayanKid: "x", verilis: new Date(), kidler: [], yukleyen: YUKLEYEN } });
    } catch (err) {
      sifir = (err as Error).message;
    }
    kontrol("§2b `sira >= 1` CHECK (sıra 0 satırı yazılamaz)", /paket_iptal_belgesi_sira_pozitif/.test(sifir), sifir.slice(-100));

    console.log("\n§3 kira yanıtında paketIptal (gerçek satıcı süreci)");
    const kE = await kurulumFiksturu(ctx);
    temizlenecek.push(kE.kurulumDbId);
    const kY = await kurulumFiksturu(ctx);
    temizlenecek.push(kY.kurulumDbId);
    const aE: TestAnahtari = kurulumAnahtariUret();
    const aY: TestAnahtari = kurulumAnahtariUret();
    sunucu = await sunucuBaslat(ortam);
    const genel = sunucu.genel;
    const etkinlestir = (k: typeof kE, a: TestAnahtari, yetenekler?: string[]) =>
      imzaliPost(genel, ENDPOINTS.ACTIVATE, {
        kurulumId: k.kurulumId,
        amac: "etkinlestir",
        anahtar: a,
        govde: { ...etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar: a, parmakIzi: f.parmakIzi }), ...(yetenekler ? { yetenekler } : {}) },
      });
    const yokla = (k: typeof kE, a: TestAnahtari, sonKiraId: string, yetenekler?: string[]) =>
      imzaliPost(genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar: a, govde: yoklamaGovdesi({ sonKiraId, hak: null, parmakIzi: f.parmakIzi, ...(yetenekler ? { v2: { yetenekler } } : {}) }) });
    const eE = await etkinlestir(kE, aE);
    const eY = await etkinlestir(kY, aY, ["odenmis-tarih", "parmak-izi-v2", "paket-zinciri"]);
    const instE = await prisma.kurulum.findUniqueOrThrow({ where: { id: kE.kurulumDbId } });
    kontrol("§3a ✓K yeteneksiz (eski) kurulumun etkinleştirme yanıtı en yüksek sıralı belgeyi (3) taşır — yetenek kapısı yok",
      eE.status === 200 && instE.yetenekler.length === 0 && eE.json.paketIptal === s3, `${eE.status} ${eE.kod ?? ""} yetenek=${instE.yetenekler.join()} paketIptal=${eE.json.paketIptal === s3 ? "s3" : String(eE.json.paketIptal).slice(0, 20)}`);
    const pE = await yokla(kE, aE, kiraIdOf(eE.json));
    kontrol("§3b yeteneksiz yoklamanın yanıtı da taşır", pE.status === 200 && pE.json.paketIptal === s3, `${pE.status} ${pE.kod ?? ""}`);
    const pY = await yokla(kY, aY, kiraIdOf(eY.json), ["odenmis-tarih", "parmak-izi-v2", "paket-zinciri"]);
    kontrol("§3c `paket-zinciri` bildiren kurulumun etkinleştirmesi ve yoklaması da aynı belgeyi taşır", eY.status === 200 && eY.json.paketIptal === s3 && pY.status === 200 && pY.json.paketIptal === s3, `${eY.status}/${pY.status}`);
    const kiraAnahtarlari = Object.keys(kiraYuku(pE.json));
    kontrol("§3d kiraya dağıtım iptali sıra pini GİRMEZ (imzalı kira yükünde 'paket' anahtarı yok)", kiraAnahtarlari.length > 0 && !kiraAnahtarlari.some((k) => /paket/i.test(k)), kiraAnahtarlari.filter((k) => /iptal|paket/i.test(k)).join());
    const dosya = await prisma.$transaction(async (tx) => {
      await lockInstallation(tx, kE.kurulumDbId);
      return issueExtensionFileTx(tx, ctx, { installationDbId: kE.kurulumDbId, actor: YUKLEYEN, nowMs: Date.now() });
    });
    kontrol("§3e çevrimdışı uzatma dosyası (elle taşınan kira yanıtı) da taşır", dosya.dosya.paketIptal === s3);

    console.log("\n§4 tek seçim noktası");
    const t = responseThroat(srcFiles(path.join(SATICI_KOKU, "src")));
    const LEASE = path.join("src", "services", "lease.service.ts");
    kontrol("§4a kira yanıtını yalnız `licenseResponse` kurar (`LicenseResponseSchema` ve `paketIptal` anahtarı protokol dışında yalnız lease.service.ts'de)",
      t.schemaFiles.join() === LEASE && t.fieldFiles.join() === LEASE, `şema: ${t.schemaFiles.join(", ")} · alan: ${t.fieldFiles.join(", ")}`);
    kontrol("§4b `licenseResponse` dağıtım iptalini kendi gövdesinde `leasePackageRevocation`dan seçer (çağıran veremez, atlayamaz)", t.bodySelects);
    const sonda = responseThroat([
      { name: "sonda/a.ts", text: "export async function licenseResponse(db, keys, g): Promise<LicenseResponse> { return LicenseResponseSchema.parse({ v: 1 }); }" },
      { name: "sonda/b.ts", text: "const r = LicenseResponseSchema.parse({ v: 1, paketIptal: null });" },
    ]);
    kontrol("§4c ✓K tarayıcı ısırır: seçimsiz gövde ve ikinci yanıt kuran dosya yakalanır", !sonda.bodySelects && sonda.schemaFiles.length === 2 && sonda.fieldFiles.join() === "sonda/b.ts");

    console.log("\n§5 donem-ice-aktar");
    const s6 = hamImzala(TYP.PAKET_IPTAL, f.kok, yuk(6, [pkt, ist, pkt2, satir("ist-2027-2")]));
    const paket = path.join(tmp, "ice-aktar.json");
    writeFileSync(paket, JSON.stringify({ v: 1, tur: "tekserp-donem-ice-aktar", paketIptal: s6, haklar: [] }));
    const env = { DATABASE_URL: process.env.DATABASE_URL ?? "", ANAHTAR_DIZINI: ortam.dizin, GUVEN_CAPASI_DOSYASI: ortam.capaDosyasi };
    const ice = cli(["donem-ice-aktar", `--dosya=${paket}`], env);
    const s6Satir = await prisma.paketIptalBelgesi.findUnique({ where: { sira: 6 } });
    kontrol("§5a paketIptal sıra 6 EKLENDI (çıkış 0, yükleyen cli:donem-ice-aktar)", ice.status === 0 && /dağıtım iptali sıra 6: EKLENDI/.test(ice.stdout) && s6Satir?.yukleyen === CLI_YUKLEYEN,
      `${ice.status} ${ice.stdout.trim().replace(/\n/g, " | ").slice(0, 160)} ${ice.stderr.trim().slice(0, 160)}`);
    const tekrar = cli(["donem-ice-aktar", `--dosya=${paket}`], env);
    kontrol("§5b aynı paketin tekrarı VARDI (çıkış 0)", tekrar.status === 0 && /dağıtım iptali sıra 6: VARDI/.test(tekrar.stdout), tekrar.stdout.trim());
    writeFileSync(paket, JSON.stringify({ v: 1, tur: "tekserp-donem-ice-aktar", paketIptal: 42, haklar: [] }));
    const bicimsiz = cli(["donem-ice-aktar", `--dosya=${paket}`], env);
    kontrol("§5c biçimsiz paketIptal alanı RED (çıkış 1, deftere bir şey girmez)", bicimsiz.status === 1 && /dağıtım iptali: RED/.test(bicimsiz.stdout) && (await prisma.paketIptalBelgesi.count()) === 3, `${bicimsiz.status} ${bicimsiz.stdout.trim()}`);
    const sonra = await yokla(kE, aE, kiraIdOf(pE.json));
    const sonraSira = (() => {
      const p = parseJws(sonra.json.paketIptal);
      return p.ok ? p.value.payload.sira : null;
    })();
    kontrol("§5d içe aktarılan yeni belge bir sonraki yanıtta dağıtılır (sıra 6)", sonra.status === 200 && sonraSira === 6, `${sonra.status} ${String(sonraSira)}`);
  } finally {
    await sunucu?.durdur();
    await temizleKurulumlar(temizlenecek, ortam.kidler);
    await temizlePaketIptalBelgeleri(YUKLEYEN);
    await temizlePaketIptalBelgeleri(CLI_YUKLEYEN);
    await temizleIptalBelgeleri(YUKLEYEN);
    rmSync(tmp, { recursive: true, force: true });
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
