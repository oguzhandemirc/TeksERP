// =============================================================================
// PLANLI EYLEM + TAKSİT — dakikalık iş, atomik claim (iki kez koşan iş ikinci kez uygulamaz).
// Planlı eylem: vadesi gelen BEKLIYOR → UYGULANDI + yaptırım defterinde satır (kaynağı bağlı);
// vadesi gelmeyen dokunulmaz; iptal edilen uygulanmaz; K4/K5 planlanamaz.
// Taksit: plan geçerlilik bitişini ilk vade + uzatma gününe koyar; vade + gecikme günü ödemesiz →
// GECIKTI + K3 (geri sayım); ödeme → ODENDI, K3 ters kayıtla kalkar, bitiş sonraki vadeye uzar;
// son taksit ödenince süre sınırı kalkar (null).
// ⭐ KALICI SONDA ✓K2 (her koşumda): iş ikinci kez koşunca 0 uygular (claim gerçek) · gecikme günü
//    dolmamış kalem K3 ALMAZ (eşik okunuyor).
// Koşum: npx tsx scripts/test_planli_eylem_taksit.ts
// =============================================================================
import { DAY_MS } from "../src/lisans-protokol";
import { anahtarOrtamiKur, hedefDbKapisi, kapat, kontrol, kurulumFiksturu, sonuc, temizleKurulumlar } from "./lib/test-ortam";

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const svc = await import("../src/services/sanction.service");
  const { computeSanctionState } = await import("../src/services/lease.service");
  const temizlenecek: string[] = [];
  try {
    const simdi = Date.now();
    console.log("\n§1 planlı eylem");
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const vadesi = await svc.schedulePlannedAction({ installationDbId: k.kurulumDbId, level: "K3", restrictionDays: 15, dueAt: new Date(simdi - 1_000), reason: "vade + 15 gün ödeme yok", actor: "bekci" });
    const gelecek = await svc.schedulePlannedAction({ installationDbId: k.kurulumDbId, level: "K1", dueAt: new Date(simdi + DAY_MS), reason: "bakım bitişi", actor: "bekci" });
    const iptal = await svc.schedulePlannedAction({ installationDbId: k.kurulumDbId, level: "K0", message: "x", dueAt: new Date(simdi - 1_000), reason: "vazgeçildi", actor: "bekci" });
    await svc.cancelPlannedAction({ id: iptal.id, actor: "bekci" });
    let k45 = "";
    try {
      await svc.schedulePlannedAction({ installationDbId: k.kurulumDbId, level: "K5", dueAt: new Date(simdi), reason: "x", actor: "bekci" });
    } catch (err) {
      k45 = String((err as { status?: number }).status);
    }
    kontrol("§1a K5 planlanamaz → 400", k45 === "400");
    // Çift zamanlayıcı: iki iş AYNI bayat aday satırını görür. Claim ikincisini boş geçirmeli.
    const bayat = await prisma.planliEylem.findUniqueOrThrow({ where: { id: vadesi.id } });
    const ilk = await svc.runDuePlannedActions(simdi);
    const ikinci = await svc.applyPlannedAction(bayat, simdi);
    const ucuncu = await svc.runDuePlannedActions(simdi);
    const uygulanan = await prisma.yaptirimEylemi.count({ where: { planliEylemId: vadesi.id } });
    kontrol("§1b ✓K bayat adayla ikinci uygulama claim'i kaybeder; eylem TEK kez; sonraki koşum 0", ilk === 1 && ikinci === false && ucuncu === 0 && uygulanan === 1, `${ilk}/${ikinci}/${ucuncu}`);
    const p1 = await prisma.planliEylem.findUniqueOrThrow({ where: { id: vadesi.id } });
    const p2 = await prisma.planliEylem.findUniqueOrThrow({ where: { id: gelecek.id } });
    const p3 = await prisma.planliEylem.findUniqueOrThrow({ where: { id: iptal.id } });
    kontrol("§1c durumlar: vadeli UYGULANDI · gelecek BEKLIYOR · iptal IPTAL", p1.durum === "UYGULANDI" && p2.durum === "BEKLIYOR" && p3.durum === "IPTAL");
    const eylem = await prisma.yaptirimEylemi.findFirst({ where: { planliEylemId: vadesi.id } });
    const durum = await computeSanctionState(prisma, k.kurulumDbId);
    const gun = durum.kisitlamaTarihi ? (Date.parse(durum.kisitlamaTarihi) - simdi) / DAY_MS : -1;
    kontrol("§1d defterde K3 (kaynağı planlı eylem), geri sayım uygulama anından 15 gün", eylem?.tur === "K3" && durum.kademe === "K3" && gun > 14.9 && gun < 15.1, gun.toFixed(2));

    console.log("\n§2 taksit");
    const t = await kurulumFiksturu(ctx);
    temizlenecek.push(t.kurulumDbId);
    const v1 = new Date(simdi - 20 * DAY_MS);
    const v2 = new Date(simdi - 10 * DAY_MS);
    const v3 = new Date(simdi + 30 * DAY_MS);
    const plan = await svc.createInstallmentPlan({
      installationDbId: t.kurulumDbId,
      description: "3 taksit",
      items: [
        { dueAt: v2, amount: "1000.00" },
        { dueAt: v1, amount: "1000.00" },
        { dueAt: v3, amount: "1000.00" },
      ],
      extendDays: 15,
      graceDays: 15,
      restrictionDays: 7,
      actor: "bekci",
    });
    const hak0 = await prisma.hak.findFirstOrThrow({ where: { kurulumId: t.kurulumDbId } });
    kontrol("§2a plan: geçerlilik bitişi = ilk vade + 15 gün (kalemler vadeye göre sıralı)", hak0.gecerlilikBitis?.getTime() === v1.getTime() + 15 * DAY_MS);
    const geciken = await svc.runOverdueInstallments(simdi);
    const kalemler = await prisma.taksitKalemi.findMany({ where: { planId: plan.id }, orderBy: { sira: "asc" } });
    kontrol("§2b vade + 15 gün geçen tek kalem GECIKTI + K3; ✓K gecikme günü dolmayan (10 gün) K3 ALMADI", geciken === 1 && kalemler[0]!.durum === "GECIKTI" && kalemler[1]!.durum === "BEKLIYOR" && kalemler[0]!.yaptirimEylemiId !== null, `${geciken} · ${kalemler.map((x) => x.durum).join(",")}`);
    const d1 = await computeSanctionState(prisma, t.kurulumDbId);
    kontrol("§2c kademe K3 + mesaj 'Taksit 1 ödenmedi'", d1.kademe === "K3" && d1.mesaj === "Taksit 1 ödenmedi");
    kontrol("§2d ✓K iş ikinci kez koşunca yeni K3 yok", (await svc.runOverdueInstallments(simdi)) === 0);
    await svc.recordInstallmentPayment({ itemId: kalemler[0]!.id, actor: "bekci", nowMs: simdi });
    const d2 = await computeSanctionState(prisma, t.kurulumDbId);
    const hak1 = await prisma.hak.findFirstOrThrow({ where: { kurulumId: t.kurulumDbId } });
    const ters = await prisma.yaptirimEylemi.findFirst({ where: { geriAlinanEylemId: kalemler[0]!.yaptirimEylemiId } });
    kontrol("§2e ödeme → K3 ters kayıtla kalktı, bitiş sonraki bekleyen vade + 15", d2.kademe === null && ters?.tur === "GERI_AL" && hak1.gecerlilikBitis?.getTime() === v2.getTime() + 15 * DAY_MS);
    await svc.recordInstallmentPayment({ itemId: kalemler[1]!.id, actor: "bekci", nowMs: simdi });
    await svc.recordInstallmentPayment({ itemId: kalemler[2]!.id, actor: "bekci", nowMs: simdi });
    const hak2 = await prisma.hak.findFirstOrThrow({ where: { kurulumId: t.kurulumDbId } });
    kontrol("§2f son taksit ödendi → süre sınırı kalktı (null)", hak2.gecerlilikBitis === null);
    let tekrarOdeme = "";
    try {
      await svc.recordInstallmentPayment({ itemId: kalemler[2]!.id, actor: "bekci" });
    } catch (err) {
      tekrarOdeme = String((err as { status?: number }).status);
    }
    kontrol("§2g aynı kalem ikinci kez ödenemez → 409", tekrarOdeme === "409");
    const gecerlilikSatirlari = await prisma.yaptirimEylemi.count({ where: { kurulumId: t.kurulumDbId, tur: "GECERLILIK" } });
    kontrol("§2h her bitiş değişimi defterde (plan + 3 ödeme = 4 GECERLILIK)", gecerlilikSatirlari === 4, `${gecerlilikSatirlari}`);
  } finally {
    await temizleKurulumlar(temizlenecek, ortam.kidler);
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
