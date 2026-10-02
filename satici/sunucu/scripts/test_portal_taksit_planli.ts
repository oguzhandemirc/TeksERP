// =============================================================================
// PORTAL — TAKSİT OTOMATİK UZATMA + PLANLI EYLEM VADESİ (ENJEKTE SAAT).
// Taksit planı geçerlilik bitişini ilk vade + uzatma gününe koyar; ÖDEME ONAYI bitişi kendiliğinden
// bir sonraki bekleyen vadeye (+ uzatma) taşır, son ödemede süre sınırı kalkar; vade + gecikme
// günü ödemesiz → dakikalık iş K3 uygular, ödeme K3'ü ters kayıtla kaldırır; plan kapanınca
// bekleyen kalemler iptal (iş dokunmaz). Planlı eylem vadesinden ÖNCE uygulanmaz, vadesinde
// dakikalık işte (MaintenanceScheduler.runOnce, saat ENJEKTE) bir kez uygulanır; iptal edilen hiç.
// Eylemler portal API'sinden (işlem kimliğiyle), iş aynı süreçte enjekte saatle koşar.
// Lisans v2 (§1g): kurulum künyesinin ödenmiş tarihi (P) taksit planında İLK vade, ödeme onayında SIRADAKİ vade, son
// ödemede süresiz — fabrikaya giden kirayla aynı kaynaktan (`paid-through.ts`).
// ⭐ KALICI SONDA ✓K3 (her koşumda): (1) vadeden 1 sn ÖNCE iş 0 uygular, 1 sn SONRA 1 — eşik
//    gerçekten vadede · (2) aynı işlem kimliğiyle tekrar ödeme bitişi İKİNCİ kez kaydırmaz ·
//    (3) gecikme günü dolmadan K3 yok, dolunca var.
// Koşum: npx tsx scripts/test_portal_taksit_planli.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { DAY_MS } from "../src/lisans-protokol";
import {
  anahtarOrtamiKur,
  hedefDbKapisi,
  kapat,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
} from "./lib/test-ortam";

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000" });
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { computeSanctionState } = await import("../src/services/lease.service");
  const { MaintenanceScheduler } = await import("../src/services/maintenance");
  const kullanicilar: string[] = [];
  const kurulumlar: string[] = [];
  const sunucu = await portalSunuculariKur(ctx);
  const is = new MaintenanceScheduler(ctx);
  try {
    const yonetici = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(yonetici.id);
    const cerez = (await portalGiris(sunucu.tailnet, "/portal/api", yonetici)).cerez!;
    const api = (yol: string, govde?: unknown) => portalIstek(sunucu.tailnet, `/portal/api${yol}`, { cerez, govde });
    const bitis = async (kurulumDbId: string) => (await prisma.hak.findFirstOrThrow({ where: { kurulumId: kurulumDbId, aktif: true } })).gecerlilikBitis?.getTime() ?? null;
    const simdi = Date.now();

    console.log("\n§1 taksit: ödeme onayı → otomatik uzatma");
    const a = await kurulumFiksturu(ctx);
    kurulumlar.push(a.kurulumDbId);
    const v1 = simdi + 10 * DAY_MS;
    const v2 = simdi + 40 * DAY_MS;
    const plan = await api(`/kurulumlar/${a.kurulumDbId}/taksit-plani`, {
      clientToken: randomUUID(),
      aciklama: "2 taksit",
      kalemler: [
        { vade: new Date(v2).toISOString(), tutar: "5000.00" },
        { vade: new Date(v1).toISOString(), tutar: "5000.00" },
      ],
      uzatmaGun: 15,
    });
    kontrol("§1a plan → 201; bitiş = İLK vade + 15 gün", plan.status === 201 && (await bitis(a.kurulumDbId)) === v1 + 15 * DAY_MS, `${plan.status} ${plan.kod ?? ""}`);
    const pGor = async (kurulumDbId: string) => {
      const p = (await api(`/kurulumlar/${kurulumDbId}`)).veri.odenmisTarih as { tarih: string | null; tur: string } | null;
      return p ? `${p.tur}:${p.tarih ?? "-"}` : "yok";
    };
    const pPlan = await pGor(a.kurulumDbId);
    const kalemler = (plan.veri.kalemler as { id: string; sira: number }[]).sort((x, y) => x.sira - y.sira);
    const odeme1 = { clientToken: randomUUID() };
    const o1 = await api(`/taksit-kalemleri/${kalemler[0]!.id}/odeme`, odeme1);
    kontrol("§1b 1. ödeme → bitiş KENDİLİĞİNDEN 2. vade + 15 gün", o1.status === 200 && (await bitis(a.kurulumDbId)) === v2 + 15 * DAY_MS, `${o1.status} ${o1.kod ?? ""}`);
    kontrol("§1b2 ödeme onayında künyedeki P KENDİLİĞİNDEN 2. vadeye ilerledi", (await pGor(a.kurulumDbId)) === `TAKSIT:${new Date(v2).toISOString()}`, await pGor(a.kurulumDbId));
    const gecerlilikSayisi = () => prisma.yaptirimEylemi.count({ where: { kurulumId: a.kurulumDbId, tur: "GECERLILIK" } });
    const once = await gecerlilikSayisi();
    const o1Tekrar = await api(`/taksit-kalemleri/${kalemler[0]!.id}/odeme`, odeme1);
    kontrol("§1c ✓K aynı işlem kimliğiyle tekrar → aynı yanıt, bitiş İKİNCİ kez kaymaz", o1Tekrar.status === 200 && o1Tekrar.basliklar.get("idempotent-replay") === "true" && (await gecerlilikSayisi()) === once && (await bitis(a.kurulumDbId)) === v2 + 15 * DAY_MS);
    const o1Yeni = await api(`/taksit-kalemleri/${kalemler[0]!.id}/odeme`, { clientToken: randomUUID() });
    kontrol("§1d aynı kalem YENİ kimlikle ikinci kez ödenemez → 409", o1Yeni.status === 409 && o1Yeni.kod === "DURUM_CAKISMASI", `${o1Yeni.status} ${o1Yeni.kod}`);
    await api(`/taksit-kalemleri/${kalemler[1]!.id}/odeme`, { clientToken: randomUUID() });
    kontrol("§1e son ödeme → süre sınırı kalkar (null)", (await bitis(a.kurulumDbId)) === null);
    kontrol("§1f her bitiş değişimi defterde (plan + 2 ödeme = 3 GECERLILIK)", (await gecerlilikSayisi()) === 3);
    kontrol(
      "§1g künyede P: planla İLK vade (TAKSIT), son ödemeden sonra süresiz",
      pPlan === `TAKSIT:${new Date(v1).toISOString()}` && (await pGor(a.kurulumDbId)) === "SURESIZ:-",
      `${pPlan} → ${await pGor(a.kurulumDbId)}`,
    );

    console.log("\n§2 taksit: gecikme → K3 (enjekte saat) → ödeme K3'ü kaldırır");
    const b = await kurulumFiksturu(ctx);
    kurulumlar.push(b.kurulumDbId);
    const vade = simdi + 5 * DAY_MS;
    const plan2 = await api(`/kurulumlar/${b.kurulumDbId}/taksit-plani`, {
      clientToken: randomUUID(),
      aciklama: "tek taksit",
      kalemler: [{ vade: new Date(vade).toISOString(), tutar: "1200.50" }],
      uzatmaGun: 10,
      gecikmeGun: 15,
      kisitlamaGun: 7,
    });
    const kalem2 = (plan2.veri.kalemler as { id: string }[])[0]!;
    await is.runOnce(vade + 14 * DAY_MS);
    const d0 = await computeSanctionState(prisma, b.kurulumDbId);
    kontrol("§2a ✓K vade + 14 gün (gecikme 15) → K3 YOK", d0.kademe === null);
    const an = vade + 15 * DAY_MS + 60_000;
    await is.runOnce(an);
    const d1 = await computeSanctionState(prisma, b.kurulumDbId);
    const k3Gun = d1.kisitlamaTarihi ? (Date.parse(d1.kisitlamaTarihi) - an) / DAY_MS : -1;
    const kalem2Satir = await prisma.taksitKalemi.findUniqueOrThrow({ where: { id: kalem2.id } });
    kontrol("§2b vade + 15 gün + 1 dk → K3, geri sayım ENJEKTE andan 7 gün, kalem GECIKTI", d1.kademe === "K3" && Math.abs(k3Gun - 7) < 0.001 && kalem2Satir.durum === "GECIKTI", `${d1.kademe} ${k3Gun.toFixed(3)} ${kalem2Satir.durum}`);
    await is.runOnce(an + 60_000);
    kontrol("§2c iş ikinci kez koşunca yeni K3 yok", (await prisma.yaptirimEylemi.count({ where: { kurulumId: b.kurulumDbId, tur: "K3" } })) === 1);
    const o2 = await api(`/taksit-kalemleri/${kalem2.id}/odeme`, { clientToken: randomUUID() });
    const d2 = await computeSanctionState(prisma, b.kurulumDbId);
    kontrol("§2d geciken ödeme → K3 ters kayıtla kalktı + süre sınırı kalktı", o2.status === 200 && d2.kademe === null && o2.veri.kaldirilanK3 !== null && (await bitis(b.kurulumDbId)) === null, `${o2.status} ${o2.kod ?? ""}`);

    console.log("\n§3 plan kapatma");
    const c = await kurulumFiksturu(ctx);
    kurulumlar.push(c.kurulumDbId);
    const plan3 = await api(`/kurulumlar/${c.kurulumDbId}/taksit-plani`, {
      clientToken: randomUUID(),
      aciklama: "kapatılacak",
      kalemler: [{ vade: new Date(simdi + DAY_MS).toISOString(), tutar: "10" }],
      gecikmeGun: 0,
    });
    const kapat3 = await api(`/taksit-planlari/${plan3.veri.id as string}/kapat`, { clientToken: randomUUID(), sebep: "peşin ödendi" });
    await is.runOnce(simdi + 3 * DAY_MS);
    const kalem3 = await prisma.taksitKalemi.findFirstOrThrow({ where: { planId: plan3.veri.id as string } });
    kontrol("§3 kapatılan planın bekleyen kalemi IPTAL; iş K3 uygulamaz", kapat3.status === 200 && kalem3.durum === "IPTAL" && (await computeSanctionState(prisma, c.kurulumDbId)).kademe === null, `${kapat3.status} ${kalem3.durum}`);

    console.log("\n§4 planlı eylem vadesi (enjekte saat)");
    const d = await kurulumFiksturu(ctx);
    kurulumlar.push(d.kurulumDbId);
    const planliVade = simdi + 3 * DAY_MS;
    const planli = await api(`/kurulumlar/${d.kurulumDbId}/planli-eylem`, {
      clientToken: randomUUID(),
      kademe: "K3",
      vade: new Date(planliVade).toISOString(),
      kisitlamaGun: 15,
      mesaj: "Vade + 15 gün ödeme yok",
      sebep: "vade + 15'te K3",
    });
    const iptalEdilecek = await api(`/kurulumlar/${d.kurulumDbId}/planli-eylem`, { clientToken: randomUUID(), kademe: "K1", vade: new Date(planliVade).toISOString(), sebep: "bakım" });
    const iptal = await api(`/planli-eylemler/${iptalEdilecek.veri.id as string}/iptal`, { clientToken: randomUUID(), sebep: "bakım yenilendi" });
    const iptalSatir = await prisma.planliEylem.findUniqueOrThrow({ where: { id: iptalEdilecek.veri.id as string } });
    kontrol("§4a planlama → 201 BEKLIYOR; iptal → IPTAL + kim/neden", planli.status === 201 && planli.veri.durum === "BEKLIYOR" && iptal.status === 200 && iptalSatir.durum === "IPTAL" && iptalSatir.iptalEden === `satici:${yonetici.kullaniciAdi}` && iptalSatir.iptalSebebi === "bakım yenilendi");
    const planliK4 = await api(`/kurulumlar/${d.kurulumDbId}/planli-eylem`, { clientToken: randomUUID(), kademe: "K4", vade: new Date(planliVade).toISOString(), sebep: "x" });
    kontrol("§4b K4 planlanamaz → 400", planliK4.status === 400, `${planliK4.status}`);
    const uygulanan = () => prisma.yaptirimEylemi.count({ where: { kurulumId: d.kurulumDbId, planliEylemId: { not: null } } });
    await is.runOnce(simdi);
    await is.runOnce(planliVade - 1000);
    kontrol("§4c ✓K şimdi ve vadeden 1 sn ÖNCE → 0 uygulama", (await uygulanan()) === 0);
    const vadeAni = planliVade + 1000;
    await is.runOnce(vadeAni);
    const satir = await prisma.planliEylem.findUniqueOrThrow({ where: { id: planli.veri.id as string } });
    const durum = await computeSanctionState(prisma, d.kurulumDbId);
    const gun = durum.kisitlamaTarihi ? (Date.parse(durum.kisitlamaTarihi) - vadeAni) / DAY_MS : -1;
    kontrol(
      "§4d ✓K vadeden 1 sn SONRA → tek K3 (kaynağı planlı eylem), geri sayım UYGULAMA anından 15 gün",
      (await uygulanan()) === 1 && satir.durum === "UYGULANDI" && satir.uygulamaZamani?.getTime() === vadeAni && durum.kademe === "K3" && Math.abs(gun - 15) < 0.001,
      `${satir.durum} ${gun.toFixed(3)}`,
    );
    await is.runOnce(vadeAni + DAY_MS);
    kontrol("§4e sonraki koşum yeniden uygulamaz; iptal edilen hiç uygulanmadı", (await uygulanan()) === 1 && (await prisma.yaptirimEylemi.count({ where: { planliEylemId: iptalEdilecek.veri.id as string } })) === 0);
    const tekrarIptal = await api(`/planli-eylemler/${planli.veri.id as string}/iptal`, { clientToken: randomUUID(), sebep: "geç kalındı" });
    kontrol("§4f uygulanmış eylem iptal edilemez → 409 (geri alma ayrı: ters kayıt)", tekrarIptal.status === 409, `${tekrarIptal.status}`);
  } finally {
    is.stop();
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
