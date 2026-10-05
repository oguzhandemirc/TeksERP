// =============================================================================
// K5 — DEMO LİSANSI BİTİŞSİZ KAYDEDİLEMEZ. Bitişi zorunlu sınıfın (`VALIDITY_END_REQUIRED_CLASSES`) hakkı
// geçerlilik bitişi olmadan hiçbir yoldan kaydedilmez — tek boğaz `requireValidityEnd`:
// §1 doğuş (portal POST /kurulumlar/:id/hak): bitişsiz → 400 GOVDE_GECERSIZ (TR ileti), satır YOK; bitişli → 201,
//    bitiş hakta ve GECERLILIK defter satırında (önceki yok → yeni) · servis yolu (CLI/bayi) da aynı boğazdan.
// §2 bitiş değişimi (POST /gecerlilik): süre sınırını kaldırmak (null) → 400, defter büyümez; tarih → 200.
// §3 kalıcıya çevirme (imza yükü `buildEntitlementPayload`, üç imzacının ortak boğazı) → 400, parola sorulmadan.
// §4 sınıf değişimi (PATCH /kurulumlar/:id): bitişsiz taslağı olan kurulum DEMO'ya çevrilemez; bitiş verilince olur.
// ⭐ KALICI SONDA ✓K5 (her koşumda): kapı sınıfa bağlıdır, kör değildir — URETIM hakkı bitişsiz doğar (201),
//    süre sınırı kaldırılabilir (200) ve kalıcıya çevrilebilir yükü kurulur.
// Koşum: npx tsx scripts/test_demo_bitis.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { DAY_MS } from "../src/lisans-protokol";
import {
  anahtarOrtamiKur,
  hedefDbKapisi,
  kanalFiksturu,
  kapat,
  kontrol,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
} from "./lib/test-ortam";

