// =============================================================================
// SERTİFİKA İPTAL BELGESİ (G4 §2.3) — üretim (CLI, yalnız kök) · defter (içe aktarma, ekleme-yalnız) · dağıtım kapısı ·
// emekliye ayırma · dönem paketinin içe aktarılması. Kendi _test DB'si.
//   §1 `iptal-uret`: kök parolası stdin'den; ilk belge sıra 1; `--onceki` ile önceki BÜTÜN satırlar taşınır, sıra + 1;
//      belge kökle doğrulanır; kök iptal edilemez; yanlış parola hiçbir şey yazmaz; ara anahtar iptal belgesi basamaz
//   §2 defter (`importRevocation`): EKLENDI · aynı belge VARDI · aynı sıra başka belge 409 · düşük sıra 409 · önceki
//      satırı düşüren belge 409 (iptal sessizce geri alınamaz) · çapa dışı/ara imzalı belge 400 · satır GÜNCELLENEMEZ ve
//      SİLİNEMEZ (tetikleyici)
//   §3 dağıtım kapısı (`distributableRevocation`): engelsiz en yüksek sıra dağıtılır; etkin HAK'ın güncel sürümünü
//      imzalamış ya da hâlâ yüklü bir anahtarı iptal eden belge BEKLER (önceki dağıtılır, engeller listelenir); HAK
//      yeniden basılıp anahtar emekliye ayrılınca dağıtılır
//   §4 `emekliye-ayir`: varsayılan KURU (değişiklik yok); aynı türde daha yeni anahtar yoksa RED; `--uygula` özel yarıyı
//      siler, açık yarı + sertifika `.sertifika.json` kalır (künyede EMEKLI); tekrar → "zaten emekli"
//   §5 `donem-ice-aktar` (konteyner CLI'ı): iptal belgesi + kök imzalı HAK tek dosyadan; biçimsiz dosya RED
// ⭐ KALICI SONDA ✓K (her koşumda): §2a geçerli belge GERÇEKTEN eklenir · §3c engeller kalkınca belge GERÇEKTEN dağıtılır
//    (her şeyi bekleten kör kapı yeşil veremez) · §4c `--uygula` GERÇEKTEN siler.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_iptal_belgesi.ts   (kendi _test DB'si)
// =============================================================================
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DAY_MS, TYP, msToIso, verifyRevocation, type CertificateDoc, type LicenseClass, type RevocationDoc } from "../src/lisans-protokol";
import { anahtarUret, hamImzala, iptalBas, iptalYuku, sertifikaBas, sertifikaYuku, type Fikstur, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { KeyStore } from "../src/keys/key-store";
import { runAsCli } from "../src/lib/request-scope";
import {
  SATICI_KOKU,
  TEST_KOK_PAROLASI,
  anahtarOrtamiKur,
  hedefDbKapisi,
  kapat,
  kontrol,
  kurulumFiksturu,
  sonuc,
  temizleIptalBelgeleri,
  temizleKurulumlar,
} from "./lib/test-ortam";

const ARA_PAROLASI = "bekci-ara-parolasi-iptal";
const YUKLEYEN = "bekci-iptal";
const CLI_YUKLEYEN = "cli:donem-ice-aktar";
const ARA_SINIFLARI: LicenseClass[] = ["URETIM", "DR", "DEMO", "TEST"];

async function araYaz(dizin: string, f: Fikstur, konu: TestAnahtari, ek: Partial<CertificateDoc> = {}): Promise<{ dosya: string; sertifika: string }> {
  const sertifika = sertifikaBas(f.kok, sertifikaYuku(f, konu, "HAK", { siniflar: ARA_SINIFLARI, ...ek }));
  const dosya = path.join(dizin, `${konu.kid}.ara.json`);
  writeKeyFileExclusive(dosya, await wrapPrivateKey({ tur: "tekserp-ara-anahtar", kid: konu.kid, siniflar: ARA_SINIFLARI, sertifika }, konu.privateKey, passwordBuffer(ARA_PAROLASI)));
  return { dosya, sertifika };
}

function cli(argv: string[], g: { input?: string; env?: Record<string, string> } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", ...argv], {
    cwd: SATICI_KOKU,
    encoding: "utf8",
    input: g.input ?? "",
    env: { PATH: process.env.PATH ?? "", ...(g.env ?? {}) },
    timeout: 120_000,
  });
}

