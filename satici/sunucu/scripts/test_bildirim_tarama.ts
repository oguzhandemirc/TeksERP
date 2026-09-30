// =============================================================================
// ZAMANA BAĞLI BİLDİRİMLER — satıcının bakım işindeki tarama giden kutusuna yazar (gönderim yan konteynerde).
//   §1 kurulum ses vermiyor: eşikten eski son BAŞARILI yoklama → kanal başına satır (etiketler + son yoklama
//      anı); ikinci tur yeni satır DOĞURMAZ; kurulum yoklayınca susar, yeni sessizlik dönemi YENİ satır
//   §2 TOCTOU: aday okunduktan sonra kurulum kilidi altında yoklayan kurulum "sessiz" bildirimi ALMAZ
//      (tarama kilitte bekler, taze okur)
//   §3 sınıf süzmesi: varsayılan dışı sınıf (DEMO) susar; listeye eklenince yazılır
//   §4 kira bitişi yaklaşıyor (kira başına bir kez) · lisans geçerlilik bitişi yaklaşıyor (bitiş değişince YENİ
//      dönem) · taksit vadesi yaklaşıyor (ufuk dışı kalem susar)
//   §5 aday yalıtımı: bir adayın yazımı düşerse (tetikleyici) diğer aday yine yazılır, tarama düşmez
//   §6 bakım işi taramayı `BILDIRIM_TARAMA_DK`da bir koşar (arada yeni sessizlik bekler)
// ⭐ KALICI SONDA ✓K (her koşumda): §2 tarama gerçekten kilitte BEKLEDİ (süre ölçülür) — beklemeden geçen tarama
//    TOCTOU'yu ölçmüş sayılmaz · §3 aynı DEMO kurulum sınıf listeye girince YAZILIR (süzme kör değil).
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı): S1 kilit altında yeniden doğrulama yok → §2b ❌ ·
//   S2 anahtar dönemsiz (yalnız kurulum) → §1d/§5a/§6b ❌ · S3 sınıf süzmesi yok → §3a ❌ · S4 aday hatası taramayı
//   düşürür → §5a ❌ · S5 bakım aralığı yok → §6b ❌.
// Koşum: npx tsx scripts/test_bildirim_tarama.ts   (yalnız *_test DB)
// =============================================================================
import { ENDPOINTS } from "../src/lisans-protokol";
import { kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kiraIdOf,
  kontrol,
  kurulumFiksturu,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  yoklamaGovdesi,
  type KurulumFiksturu,
} from "./lib/test-ortam";