const KANAL = "bekci-kanal";

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000" });
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const svc = await import("../src/services/entitlement.service");
  const kullanicilar: string[] = [];
  const kurulumlar: string[] = [];
  const sunucu = await portalSunuculariKur(ctx);
  try {
    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    kullanicilar.push(yonetici.id);
    const cerez = (await portalGiris(sunucu.portal, "/portal/api", yonetici)).cerez!;
    await kanalFiksturu(KANAL);
    const musteri = await svc.createCustomer({ name: `Bekçi Demo ${randomUUID().slice(0, 8)}`, actor: "bekci" });
    const tesis = await svc.createSite({ customerId: musteri.id, name: "Merkez", actor: "bekci" });
    const kurulumAc = async (sinif: "DEMO" | "URETIM") => {
      const k = await svc.createInstallation({ siteId: tesis.id, licenseClass: sinif, channelCode: KANAL, actor: "bekci" });
      kurulumlar.push(k.id);
      return k.id;
    };
    const api = (yol: string, govde: Record<string, unknown>, yontem?: string) =>
      portalIstek(sunucu.portal, `/portal/api${yol}`, { cerez, yontem, govde: { clientToken: randomUUID(), ...govde } });
    const bakim = new Date(Date.now() + 365 * DAY_MS).toISOString();
    const bitis = new Date(Date.now() + 30 * DAY_MS).toISOString();
    const hakOf = (kurulumId: string) => prisma.hak.findFirst({ where: { kurulumId, aktif: true } });
    const defter = (kurulumId: string) => prisma.yaptirimEylemi.findMany({ where: { kurulumId, tur: "GECERLILIK" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

    console.log("\n§1 doğuş");
    const demo = await kurulumAc("DEMO");
    const bitissiz = await api(`/kurulumlar/${demo}/hak`, { kalici: false, bakimBitis: bakim });
    const ileti = String((bitissiz.json as { message?: unknown }).message ?? bitissiz.json.error ?? JSON.stringify(bitissiz.json));
    kontrol("§1a DEMO bitişsiz → 400 GOVDE_GECERSIZ, TR ileti", bitissiz.status === 400 && bitissiz.kod === "GOVDE_GECERSIZ" && /geçerlilik bitişi zorunlu/.test(ileti), `${bitissiz.status} ${bitissiz.kod} ${ileti}`);
    kontrol("§1b reddedilen istek hak satırı YAZMAZ", (await hakOf(demo)) === null);
    const kaliciBitissiz = await api(`/kurulumlar/${demo}/hak`, { kalici: true, bakimBitis: bakim });
    kontrol("§1c DEMO kalıcı + bitişsiz de → 400", kaliciBitissiz.status === 400 && kaliciBitissiz.kod === "GOVDE_GECERSIZ", `${kaliciBitissiz.status}`);
    let servisRed = "";
    try {
      await svc.createEntitlement({ installationDbId: demo, modules: ["production.enabled"], perpetual: false, maintenanceUntil: new Date(bakim), actor: "bekci" });
    } catch (e) {
      servisRed = (e as { code?: string }).code ?? String(e);
    }
    kontrol("§1d servis yolu (CLI · bayi aynı boğaz) bitişsiz DEMO → GOVDE_GECERSIZ", servisRed === "GOVDE_GECERSIZ", servisRed);
    const bitisli = await api(`/kurulumlar/${demo}/hak`, { kalici: false, bakimBitis: bakim, gecerlilikBitis: bitis });
    const demoHak = await hakOf(demo);
    kontrol("§1e DEMO bitişli → 201, bitiş hakta", bitisli.status === 201 && demoHak?.gecerlilikBitis?.toISOString() === bitis, `${bitisli.status} ${bitisli.kod ?? ""}`);
    const dogus = await defter(demo);
    kontrol(
      "§1f doğuştaki bitiş GECERLILIK defter satırıdır (önceki yok → yeni)",
      dogus.length === 1 && (dogus[0]!.parametre as { onceki?: unknown }).onceki === null && (dogus[0]!.parametre as { yeni?: unknown }).yeni === bitis,
      JSON.stringify(dogus.map((d) => d.parametre)),
    );

    console.log("\n§2 bitiş değişimi");
    const kaldir = await api(`/kurulumlar/${demo}/gecerlilik`, { tarih: null, sebep: "süresiz yap" });
    kontrol("§2a DEMO süre sınırını kaldırmak → 400 GOVDE_GECERSIZ", kaldir.status === 400 && kaldir.kod === "GOVDE_GECERSIZ", `${kaldir.status} ${kaldir.kod}`);
    kontrol("§2b reddedilen kaldırma deftere satır yazmaz, bitiş yerinde", (await defter(demo)).length === 1 && (await hakOf(demo))?.gecerlilikBitis?.toISOString() === bitis);
    const yeniBitis = new Date(Date.now() + 40 * DAY_MS).toISOString();
    const degistir = await api(`/kurulumlar/${demo}/gecerlilik`, { tarih: yeniBitis, sebep: "demo uzadı" });
    kontrol("§2c DEMO bitiş tarihini değiştirmek → 200", degistir.status === 200 && (await hakOf(demo))?.gecerlilikBitis?.toISOString() === yeniBitis, `${degistir.status}`);

    console.log("\n§3 kalıcıya çevirme");
    const agac = (id: string) => prisma.hak.findUniqueOrThrow({ where: { id }, include: { kurulum: { include: { tesis: { include: { musteri: true } } } } } });
    let kaliciRed = "";
    try {
      svc.buildEntitlementPayload(await agac(demoHak!.id), { perpetual: true }, Date.now(), { kind: "KOK" });
    } catch (e) {
      kaliciRed = `${(e as { code?: string }).code} ${(e as Error).message}`;
    }
    kontrol("§3a DEMO kalıcıya çevrilemez → GOVDE_GECERSIZ (imzadan önce)", kaliciRed.startsWith("GOVDE_GECERSIZ") && /kalıcıya çevrilemez/.test(kaliciRed), kaliciRed);

    console.log("\n§4 sınıf değişimi");
    const uretim = await kurulumAc("URETIM");
    const uretimHak = await api(`/kurulumlar/${uretim}/hak`, { kalici: false, bakimBitis: bakim });
    kontrol("§4a ✓K URETIM bitişsiz doğar → 201 (kapı sınıfa bağlı)", uretimHak.status === 201 && (await hakOf(uretim))?.gecerlilikBitis === null, `${uretimHak.status} ${uretimHak.kod ?? ""}`);
    const sinifDemo = await api(`/kurulumlar/${uretim}`, { sinif: "DEMO" }, "PATCH");
    const sinifSonra = await prisma.kurulum.findUniqueOrThrow({ where: { id: uretim }, select: { sinif: true } });
    kontrol("§4b bitişsiz taslaklı kurulum DEMO'ya çevrilemez → 400, sınıf yerinde", sinifDemo.status === 400 && sinifDemo.kod === "GOVDE_GECERSIZ" && sinifSonra.sinif === "URETIM", `${sinifDemo.status} ${sinifDemo.kod}`);
    const uretimKaldir = await api(`/kurulumlar/${uretim}/gecerlilik`, { tarih: bitis, sebep: "vadeli" });
    const sinifDemo2 = await api(`/kurulumlar/${uretim}`, { sinif: "DEMO" }, "PATCH");
    const sinifSonra2 = await prisma.kurulum.findUniqueOrThrow({ where: { id: uretim }, select: { sinif: true } });
    kontrol("§4c bitiş verilince DEMO'ya çevrilir → 200", uretimKaldir.status === 200 && sinifDemo2.status === 200 && sinifSonra2.sinif === "DEMO", `${uretimKaldir.status}/${sinifDemo2.status}`);

    console.log("\n§5 ✓K5 kapı kör değil (URETIM)");
    const uretim2 = await kurulumAc("URETIM");
    await api(`/kurulumlar/${uretim2}/hak`, { kalici: false, bakimBitis: bakim, gecerlilikBitis: bitis });
    const u2Kaldir = await api(`/kurulumlar/${uretim2}/gecerlilik`, { tarih: null, sebep: "peşin ödendi" });
    kontrol("§5a URETIM süre sınırı kaldırılır → 200, bitiş null", u2Kaldir.status === 200 && (await hakOf(uretim2))?.gecerlilikBitis === null, `${u2Kaldir.status} ${u2Kaldir.kod ?? ""}`);
    let uretimKalici = "";
    try {
      const yuk = svc.buildEntitlementPayload(await agac((await hakOf(uretim2))!.id), { perpetual: true }, Date.now(), { kind: "KOK" });
      uretimKalici = yuk.payload.kalici ? "kalici" : "vadeli";
    } catch (e) {
      uretimKalici = (e as Error).message;
    }
    kontrol("§5b URETIM kalıcıya çevirme yükü kurulur", uretimKalici === "kalici", uretimKalici);
  } finally {
    await sunucu.kapat();
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    await temizlePortal({ kullanicilar });
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