/** Sertifikanın iptal satırı (kid + kimlik + kullanım). */
function satir(konu: TestAnahtari, kullanim: CertificateDoc["kullanim"], sertifikaId: string = randomUUID()): RevocationDoc["iptaller"][number] {
  return { kid: konu.kid, sertifikaId, kullanim, tarih: msToIso(Date.now()), neden: "bekçi" };
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { importRevocation, distributableRevocation } = await import("../src/services/revocation.service");
  const hakSvc = await import("../src/services/entitlement.service");
  const temizlenecek: string[] = [];
  const tmp = mkdtempSync(path.join(os.tmpdir(), "satici-iptal-"));
  const ekKidler: string[] = [f.ara.kid];
  try {
    await temizleIptalBelgeleri(YUKLEYEN);
    await temizleIptalBelgeleri(CLI_YUKLEYEN);
    const yabanci = await prisma.iptalBelgesi.count();
    kontrol("§0 defterde bu bekçinin dışında satır yok (sıra karşılaştırması bu satırlara göre)", yabanci === 0, `${yabanci} satır`);

    console.log("\n§1 iptal-uret (yalnız kök)");
    const ara = await araYaz(ortam.dizin, f, f.ara);
    const altDosyasi = path.join(ortam.dizin, `${f.alt.kid}.anahtar.json`);
    const birinci = path.join(tmp, "iptal-1.json");
    const r1 = cli(["iptal-uret", `--kok=${f.kok.kid}`, `--kok-dizin=${ortam.dizin}`, `--cikti=${birinci}`, `--iptal=${ara.dosya}`, "--neden=bekçi turu"], { input: `${TEST_KOK_PAROLASI}\n` });
    const b1 = existsSync(birinci) ? (JSON.parse(readFileSync(birinci, "utf8")) as { sira: number; belge: string }) : null;
    const v1 = b1 ? verifyRevocation(b1.belge, f.kokler) : null;
    kontrol("§1a ilk belge sıra 1, ara imzacının sertifikası (kid + kimlik + HAK) iptal satırında, kökle doğrulanır",
      r1.status === 0 && !!v1?.ok && v1.value.document.sira === 1 && v1.value.document.iptaller.length === 1 && v1.value.document.iptaller[0]!.kid === f.ara.kid && v1.value.document.iptaller[0]!.kullanim === "HAK" && v1.value.document.iptaller[0]!.neden === "bekçi turu",
      `${r1.status} ${r1.stderr.trim().slice(0, 160)}`);
    const ikinci = path.join(tmp, "iptal-2.json");
    const r2 = cli(["iptal-uret", `--kok=${f.kok.kid}`, `--kok-dizin=${ortam.dizin}`, `--cikti=${ikinci}`, `--onceki=${birinci}`, `--iptal=${altDosyasi}`], { input: `${TEST_KOK_PAROLASI}\n` });
    const v2 = existsSync(ikinci) ? verifyRevocation((JSON.parse(readFileSync(ikinci, "utf8")) as { belge: string }).belge, f.kokler) : null;
    kontrol("§1b --onceki: sıra 2, önceki satır TAŞINDI + yeni satır (ALT)", r2.status === 0 && !!v2?.ok && v2.value.document.sira === 2 && v2.value.document.iptaller.map((e) => e.kid).join() === `${f.ara.kid},${f.alt.kid}`, `${r2.status} ${r2.stderr.trim().slice(0, 160)}`);
    const kokIptal = cli(["iptal-uret", `--kok=${f.kok.kid}`, `--kok-dizin=${ortam.dizin}`, `--cikti=${path.join(tmp, "kok.json")}`, `--iptal=${path.join(ortam.dizin, `${f.kok.kid}.kok.json`)}`], { input: `${TEST_KOK_PAROLASI}\n` });
    const yanlis = cli(["iptal-uret", `--kok=${f.kok.kid}`, `--kok-dizin=${ortam.dizin}`, `--cikti=${path.join(tmp, "yanlis.json")}`], { input: "yanlis-kok-parolasi-1\n" });
    kontrol("§1c kök iptal EDİLEMEZ (çıkış 2) · yanlış kök parolası hiçbir şey yazmaz", kokIptal.status === 2 && /Kök iptal edilemez/.test(kokIptal.stderr) && !existsSync(path.join(tmp, "kok.json")) && yanlis.status !== 0 && !existsSync(path.join(tmp, "yanlis.json")), `${kokIptal.status}/${yanlis.status}`);
    const { signWithWrappedKey } = await import("../src/keys/signer");
    let araIptal = "GECTI";
    try {
      await runAsCli(() => signWithWrappedKey({ keyFile: ara.dosya, typ: TYP.IPTAL, payload: iptalYuku(f) as unknown as Record<string, unknown>, password: passwordBuffer(ARA_PAROLASI) }));
    } catch (err) {
      araIptal = (err as Error).message;
    }
    kontrol("§1d ara imzacı iptal belgesi BASAMAZ (alt süreç YETKISIZ)", /YETKISIZ/.test(araIptal), araIptal.slice(0, 100));

    console.log("\n§2 defter (içe aktarma)");
    const s1Satir = satir(anahtarUret("alt-2024-1"), "ALT");
    const s1 = iptalBas(f.kok, iptalYuku(f, { sira: 1, iptaller: [s1Satir] }));
    const ekle = (token: string) => importRevocation({ token, anchor: ctx.keys.anchor, actor: YUKLEYEN }).then((r) => r.durum, (e: { status?: number; code?: string }) => `${e.status} ${e.code}`);
    kontrol("§2a ✓K geçerli belge EKLENDI; aynı belge tekrar VARDI", (await ekle(s1)) === "EKLENDI" && (await ekle(s1)) === "VARDI");
    const s1b = iptalBas(f.kok, iptalYuku(f, { sira: 1, iptaller: [s1Satir] }));
    kontrol("§2b aynı sıra BAŞKA belge → 409", (await ekle(s1b)) === "409 DURUM_CAKISMASI");
    const s3Satir = satir(anahtarUret("ind-2024-1"), "INDIRME");
    const s3 = iptalBas(f.kok, iptalYuku(f, { sira: 3, iptaller: [s1Satir, s3Satir] }));
    const s2 = iptalBas(f.kok, iptalYuku(f, { sira: 2, iptaller: [s1Satir, s3Satir] }));
    kontrol("§2c sıra atlayabilir (3 EKLENDI); sonra düşük sıra (2) → 409", (await ekle(s3)) === "EKLENDI" && (await ekle(s2)) === "409 DURUM_CAKISMASI");
    const s4Dusuren = iptalBas(f.kok, iptalYuku(f, { sira: 4, iptaller: [s3Satir] }));
    kontrol("§2d önceki satırı DÜŞÜREN belge → 409 (iptal sessizce geri alınamaz)", (await ekle(s4Dusuren)) === "409 DURUM_CAKISMASI");
    const yabanciKok = anahtarUret("kok-fikstur-1");
    const disKok = iptalBas(yabanciKok, iptalYuku(f, { sira: 9, iptaller: [s1Satir, s3Satir] }));
    const araImzali = hamImzala(TYP.IPTAL, f.ara, iptalYuku(f, { sira: 9, iptaller: [s1Satir, s3Satir] }) as unknown as Record<string, unknown>);
    const disKokSonuc = await ekle(disKok);
    const araSonuc = await ekle(araImzali);
    kontrol("§2e çapa dışı kökün ve ara imzacının belgesi → 400 (deftere girmez)", /^400 (JWS_IMZA|KOK_BILINMIYOR)$/.test(disKokSonuc) && araSonuc === "400 KOK_BILINMIYOR", `${disKokSonuc} / ${araSonuc}`);
    const satirS1 = await prisma.iptalBelgesi.findFirstOrThrow({ where: { sira: 1 } });
    let guncelleme = "GECTI";
    let silme = "GECTI";
    try {
      await prisma.iptalBelgesi.update({ where: { id: satirS1.id }, data: { yukleyen: "kurcalama" } });
    } catch (err) {
      guncelleme = (err as Error).message;
    }
    try {
      await prisma.iptalBelgesi.deleteMany({ where: { id: satirS1.id } });
    } catch (err) {
      silme = (err as Error).message;
    }
    kontrol("§2f defter satırı GÜNCELLENEMEZ ve (beyansız) SİLİNEMEZ — tetikleyici", /Defter satırı değiştirilemez/.test(guncelleme) && /Defter satırı değiştirilemez/.test(silme), `${guncelleme.slice(-80)} | ${silme.slice(-80)}`);

    console.log("\n§3 dağıtım kapısı");
    const once = await distributableRevocation(prisma, ctx.keys);
    kontrol("§3a engelsiz en yüksek sıra (3) dağıtılır, bekleyen yok", once.dagitilan?.sira === 3 && once.bekleyen === null, JSON.stringify({ d: once.dagitilan?.sira, b: once.bekleyen?.sira }));
    ctx.keys = KeyStore.load(ctx.config);
    const kH = await kurulumFiksturu(ctx);
    temizlenecek.push(kH.kurulumDbId);
    await runAsCli(() => hakSvc.issueEntitlementVersion(ctx, { entitlementId: kH.hakId, password: passwordBuffer(ARA_PAROLASI), capabilities: ["hak-ara"], reason: "ara imzalı HAK", actor: "bekci" }));
    const s5Satirlar = [s1Satir, s3Satir, { kid: f.ara.kid, sertifikaId: randomUUID(), kullanim: "HAK" as const, tarih: msToIso(Date.now()), neden: "ara imzacı ele geçti" }];
    const s5 = iptalBas(f.kok, iptalYuku(f, { sira: 5, iptaller: s5Satirlar }));
    kontrol("§3b' acil iptal belgesi (ara imzacı) deftere EKLENDI", (await ekle(s5)) === "EKLENDI");
    const bekliyor = await distributableRevocation(prisma, ctx.keys);
    const engeller = bekliyor.bekleyen?.engeller ?? [];
    kontrol("§3b HAK'ın güncel sürümünü imzalamış ve hâlâ yüklü ara imzacıyı iptal eden belge BEKLER: dağıtılan 3, bekleyen 5 (HAK + ANAHTAR engeli)",
      bekliyor.dagitilan?.sira === 3 && bekliyor.bekleyen?.sira === 5 && engeller.some((e) => e.tur === "HAK" && e.hakId === kH.hakId && e.kid === f.ara.kid) && engeller.some((e) => e.tur === "ANAHTAR" && e.kid === f.ara.kid),
      JSON.stringify(engeller));
    await runAsCli(() => hakSvc.issueEntitlementVersion(ctx, { entitlementId: kH.hakId, password: passwordBuffer(TEST_KOK_PAROLASI), capabilities: [], reason: "kökle yeniden basım", actor: "bekci" }));
    const yeniAra = anahtarUret("ara-2026-2");
    await araYaz(ortam.dizin, f, yeniAra, { baslangic: msToIso(Date.now() - DAY_MS) });
    ekKidler.push(yeniAra.kid);
    const kuru = cli(["emekliye-ayir", `--kid=${f.ara.kid}`, `--dizin=${ortam.dizin}`]);
    kontrol("§4a emekliye-ayir varsayılan KURU: yapılacağı listeler, dosya YERİNDE", kuru.status === 0 && /\[kuru\]/.test(kuru.stdout) && existsSync(ara.dosya), `${kuru.status} ${kuru.stderr.trim().slice(0, 120)}`);
    ctx.keys = KeyStore.load(ctx.config);
    const halaBekliyor = await distributableRevocation(prisma, ctx.keys);
    kontrol("§3c' HAK yeniden basıldı ama iptal edilen anahtar hâlâ YÜKLÜ → belge hâlâ bekler (yalnız ANAHTAR engeli)",
      halaBekliyor.dagitilan?.sira === 3 && (halaBekliyor.bekleyen?.engeller ?? []).every((e) => e.tur === "ANAHTAR") && (halaBekliyor.bekleyen?.engeller.length ?? 0) === 1,
      JSON.stringify(halaBekliyor.bekleyen));
    const yokYeni = cli(["emekliye-ayir", `--kid=${f.alt.kid}`, `--dizin=${ortam.dizin}`, "--uygula"]);
    kontrol("§4b aynı türde daha yeni anahtar yoksa RED (imza durmasın), dosya yerinde", yokYeni.status === 2 && /daha yeni anahtar yok/.test(yokYeni.stderr) && existsSync(altDosyasi), `${yokYeni.status} ${yokYeni.stderr.trim().slice(0, 120)}`);
    const uygula = cli(["emekliye-ayir", `--kid=${f.ara.kid}`, `--dizin=${ortam.dizin}`, "--uygula"]);
    const arsiv = path.join(ortam.dizin, `${f.ara.kid}.sertifika.json`);
    ctx.keys = KeyStore.load(ctx.config);
    kontrol("§4c ✓K --uygula: özel yarı SİLİNDİ, açık yarı + sertifika kaldı; depo onu EMEKLİ tanır, imzada yeni ara",
      uygula.status === 0 && !existsSync(ara.dosya) && existsSync(arsiv) && !readFileSync(arsiv, "utf8").includes('"d"') && ctx.keys.retired.some((k) => k.kid === f.ara.kid && k.kind === "ARA") && ctx.keys.intermediateFor("URETIM", Date.now())?.kid === yeniAra.kid,
      `${uygula.status} ${uygula.stderr.trim().slice(0, 120)}`);
    const tekrar = cli(["emekliye-ayir", `--kid=${f.ara.kid}`, `--dizin=${ortam.dizin}`, "--uygula"]);
    kontrol("§4d tekrar: 'zaten emekli' — atlandı (çıkış 0)", tekrar.status === 0 && /zaten emekli/.test(tekrar.stdout), `${tekrar.status}`);
    const dagitildi = await distributableRevocation(prisma, ctx.keys);
    kontrol("§3c ✓K HAK yeniden basıldı + anahtar emekliye ayrıldı → belge 5 DAĞITILIR, bekleyen yok", dagitildi.dagitilan?.sira === 5 && dagitildi.bekleyen === null, JSON.stringify({ d: dagitildi.dagitilan?.sira, b: dagitildi.bekleyen }));

    console.log("\n§5 donem-ice-aktar (konteyner CLI'ı)");
    const kQ = await kurulumFiksturu(ctx);
    temizlenecek.push(kQ.kurulumDbId);
    const { exportRootQueue } = await import("../src/services/root-queue.service");
    const koksuzDizin = path.join(tmp, "koksuz");
    mkdirSync(koksuzDizin, { mode: 0o700 });
    for (const ad of readdirSync(ortam.dizin).filter((n) => !n.endsWith(".kok.json"))) copyFileSync(path.join(ortam.dizin, ad), path.join(koksuzDizin, ad));
    const koksuz = KeyStore.load({ ...ctx.config, ANAHTAR_DIZINI: koksuzDizin });
    const talep = await runAsCli(() =>
      hakSvc.issueEntitlementVersion({ ...ctx, keys: koksuz }, { entitlementId: kQ.hakId, changes: { perpetual: false }, password: passwordBuffer("kullanilmaz-1"), reason: "kuyruk", actor: "bekci", allowQueue: true }),
    );
    writeFileSync(path.join(tmp, "kuyruk.json"), JSON.stringify(await exportRootQueue(prisma)));
    const imz = cli(["kuyruk-imzala", `--kok=${f.kok.kid}`, `--kok-dizin=${ortam.dizin}`, `--kuyruk=${path.join(tmp, "kuyruk.json")}`, `--cikti=${path.join(tmp, "imzali.json")}`], { input: `${TEST_KOK_PAROLASI}\n` });
    const imzali = imz.status === 0 ? (JSON.parse(readFileSync(path.join(tmp, "imzali.json"), "utf8")) as { haklar: unknown[] }) : { haklar: [] };
    const s6 = iptalBas(f.kok, iptalYuku(f, { sira: 6, iptaller: s5Satirlar }));
    const paket = path.join(tmp, "ice-aktar.json");
    writeFileSync(paket, JSON.stringify({ v: 1, tur: "tekserp-donem-ice-aktar", iptal: s6, haklar: imzali.haklar }));
    const ortamDegiskenleri = { DATABASE_URL: process.env.DATABASE_URL ?? "", ANAHTAR_DIZINI: ortam.dizin, GUVEN_CAPASI_DOSYASI: ortam.capaDosyasi };
    const ice = cli(["donem-ice-aktar", `--dosya=${paket}`], { env: ortamDegiskenleri });
    const tSatir = talep.mode === "QUEUED" ? await prisma.hakKokTalebi.findUniqueOrThrow({ where: { id: talep.row.id } }) : null;
    kontrol("§5a ice-aktar.json: iptal sıra 6 EKLENDI + kök imzalı HAK talebi IMZALANDI (çıkış 0)",
      ice.status === 0 && /iptal belgesi sıra 6: EKLENDI/.test(ice.stdout) && /IMZALANDI/.test(ice.stdout) && tSatir?.durum === "IMZALANDI" && (await prisma.iptalBelgesi.count({ where: { sira: 6 } })) === 1,
      `${ice.status} ${ice.stdout.trim().replace(/\n/g, " | ").slice(0, 200)} ${ice.stderr.trim().slice(0, 120)}`);
    const tekrarIce = cli(["donem-ice-aktar", `--dosya=${paket}`], { env: ortamDegiskenleri });
    kontrol("§5b aynı paketin tekrarı: VARDI + VARDI (çıkış 0)", tekrarIce.status === 0 && (tekrarIce.stdout.match(/VARDI/g) ?? []).length === 2, tekrarIce.stdout.trim().replace(/\n/g, " | "));
    writeFileSync(path.join(tmp, "bozuk.json"), JSON.stringify({ v: 1, tur: "baska-bir-sey" }));
    const bozuk = cli(["donem-ice-aktar", `--dosya=${path.join(tmp, "bozuk.json")}`], { env: ortamDegiskenleri });
    kontrol("§5c tanınmayan içe aktarma dosyası → çıkış 2", bozuk.status === 2 && /tanınmıyor/.test(bozuk.stderr), `${bozuk.status}`);
  } finally {
    await temizleKurulumlar(temizlenecek, [...ortam.kidler, ...ekKidler]);
    await temizleIptalBelgeleri(YUKLEYEN);
    await temizleIptalBelgeleri(CLI_YUKLEYEN);
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