type Prisma = (typeof import("../src/lib/prisma"))["prisma"];
const HOUR = 3_600_000;
const DAY = 86_400_000;
const CFG = { silentHours: 24, dueDays: 7, silentClasses: ["URETIM", "DR", "BARINDIRILAN"] as ("URETIM" | "DR" | "BARINDIRILAN" | "DEMO")[] };

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { scanTimedNotifications } = await import("../src/notifications/scanner");
  const { lockInstallation } = await import("../src/lib/locks");
  const s = await import("../src/services/sanction.service");
  const sunucu = await portalSunuculariKur(ctx);
  const kurulumlar: string[] = [];
  const etkin = async (k: KurulumFiksturu, anahtar: TestAnahtari) => {
    kurulumlar.push(k.kurulumDbId);
    const y = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar, govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }) });
    if (y.status !== 200) throw new Error(`etkinleştirme ${y.status} ${y.kod ?? ""}`);
    const p = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: yoklamaGovdesi({ sonKiraId: kiraIdOf(y.json), parmakIzi: f.parmakIzi }) });
    if (p.status !== 200) throw new Error(`yoklama ${p.status}`);
    return kiraIdOf(p.json);
  };
  const say = (olay: string, kurulumId: string) => prisma.bildirim.count({ where: { olay: olay as never, kurulumId } });
  const sessizYap = (id: string, saatOnce: number) => prisma.kurulum.update({ where: { id }, data: { sonYoklamaZamani: new Date(Date.now() - saatOnce * HOUR) } });
  try {
    const aAnahtar = kurulumAnahtariUret();
    const a = await kurulumFiksturu(ctx);
    let aKira = await etkin(a, aAnahtar);

    console.log("\n§1 kurulum ses vermiyor");
    await sessizYap(a.kurulumDbId, 25);
    const t1 = await scanTimedNotifications(CFG, Date.now());
    const rows = await prisma.bildirim.findMany({ where: { olay: "KURULUM_SESSIZ", kurulumId: a.kurulumDbId } });
    const son = (await prisma.kurulum.findUniqueOrThrow({ where: { id: a.kurulumDbId } })).sonYoklamaZamani!;
    const g = rows[0]?.govde as Record<string, string | null> | undefined;
    kontrol(
      "§1a eşikten eski son yoklama → iki kanal satırı (müşteri · tesis · kurulum · lisans no · sınıf · son yoklama anı · portal yolu)",
      rows.length === 2 && t1.silent === 2 && !!g?.musteri && g.tesis === "Merkez Tesis" && g.lisansNo === a.lisansNo && g.sinif === "URETIM" && g.tarih === son.toISOString() && g.portalYolu === `/kurulumlar/${a.kurulumDbId}`,
      `${rows.length} · ${JSON.stringify(g)}`,
    );
    await scanTimedNotifications(CFG, Date.now());
    kontrol("§1b ikinci tur yeni satır DOĞURMAZ (tekillik: kurulum + son yoklama anı)", (await say("KURULUM_SESSIZ", a.kurulumDbId)) === 2);
    const p = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: a.kurulumId, amac: "yokla", anahtar: aAnahtar, govde: yoklamaGovdesi({ sonKiraId: aKira, parmakIzi: f.parmakIzi }) });
    aKira = kiraIdOf(p.json);
    await scanTimedNotifications(CFG, Date.now());
    kontrol("§1c kurulum yoklayınca susar", p.status === 200 && (await say("KURULUM_SESSIZ", a.kurulumDbId)) === 2);
    await sessizYap(a.kurulumDbId, 30);
    await scanTimedNotifications(CFG, Date.now());
    kontrol("§1d yeni sessizlik dönemi YENİ satır (2 → 4)", (await say("KURULUM_SESSIZ", a.kurulumDbId)) === 4);

    console.log("\n§2 TOCTOU — kilit altında taze okuma");
    const bAnahtar = kurulumAnahtariUret();
    const b = await kurulumFiksturu(ctx, { tesisId: a.tesisId, musteriId: a.musteriId });
    await etkin(b, bAnahtar);
    await sessizYap(b.kurulumDbId, 26);
    let serbest: () => void = () => undefined;
    const tutucu = prisma.$transaction(
      async (tx) => {
        await lockInstallation(tx, b.kurulumDbId);
        await new Promise<void>((r) => (serbest = r));
        await tx.kurulum.update({ where: { id: b.kurulumDbId }, data: { sonYoklamaZamani: new Date() } });
      },
      { timeout: 15_000 },
    );
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    const tarama = scanTimedNotifications(CFG, Date.now());
    await new Promise((r) => setTimeout(r, 600));
    serbest();
    await tutucu;
    await tarama;
    const bekledi = Date.now() - t0;
    kontrol("§2a ✓K tarama kurulum kilidinde BEKLEDİ", bekledi >= 550, `${bekledi} ms`);
    kontrol("§2b kilit altında yoklayan kurulum 'sessiz' bildirimi ALMAZ", (await say("KURULUM_SESSIZ", b.kurulumDbId)) === 0);

    console.log("\n§3 sınıf süzmesi");
    const dAnahtar = kurulumAnahtariUret();
    const d = await kurulumFiksturu(ctx, { sinif: "DEMO", tesisId: a.tesisId, musteriId: a.musteriId });
    await etkin(d, dAnahtar);
    await sessizYap(d.kurulumDbId, 40);
    await scanTimedNotifications(CFG, Date.now());
    kontrol("§3a DEMO (varsayılan dışı) sessizliği yazılmaz", (await say("KURULUM_SESSIZ", d.kurulumDbId)) === 0);
    await scanTimedNotifications({ ...CFG, silentClasses: [...CFG.silentClasses, "DEMO"] }, Date.now());
    kontrol("§3b ✓K aynı kurulum sınıf listeye girince yazılır", (await say("KURULUM_SESSIZ", d.kurulumDbId)) === 2);

    console.log("\n§4 vade/bitiş yaklaşıyor");
    const kira = await prisma.kurulum.findUniqueOrThrow({ where: { id: a.kurulumDbId }, select: { sonKiraId: true, sonKira: { select: { bitis: true } } } });
    const kiraAni = kira.sonKira!.bitis.getTime() - 3 * DAY;
    await scanTimedNotifications(CFG, kiraAni);
    await scanTimedNotifications(CFG, kiraAni + HOUR);
    const kRows = await prisma.bildirim.findMany({ where: { olay: "KIRA_BITISI_YAKLASIYOR", kurulumId: a.kurulumDbId } });
    kontrol("§4a kira bitişi 3 gün sonra → iki satır, anahtar kira kimliği, ikinci tur yeni satır yok", kRows.length === 2 && kRows.every((r) => r.tekillikAnahtari === `KIRA_BITISI_YAKLASIYOR:${kira.sonKiraId}`), `${kRows.length}`);
    await s.setValidityEnd({ installationDbId: a.kurulumDbId, validUntil: new Date(Date.now() + 3 * DAY), reason: "bekçi vadesi", actor: "bekci" });
    await scanTimedNotifications(CFG, Date.now());
    await scanTimedNotifications(CFG, Date.now());
    kontrol("§4b geçerlilik bitişi 3 gün sonra → iki satır (ikinci tur yok)", (await say("GECERLILIK_BITISI_YAKLASIYOR", a.kurulumDbId)) === 2);
    await s.extendValidity({ installationDbId: a.kurulumDbId, days: 2, reason: "bekçi uzatması", actor: "bekci" });
    await scanTimedNotifications(CFG, Date.now());
    kontrol("§4c bitiş değişti (uzatma) → YENİ dönem satırı (2 → 4)", (await say("GECERLILIK_BITISI_YAKLASIYOR", a.kurulumDbId)) === 4);
    const plan = await s.createInstallmentPlan({
      installationDbId: b.kurulumDbId,
      description: "bekçi taksidi",
      items: [
        { dueAt: new Date(Date.now() + 3 * DAY), amount: "100" },
        { dueAt: new Date(Date.now() + 20 * DAY), amount: "100" },
      ],
      actor: "bekci",
    });
    await scanTimedNotifications(CFG, Date.now());
    const tRows = await prisma.bildirim.findMany({ where: { olay: "TAKSIT_VADESI_YAKLASIYOR", kurulumId: b.kurulumDbId } });
    kontrol("§4d taksit vadesi 3 gün sonra → iki satır (Taksit 1); 20 gün sonraki kalem susar", tRows.length === 2 && tRows.every((r) => r.ilgiliKayit === plan.kalemler[0]!.id && (r.govde as Record<string, unknown>).referans === "Taksit 1"), `${tRows.length}`);

    console.log("\n§5 aday yalıtımı");
    const cAnahtar = kurulumAnahtariUret();
    const c = await kurulumFiksturu(ctx, { tesisId: a.tesisId, musteriId: a.musteriId });
    await etkin(c, cAnahtar);
    await sessizYap(c.kurulumDbId, 50);
    await sessizYap(b.kurulumDbId, 50);
    const bOnce = await say("KURULUM_SESSIZ", b.kurulumDbId);
    await patlat(prisma, c.kurulumDbId);
    let dustu = false;
    try {
      await scanTimedNotifications(CFG, Date.now());
    } catch {
      dustu = true;
    } finally {
      await sustur(prisma);
    }
    const bSonra = await say("KURULUM_SESSIZ", b.kurulumDbId);
    kontrol("§5a bir adayın yazımı düşünce tarama DÜŞMEZ, diğer aday (yeni dönem) yazılır", !dustu && (await say("KURULUM_SESSIZ", c.kurulumDbId)) === 0 && bSonra === bOnce + 2, `${bOnce} → ${bSonra}`);

    console.log("\n§6 bakım işi aralığı");
    const { MaintenanceScheduler } = await import("../src/services/maintenance");
    const bakim = new MaintenanceScheduler({ ...ctx, config: { ...ctx.config, BILDIRIM_TARAMA_DK: 15 } });
    const t = Date.now();
    await bakim.runOnce(t);
    kontrol("§6a ilk tur tarar (düşen aday artık yazılır)", (await say("KURULUM_SESSIZ", c.kurulumDbId)) === 2);
    await sessizYap(a.kurulumDbId, 60);
    await bakim.runOnce(t + 60_000);
    const arada = await say("KURULUM_SESSIZ", a.kurulumDbId);
    await bakim.runOnce(t + 16 * 60_000);
    kontrol("§6b aralık dolmadan tarama yok (4), dolunca var (6)", arada === 4 && (await say("KURULUM_SESSIZ", a.kurulumDbId)) === 6, `${arada}`);
  } catch (err) {
    kontrol("beklenmeyen hata", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    await sustur(prisma).catch(() => undefined);
    await sunucu.kapat();
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

async function patlat(prisma: Prisma, kurulumId: string): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "bekci_bildirim_patlat"() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN IF NEW."kurulumId" = '${kurulumId}'::uuid THEN RAISE EXCEPTION 'bekci: bildirim yazimi dusuruldu'; END IF; RETURN NEW; END $f$`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "bekci_bildirim_patlat" ON "bildirim"`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "bekci_bildirim_patlat" BEFORE INSERT ON "bildirim" FOR EACH ROW EXECUTE FUNCTION "bekci_bildirim_patlat"()`);
}

async function sustur(prisma: Prisma): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "bekci_bildirim_patlat" ON "bildirim"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "bekci_bildirim_patlat"()`);
}

void main();
