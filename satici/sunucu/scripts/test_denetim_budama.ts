// =============================================================================
// DENETİM BUDAMASI (yönetici kararı h): denetim DEFTER DEĞİL ayak izidir ve yaşa göre budanır —
// başarısız/reddedilen giriş satırları 90 gün, diğer her denetim satırı 2 yıl. İki sınıf TEK tx'te
// silinir; iş dakikalık bakımın içinde GÜNDE BİR koşar (açılışta bir kez). Budanan model
// `PRUNED_MODELS` beyanındadır (statik kapı test_satici_kapilari §4).
//   §1 sınıf × yaş matrisi (saat ENJEKTE): yalnız süresi geçen satır gider, sınır içi kalır
//   §2 günde bir: aynı gün ikinci koşum budamaz, 24 saat sonra budar
//   §3 hesap kilitlenmesi (PORTAL_HESAP_KILITLENDI) başarısız giriş sınıfında DEĞİL (2 yıl)
// ⭐ KALICI SONDA ✓K2 (her koşumda): (1) 89 günlük başarısız giriş ve 729 günlük olay KALIR (kör
//    silme yok) · (2) aynı gün kalan satır ertesi gün koşumunda gider (gün kapısı işi hiç durdurmuyor).
// Koşum: npx tsx scripts/test_denetim_budama.ts   (kendi `_test` DB'si)
// =============================================================================
import { randomUUID } from "node:crypto";
import { DAY_MS } from "../src/lisans-protokol";
import { anahtarOrtamiKur, hedefDbKapisi, kapat, kontrol, sonuc, temizleKurulumlar } from "./lib/test-ortam";

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now());
  const { prisma } = await import("../src/lib/prisma");
  const { AUDIT_FAILED_LOGIN_EVENTS, MaintenanceScheduler, PRUNED_MODELS, pruneAudit } = await import("../src/services/maintenance");
  const iz = `budama-${randomUUID()}`;
  const simdi = Date.now();
  const satir = async (olay: string, gun: number): Promise<string> =>
    (await prisma.denetim.create({ data: { olay, varlik: "Bekci", varlikId: iz, yapan: "bekci", createdAt: new Date(simdi - gun * DAY_MS) } })).id;
  const kalan = async (): Promise<Set<string>> => new Set((await prisma.denetim.findMany({ where: { varlikId: iz }, select: { id: true } })).map((r) => r.id));
  try {
    console.log("\n§0 beyan");
    kontrol("§0 denetim budanan modeller beyanında; başarısız giriş sınıfı iki olay", (PRUNED_MODELS as readonly string[]).includes("denetim") && AUDIT_FAILED_LOGIN_EVENTS.length === 2);

    console.log("\n§1 sınıf × yaş");
    const basarisiz91 = await satir("PORTAL_GIRIS_BASARISIZ", 91);
    const reddedildi91 = await satir("PORTAL_GIRIS_REDDEDILDI", 91);
    const basarisiz89 = await satir("PORTAL_GIRIS_BASARISIZ", 89);
    const olay731 = await satir("YAPTIRIM_K4", 731);
    const olay729 = await satir("YAPTIRIM_K4", 729);
    const giris400 = await satir("PORTAL_GIRIS", 400);
    const kilit400 = await satir("PORTAL_HESAP_KILITLENDI", 400);
    const r = await pruneAudit(simdi, { failedLoginKeepDays: 90, keepDays: 730 });
    const k1 = await kalan();
    kontrol("§1a 91 günlük başarısız ve reddedilen giriş SİLİNDİ", !k1.has(basarisiz91) && !k1.has(reddedildi91), `${r.failedLogins}/${r.other}`);
    kontrol("§1b ✓K 89 günlük başarısız giriş KALDI", k1.has(basarisiz89));
    kontrol("§1c 731 günlük olay SİLİNDİ; ✓K 729 günlük olay KALDI", !k1.has(olay731) && k1.has(olay729));
    kontrol("§1d başarılı giriş (400 gün) 2 yıl sınıfında — KALDI", k1.has(giris400));
    kontrol("§3 hesap kilitlenmesi (400 gün) başarısız giriş sınıfında DEĞİL — KALDI", k1.has(kilit400));

    console.log("\n§2 günde bir (bakım işi, saat ENJEKTE)");
    const is = new MaintenanceScheduler(ortam.ctx);
    await is.runOnce(simdi);
    const gec = await satir("PORTAL_GIRIS_BASARISIZ", 95);
    await is.runOnce(simdi + 3_600_000);
    kontrol("§2a aynı gün ikinci koşum budamaz (95 günlük satır duruyor)", (await kalan()).has(gec));
    await is.runOnce(simdi + DAY_MS + 60_000);
    kontrol("§2b ✓K 24 saat sonraki koşum budar", !(await kalan()).has(gec));
  } finally {
    await prisma.denetim.deleteMany({ where: { varlikId: iz } });
    await temizleKurulumlar([], ortam.kidler);
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
