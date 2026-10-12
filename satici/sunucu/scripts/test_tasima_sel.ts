// =============================================================================
// TAŞIMA SELİ (Bölge 7 B1/B1k) — kimliksiz taşıma kuyruğu KALIR ama doğum tavanlıdır; sahte talep gerçek
// taşımayı yalnız portal iptaline dek tutar; yabancı anahtara kurulum DURUMU söylenmez.
// §1 tek cevap: yok · etkinleşmemiş · iptal · ETKİN kimliğe yabancı anahtar → hepsi 200 BEKLIYOR, aynı biçim
//    (yalnız ETKİN olan bağlanır; gerisi bağsız + hedefKimlik).
// §2 hedef başına TEK bekleyen: ikinci anahtar → 409 TASIMA_ONAYI_BEKLIYOR + bekleyen talebin künyesi, dört hedefte aynı.
// §3 portal iptali (red) → gerçek yeni makine talep açar. §4 bildirim talep değil hedef × saat başına birleşir.
// §5 bağsız bekleyen tavanı → 429 HIZ_SINIRI + TASIMA_SELI denetimi; ✓K sel sırasında ETKİN kurulumun gerçek
//    taşıması açılır; var olan talebin yoklaması tavana takılmaz; hedef dakikalık tavanı 429.
// §6 bellek içi sayaçlar (hedef günlük · adres günlük) doğrudan.
// Koşum: npx tsx scripts/test_tasima_sel.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { ENDPOINTS } from "../src/lisans-protokol";
import { kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  ORTAM_TASIMA,
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleBagsizTalepler,
  temizleKurulumlar,
  type Yanit,
} from "./lib/test-ortam";

const CAPS = { TASIMA_HEDEF_DK: "3", TASIMA_HEDEF_GUN: "100", TASIMA_IP_GUN: "1000", TASIMA_BAGSIZ_AZAMI: "5" };

