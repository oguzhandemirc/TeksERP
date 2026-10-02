// =============================================================================
// YAPTIRIM KİRAYA YANSIR — portal eylemi → YaptirimEylemi defteri → kira `yaptirim` alanı.
// K0 mesaj · K1 güncelleme donuk (indirme belirteci verilmez) · K2 modül dondurma · K3 tarihli
// kısıtlama · K4/K5 ikinci onay (lisans numarası aynen) · geri alma ters satır (bir kez) ·
// kademe en şiddetli etkin eylem · zorlama (gözlem ↔ zorla; aynı değer no-op) · geçerlilik bitişi
// (vade / uzat / kalıcıya çevir) — hepsi imzalı kirada, hepsi defterde; sebep zorunlu.
// DB seddi: defter satırı güncellenemez/silinemez (tetikleyici).
// Lisans v2: kiranın ödenmiş tarihi (P) GECERLILIK defterini izler (vade · uzatma · kalıcı → null) · §5 kapanış kirasının
// yaptırımı (SAF `withClosingRestriction`): kademe en az K3 (K4/K5 korunur), tarih iki K3'ün erkeni, mesaj/modül korunur.
// ⭐ KALICI SONDA ✓K2 (her koşumda): geri alınan K4 kademeyi düşürür (katlama geri almayı gerçekten
//    okuyor) · aynı eylem ikinci kez geri alınamaz (409).
// Koşum: npx tsx scripts/test_yaptirim_kira.ts
// =============================================================================
import { DAY_MS, ENDPOINTS, parseJws, type LeaseDoc } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  yoklamaGovdesi,
  type Yanit,
} from "./lib/test-ortam";

function kiraOf(y: Yanit): LeaseDoc | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as LeaseDoc) : null;
}