const sekil = (y: Yanit): string => `${y.status}|${Object.keys(y.json).sort().join(",")}|${String(y.json.durum)}|${String(y.json.lisans)}`;
const detay = (y: Yanit): Record<string, unknown> => (y.json.details ?? {}) as Record<string, unknown>;

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now(), CAPS);
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { rejectTransfer } = await import("../src/services/transfer.service");
  const { cancelInstallation } = await import("../src/services/installation-admin.service");
  const { createTransferFloodGuard } = await import("../src/services/transfer-flood");
  const sunucu = await sunucuBaslat(ortam, CAPS);
  const baslangic = new Date();
  const kurulumlar: string[] = [];
  const anahtarlar: string[] = [];
  const etkinKidler: string[] = [];

  const yeniAnahtar = (): TestAnahtari => {
    const a = kurulumAnahtariUret();
    anahtarlar.push(a.kid);
    return a;
  };
  const tasi = (kurulumId: string | null, anahtar: TestAnahtari) =>
    imzaliPost(sunucu.genel, ENDPOINTS.TRANSFER, {
      kurulumId,
      amac: "tasima",
      anahtar,
      govde: { v: 1, ...(kurulumId === null ? {} : { kurulumId }), acikAnahtar: anahtar.x, parmakIzi: f.parmakIzi, ortam: ORTAM_TASIMA, gerekce: "sunucu değişti" },
    });
  const etkinFikstur = async () => {
    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    const y = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }),
    });
    if (y.status !== 200) throw new Error(`etkinleştirme ${y.status} ${y.kod}`);
    etkinKidler.push(anahtar.kid);
    return k;
  };

  try {
    console.log("\n§1 tek cevap — kurulum durumu yabancı anahtara sızmaz");
    const etkin = await etkinFikstur();
    const etkinlesmemis = await kurulumFiksturu(ctx);
    kurulumlar.push(etkinlesmemis.kurulumDbId);
    const iptal = await etkinFikstur();
    await cancelInstallation({ installationDbId: iptal.kurulumDbId, reason: "sel sondası", actor: "bekci" });
    const hedefler = { yok: randomUUID(), etkinlesmemis: etkinlesmemis.kurulumId, iptal: iptal.kurulumId, etkin: etkin.kurulumId };
    const ilk: Record<string, Yanit> = {};
    for (const [ad, hedef] of Object.entries(hedefler)) ilk[ad] = await tasi(hedef, yeniAnahtar());
    const sekiller = new Set(Object.values(ilk).map(sekil));
    kontrol("§1a dört hedef (yok · etkinleşmemiş · iptal · ETKİN) → 200 BEKLIYOR, AYNI biçim", sekiller.size === 1 && ilk.etkin!.status === 200 && ilk.etkin!.json.durum === "BEKLIYOR", [...sekiller].join(" ‖ "));
    const satirlar = await prisma.tasimaTalebi.findMany({ where: { id: { in: Object.values(ilk).map((y) => String(y.json.talepId)) } } });
    const satir = (ad: string) => satirlar.find((t) => t.id === ilk[ad]!.json.talepId);
    kontrol(
      "§1b yalnız ETKİN olan bağlanır; diğerleri bağsız + hedefKimlik",
      satir("etkin")?.kurulumId === etkin.kurulumDbId && ["yok", "etkinlesmemis", "iptal"].every((ad) => satir(ad)?.kurulumId === null && satir(ad)?.hedefKimlik === hedefler[ad as keyof typeof hedefler]),
      satirlar.map((t) => `${t.kurulumId ?? "∅"}/${t.hedefKimlik ?? "∅"}`).join(" "),
    );

    console.log("\n§2 hedef başına TEK bekleyen talep");
    const ikinci: Record<string, Yanit> = {};
    for (const [ad, hedef] of Object.entries(hedefler)) ikinci[ad] = await tasi(hedef, yeniAnahtar());
    const hepsi409 = Object.entries(ikinci).every(([ad, y]) => y.status === 409 && y.kod === "TASIMA_ONAYI_BEKLIYOR" && detay(y).bekleyenTalepId === ilk[ad]!.json.talepId);
    kontrol("§2a ikinci anahtar → 409 TASIMA_ONAYI_BEKLIYOR + bekleyen talebin künyesi (dört hedefte)", hepsi409, Object.values(ikinci).map((y) => `${y.status} ${y.kod}`).join(" "));
    kontrol("§2b 409 iletisi dört hedefte AYNI ve iptal yolunu söyler", new Set(Object.values(ikinci).map((y) => y.json.message)).size === 1 && /portalda iptal/.test(String(ikinci.etkin!.json.message)));
    const ayniAnahtar = await tasi(etkin.kurulumId, { ...yeniAnahtar() });
    kontrol("§2c (yeni anahtar) hâlâ 409 — talep doğmadı", ayniAnahtar.status === 409 && (await prisma.tasimaTalebi.count({ where: { hedefKimlik: etkin.kurulumId } })) === 1);

    console.log("\n§3 portal iptali → gerçek yeni makine talep açar");
    await rejectTransfer(ctx, { talepId: String(ilk.etkin!.json.talepId), actor: "bekci", reason: "tanınmayan makine" });
    const gercek = await tasi(etkin.kurulumId, yeniAnahtar());
    kontrol("§3a sahte talep reddedildi → gerçek makinenin talebi 200 BEKLIYOR (bağlı)", gercek.status === 200 && gercek.json.durum === "BEKLIYOR", `${gercek.status} ${gercek.kod ?? ""}`);

    console.log("\n§4 bildirim hedef × saat başına birleşir");
    const bildirimAnahtarlari = await prisma.bildirim.findMany({ where: { olay: "TASIMA_TALEBI", kurulumId: etkin.kurulumDbId }, select: { tekillikAnahtari: true } });
    kontrol("§4a aynı kurulumda iki talep → TEK bildirim anahtarı", new Set(bildirimAnahtarlari.map((b) => b.tekillikAnahtari)).size === 1, `${bildirimAnahtarlari.length} satır`);

    console.log("\n§5 doğum tavanları");
    const bagsizOnce = await prisma.tasimaTalebi.count({ where: { kurulumId: null, durum: "BEKLIYOR" } });
    const kimliksiz: Yanit[] = [];
    let ilkKimliksiz: TestAnahtari | null = null;
    for (let i = bagsizOnce; i < Number(CAPS.TASIMA_BAGSIZ_AZAMI); i++) {
      const a = yeniAnahtar();
      ilkKimliksiz ??= a;
      kimliksiz.push(await tasi(null, a));
    }
    kontrol("§5a tavana dek kimliksiz talep 200 (kuyruk KALIR)", kimliksiz.every((y) => y.status === 200), kimliksiz.map((y) => y.status).join(","));
    const tasan = await tasi(null, yeniAnahtar());
    const bagsizSonra = await prisma.tasimaTalebi.count({ where: { kurulumId: null, durum: "BEKLIYOR" } });
    kontrol("§5b bağsız bekleyen tavanı → 429 HIZ_SINIRI, talep DOĞMAZ", tasan.status === 429 && tasan.kod === "HIZ_SINIRI" && bagsizSonra === Number(CAPS.TASIMA_BAGSIZ_AZAMI), `${tasan.status} ${tasan.kod} ${bagsizSonra}`);
    const tekrar = ilkKimliksiz ? await tasi(null, ilkKimliksiz) : null;
    kontrol("§5c var olan talebin yoklaması tavana takılmaz (200, aynı talep)", tekrar?.status === 200 && tekrar.json.talepId === kimliksiz[0]?.json.talepId);
    await rejectTransfer(ctx, { talepId: String(gercek.json.talepId), actor: "bekci", reason: "yeniden deneme" });
    const selde = await tasi(etkin.kurulumId, yeniAnahtar());
    kontrol("§5d ✓K sel sırasında ETKİN kurulumun taşıması açılır (bağlı talep bağsız tavanına girmez)", selde.status === 200 && selde.json.durum === "BEKLIYOR", `${selde.status} ${selde.kod ?? ""}`);
    await rejectTransfer(ctx, { talepId: String(selde.json.talepId), actor: "bekci", reason: "dakika tavanı sondası" });
    const dakika = await tasi(etkin.kurulumId, yeniAnahtar());
    kontrol("§5e hedef dakikalık tavanı aşılınca 429 HIZ_SINIRI", dakika.status === 429 && dakika.kod === "HIZ_SINIRI", `${dakika.status} ${dakika.kod ?? ""}`);
    await new Promise((r) => setTimeout(r, 300));
    const sel = await prisma.denetim.findMany({ where: { olay: "TASIMA_SELI", createdAt: { gte: baslangic } } });
    const tavanlar = sel.map((d) => (d.ozet as { tavan?: string }).tavan).sort();
    kontrol("§5f tavan aşımı güvenlik olayı: kapsam başına TEK TASIMA_SELI denetimi (adres yok)", tavanlar.join(",") === "BAGSIZ_AZAMI,HEDEF_DK" && !JSON.stringify(sel).includes("127.0.0.1"), tavanlar.join(","));

    console.log("\n§6 bellek içi sayaçlar");
    const sahteTx = { tasimaTalebi: { count: async () => 0 } } as unknown as Parameters<ReturnType<typeof createTransferFloodGuard>["admit"]>[0];
    const g = createTransferFloodGuard({ TASIMA_HEDEF_DK: 100, TASIMA_HEDEF_GUN: 2, TASIMA_IP_GUN: 3, TASIMA_BAGSIZ_AZAMI: 100 });
    const dene = async (hedef: string | null, ip: string, nowMs: number) => g.admit(sahteTx, { hedef, bound: false, ip, nowMs }).then(() => 200, (e: { status?: number }) => e.status ?? 0);
    const t0 = Date.now();
    const gunluk = [await dene("h1", "a", t0), await dene("h1", "b", t0 + 120_000), await dene("h1", "c", t0 + 240_000)];
    kontrol("§6a hedef günlük tavanı (dakika aralıklı) → üçüncü 429", gunluk.join(",") === "200,200,429", gunluk.join(","));
    const ipGun = [await dene(null, "x", t0), await dene(null, "x", t0 + 1), await dene(null, "x", t0 + 2), await dene(null, "x", t0 + 3)];
    kontrol("§6b adres günlük tavanı → dördüncü 429; ertesi gün sıfırlanır", ipGun.join(",") === "200,200,200,429" && (await dene(null, "x", t0 + 86_400_001)) === 200, ipGun.join(","));
  } finally {
    await sunucu.durdur();
    await temizleKurulumlar([...new Set(kurulumlar)], [...ortam.kidler, ...etkinKidler]);
    await temizleBagsizTalepler(anahtarlar);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL satici.defter_temizlik = 'test'`);
      await tx.denetim.deleteMany({ where: { olay: "TASIMA_SELI", createdAt: { gte: baslangic } } });
    });
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