async function hataKodu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "HATA_YOK";
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return e.status ? String(e.status) : `ATILDI:${e.message ?? ""}`;
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const svc = await import("../src/services/sanction.service");
  const temizlenecek: string[] = [];
  const sunucu = await sunucuBaslat(ortam);
  try {
    const anahtar = kurulumAnahtariUret();
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }),
    });
    let uc = kiraOf(et)!.kiraId;
    let sonYanit: Yanit = et;
    const yokla = async (): Promise<LeaseDoc> => {
      sonYanit = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
        kurulumId: k.kurulumId,
        amac: "yokla",
        anahtar,
        govde: yoklamaGovdesi({ sonKiraId: uc, hak: { hakId: k.hakId, surum: 1 }, parmakIzi: f.parmakIzi }),
      });
      const kira = kiraOf(sonYanit);
      if (!kira) throw new Error(`yoklama ${sonYanit.status} ${sonYanit.kod}`);
      uc = kira.kiraId;
      return kira;
    };
    const ortak = { installationDbId: k.kurulumDbId, actor: "bekci" };

    console.log("\n§1 K0 · K2 · K1 · K3");
    await svc.applySanction({ ...ortak, level: "K0", message: "Ödeme hatırlatması", reason: "vade yaklaşıyor" });
    let kira = await yokla();
    kontrol("§1a K0 → kademe K0 + mesaj", kira.yaptirim.kademe === "K0" && kira.yaptirim.mesaj === "Ödeme hatırlatması");
    await svc.applySanction({ ...ortak, level: "K2", modules: ["finance.enabled"], reason: "finans modülü ödenmedi" });
    kira = await yokla();
    kontrol("§1b K2 → finance.enabled donmuş, kademe K2 (en şiddetli)", kira.yaptirim.kademe === "K2" && JSON.stringify(kira.yaptirim.donmusModuller) === '["finance.enabled"]');
    const k1 = await svc.applySanction({ ...ortak, level: "K1", reason: "bakım sözleşmesi bitti" });
    kira = await yokla();
    const belirtecler = sonYanit.json.indirmeBelirtecleri as unknown[];
    kontrol("§1c K1 → güncelleme donuk + indirme belirteci YOK; kademe K2 kalır", kira.yaptirim.guncellemeDonuk && belirtecler.length === 0 && kira.yaptirim.kademe === "K2");
    await svc.applySanction({ ...ortak, level: "K3", restrictionDays: 7, reason: "ödeme 30 gün gecikti" });
    kira = await yokla();
    const k3Gun = kira.yaptirim.kisitlamaTarihi ? (Date.parse(kira.yaptirim.kisitlamaTarihi) - Date.now()) / DAY_MS : -1;
    kontrol("§1d K3 → kademe K3 + kısıtlama tarihi ~7 gün sonra", kira.yaptirim.kademe === "K3" && k3Gun > 6.9 && k3Gun < 7.1, k3Gun.toFixed(2));

    console.log("\n§2 K4/K5 ikinci onay ve geri alma");
    kontrol("§2a K4 onaysız → 400", (await hataKodu(() => svc.applySanction({ ...ortak, level: "K4", reason: "kavga" }))) === "400");
    kontrol("§2b K4 yanlış onay → 400", (await hataKodu(() => svc.applySanction({ ...ortak, level: "K4", reason: "kavga", confirmation: "TKS-2026-9999" }))) === "400");
    const k4 = await svc.applySanction({ ...ortak, level: "K4", reason: "sözleşme ihlali", confirmation: k.lisansNo });
    kira = await yokla();
    kontrol("§2c K4 (lisans no ile onay) → kademe K4", kira.yaptirim.kademe === "K4");
    await svc.revertSanction({ actionId: k4.id, reason: "uzlaşıldı", actor: "bekci" });
    kira = await yokla();
    kontrol("§2d ✓K K4 geri alındı → kademe K3'e döner", kira.yaptirim.kademe === "K3");
    kontrol("§2e ✓K aynı eylem ikinci kez geri alınamaz → 409", (await hataKodu(() => svc.revertSanction({ actionId: k4.id, reason: "tekrar", actor: "bekci" }))) === "409");
    const k5 = await svc.applySanction({ ...ortak, level: "K5", reason: "tam durdurma", confirmation: k.lisansNo });
    kira = await yokla();
    kontrol("§2f K5 → kademe K5", kira.yaptirim.kademe === "K5");
    await svc.revertSanction({ actionId: k5.id, reason: "geri", actor: "bekci" });
    await svc.revertSanction({ actionId: k1.id, reason: "bakım yenilendi", actor: "bekci" });
    kira = await yokla();
    kontrol("§2g K5 + K1 geri → K3, güncelleme serbest, belirteçler döndü", kira.yaptirim.kademe === "K3" && !kira.yaptirim.guncellemeDonuk && (sonYanit.json.indirmeBelirtecleri as unknown[]).length === 2);

    console.log("\n§3 zorlama ve geçerlilik");
    const z1 = await svc.setEnforcement({ ...ortak, enforce: true, reason: "gözlem verisi temiz" });
    const z2 = await svc.setEnforcement({ ...ortak, enforce: true, reason: "tekrar" });
    kira = await yokla();
    kontrol("§3a zorla → kira zorlama=true; aynı değere geçiş no-op (satır yok)", kira.zorlama === true && z1 !== null && z2 === null);
    const vade = new Date(Date.now() + 40 * DAY_MS);
    await svc.setValidityEnd({ ...ortak, validUntil: vade, reason: "vadeli satış" });
    kira = await yokla();
    kontrol("§3b vade → kira gecerlilikBitis; P (odenmisTarih) aynı tarih", kira.gecerlilikBitis === vade.toISOString() && kira.odenmisTarih === vade.toISOString(), kira.gecerlilikBitis ?? "null");
    await svc.extendValidity({ ...ortak, days: 10, reason: "10 gün uzat" });
    kira = await yokla();
    kontrol("§3c 10 gün uzat → vade + 10 gün (P de)", kira.gecerlilikBitis === new Date(vade.getTime() + 10 * DAY_MS).toISOString() && kira.odenmisTarih === kira.gecerlilikBitis);
    await svc.setValidityEnd({ ...ortak, validUntil: null, reason: "peşin ödendi — kalıcı" });
    kira = await yokla();
    kontrol("§3d kalıcıya çevir → gecerlilikBitis null, P null (süresiz)", kira.gecerlilikBitis === null && kira.odenmisTarih === null);
    kontrol("§3e ZORLAMA eylemi geri alınamaz (ayrı eylemle değişir) → 400", (await hataKodu(() => svc.revertSanction({ actionId: z1!.id, reason: "x", actor: "bekci" }))) === "400");
    kontrol("§3f sebepsiz eylem → 400", (await hataKodu(() => svc.applySanction({ ...ortak, level: "K0", message: "m", reason: "  " }))) === "400");

    console.log("\n§4 defter");
    const satirlar = await prisma.yaptirimEylemi.findMany({ where: { kurulumId: k.kurulumDbId } });
    const turler = satirlar.map((s) => s.tur).sort().join(",");
    kontrol("§4a her eylem defterde (ters satırlar dahil)", satirlar.length === 13, `${satirlar.length}: ${turler}`);
    let guncellemeReddi = "";
    try {
      await prisma.$executeRawUnsafe(`UPDATE yaptirim_eylemi SET sebep = 'değişti' WHERE id = '${k4.id}'`);
    } catch (err) {
      guncellemeReddi = (err as Error).message;
    }
    kontrol("§4b DB seddi: defter satırı GÜNCELLENEMEZ", /Defter satırı/.test(guncellemeReddi));
    let silmeReddi = "";
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM yaptirim_eylemi WHERE id = '${k4.id}'`);
    } catch (err) {
      silmeReddi = (err as Error).message;
    }
    kontrol("§4c DB seddi: temizlik beyanı olmadan defter satırı SİLİNEMEZ", /Defter satırı/.test(silmeReddi));

    console.log("\n§5 kapanış kirasının yaptırımı (SAF)");
    const { withClosingRestriction } = await import("../src/services/lease.service");
    const bos = { kademe: null, mesaj: null, kisitlamaTarihi: null, donmusModuller: [] as string[], guncellemeDonuk: false };
    const at = new Date("2026-12-01T00:00:00.000Z");
    const r1 = withClosingRestriction(bos, at);
    kontrol("§5a yaptırımsız → K3 + kapanış tarihi", r1.kademe === "K3" && r1.kisitlamaTarihi === at.toISOString());
    const r2 = withClosingRestriction({ ...bos, kademe: "K4", mesaj: "m", donmusModuller: ["finance.enabled"] }, at);
    kontrol("§5b K4 korunur (daha şiddetli), mesaj ve donmuş modül korunur", r2.kademe === "K4" && r2.mesaj === "m" && r2.donmusModuller.join() === "finance.enabled" && r2.kisitlamaTarihi === at.toISOString());
    const erken = "2026-11-01T00:00:00.000Z";
    kontrol("§5c defterdeki ERKEN K3 tarihi korunur", withClosingRestriction({ ...bos, kademe: "K3", kisitlamaTarihi: erken }, at).kisitlamaTarihi === erken);
    kontrol("§5d defterdeki GEÇ K3 tarihi kapanışla öne çekilir", withClosingRestriction({ ...bos, kademe: "K3", kisitlamaTarihi: "2027-01-01T00:00:00.000Z" }, at).kisitlamaTarihi === at.toISOString());
  } finally {
    await sunucu.durdur();
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
