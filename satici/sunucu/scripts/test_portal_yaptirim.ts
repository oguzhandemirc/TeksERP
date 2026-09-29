// =============================================================================
// PORTAL — YAPTIRIM: K4/K5 YAZARAK İKİNCİ ONAY · DEFTER TERS KAYDI (silme yok) · İDEMPOTENCY · ZİL.
// K4/K5 yalnız kurulumun lisans numarası AYNEN yazılınca uygulanır (eksik/yanlış → 400
// IKINCI_ONAY_GEREKLI, deftere satır YOK). Geri alma yeni bir GERI_AL satırıdır: ileri satır
// kalır, defter yalnız büyür; ikinci geri alma 409. Her eylem sebep ister. Aynı işlem kimliği
// aynı yanıtı alır (eylem ikinci kez koşmaz), başka gövdeyle 409 ISLEM_KIMLIGI_CAKISTI. Eylem
// kendi tx'inde zili ('lisans') çalar — PG NOTIFY bu bekçinin dinleyicisine gelir.
// §5 geri sayımı 7 günden KISA K3 AĞIRDIR (yönetici kararı f): operatör uygulayamaz/planlayamaz/
// kaldıramaz (403), yönetici de ancak lisans numarasıyla (400 IKINCI_ONAY_GEREKLI); planlı K3 ve
// taksit planının kısıtlama günü de aynı kapıdan geçer.
// ⭐ KALICI SONDA ✓K4 (her koşumda): (1) doğru onayla K4 UYGULANIR (201 + kademe K4) · (2) geri
//    alma kademeyi DÜŞÜRÜR (katlama ters satırı okuyor) · (3) FARKLI işlem kimliğiyle aynı gövde
//    YENİ satır yazar (tekrar kapısı kimliğe bakıyor, gövdeye değil) · (4) 7 günlük K3 operatörde
//    GEÇER (sınır ağır sayılmıyor — kapı kör reddetmiyor).
// Koşum: npx tsx scripts/test_portal_yaptirim.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { Client } from "pg";
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

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000" });
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { computeSanctionState } = await import("../src/services/lease.service");
  const { DOORBELL_CHANNEL } = await import("../src/services/doorbell");
  const kullanicilar: string[] = [];
  const kurulumlar: string[] = [];
  const sunucu = await portalSunuculariKur(ctx);
  const dinleyici = new Client({ connectionString: process.env.DATABASE_URL });
  const ziller: { k: string; konu: string }[] = [];
  try {
    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    kullanicilar.push(yonetici.id);
    const giris = await portalGiris(sunucu.tailnet, "/portal/api", yonetici);
    const cerez = giris.cerez!;
    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    // Dinleyici fikstürden SONRA: HAK imzasının zili sayılmaz, yalnız portal eylemleri.
    await dinleyici.connect();
    dinleyici.on("notification", (m) => ziller.push(JSON.parse(m.payload ?? "{}") as { k: string; konu: string }));
    await dinleyici.query(`LISTEN ${DOORBELL_CHANNEL}`);
    const yol = (u: string) => `/portal/api/kurulumlar/${k.kurulumDbId}/${u}`;
    const defter = () => prisma.yaptirimEylemi.findMany({ where: { kurulumId: k.kurulumDbId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const kademe = async () => (await computeSanctionState(prisma, k.kurulumDbId)).kademe;

    console.log("\n§1 K4/K5 yazarak ikinci onay");
    const onaysiz = await portalIstek(sunucu.tailnet, yol("agir-yaptirim"), { cerez, govde: { clientToken: randomUUID(), kademe: "K4", sebep: "sözleşme ihlali" } });
    const yanlis = await portalIstek(sunucu.tailnet, yol("agir-yaptirim"), { cerez, govde: { clientToken: randomUUID(), kademe: "K4", sebep: "sözleşme ihlali", onay: "TKS-2026-9999" } });
    const kucukHarf = await portalIstek(sunucu.tailnet, yol("agir-yaptirim"), { cerez, govde: { clientToken: randomUUID(), kademe: "K5", sebep: "tam durdurma", onay: k.lisansNo.toLowerCase() } });
    kontrol(
      "§1a onaysız / yanlış numara / küçük harf → 400 IKINCI_ONAY_GEREKLI",
      [onaysiz, yanlis, kucukHarf].every((y) => y.status === 400 && y.kod === "IKINCI_ONAY_GEREKLI"),
      [onaysiz, yanlis, kucukHarf].map((y) => `${y.status}/${y.kod}`).join(" "),
    );
    kontrol("§1b reddedilen ağır eylemler deftere satır YAZMAZ", (await defter()).length === 0);
    const k4Govde = { clientToken: randomUUID(), kademe: "K4", sebep: "sözleşme ihlali", onay: k.lisansNo, mesaj: "Lisans askıda" };
    const k4 = await portalIstek(sunucu.tailnet, yol("agir-yaptirim"), { cerez, govde: k4Govde });
    kontrol("§1c ✓K lisans numarası AYNEN → 201 + kademe K4", k4.status === 201 && (await kademe()) === "K4", `${k4.status} ${k4.kod ?? ""}`);
    const k4Satir = await prisma.yaptirimEylemi.findUniqueOrThrow({ where: { id: k4.veri.id as string } });
    kontrol("§1d defter satırında sebep + yapan (satici:<kullanıcı>)", k4Satir.sebep === "sözleşme ihlali" && k4Satir.yapan === `satici:${yonetici.kullaniciAdi}`, k4Satir.yapan);
    const k4Hafif = await portalIstek(sunucu.tailnet, yol("yaptirim"), { cerez, govde: { clientToken: randomUUID(), kademe: "K4", sebep: "arka kapı" } });
    kontrol("§1e hafif uçtan K4 geçmez → 400 (şema: yalnız K0–K3)", k4Hafif.status === 400 && k4Hafif.kod === "GOVDE_GECERSIZ", `${k4Hafif.status}`);

    console.log("\n§2 işlem kimliği (idempotency)");
    const tekrar = await portalIstek(sunucu.tailnet, yol("agir-yaptirim"), { cerez, govde: k4Govde });
    kontrol("§2a aynı kimlik + aynı gövde → aynı yanıt (aynı eylem id), Idempotent-Replay", tekrar.status === 201 && tekrar.veri.id === k4.veri.id && tekrar.basliklar.get("idempotent-replay") === "true");
    kontrol("§2b tekrar deftere ikinci satır YAZMAZ", (await defter()).length === 1);
    const cakisan = await portalIstek(sunucu.tailnet, yol("agir-yaptirim"), { cerez, govde: { ...k4Govde, sebep: "başka sebep" } });
    kontrol("§2c aynı kimlik + BAŞKA gövde → 409 ISLEM_KIMLIGI_CAKISTI", cakisan.status === 409 && cakisan.kod === "ISLEM_KIMLIGI_CAKISTI", `${cakisan.status} ${cakisan.kod}`);
    const baskaYol = await portalIstek(sunucu.tailnet, yol("yaptirim"), { cerez, govde: { clientToken: k4Govde.clientToken, kademe: "K0", sebep: "x" } });
    kontrol("§2d aynı kimlik BAŞKA uçta → 409 ISLEM_KIMLIGI_CAKISTI", baskaYol.status === 409 && baskaYol.kod === "ISLEM_KIMLIGI_CAKISTI");
    const yeniKimlik = await portalIstek(sunucu.tailnet, yol("agir-yaptirim"), { cerez, govde: { ...k4Govde, clientToken: randomUUID() } });
    kontrol("§2e ✓K yeni kimlik + aynı gövde → YENİ satır", yeniKimlik.status === 201 && yeniKimlik.veri.id !== k4.veri.id && (await defter()).length === 2);
    const kimliksiz = await portalIstek(sunucu.tailnet, yol("yaptirim"), { cerez, govde: { kademe: "K0", sebep: "x" } });
    kontrol("§2f işlem kimliği olmayan yazma → 400", kimliksiz.status === 400, `${kimliksiz.status}`);

    console.log("\n§3 geri al = ters kayıt (silme yok)");
    await portalIstek(sunucu.tailnet, `/portal/api/yaptirimlar/${yeniKimlik.veri.id as string}/geri-al`, { cerez, govde: { clientToken: randomUUID(), sebep: "mükerrer eylem" } });
    const oncekiSatirlar = (await defter()).map((r) => r.id);
    const geri = await portalIstek(sunucu.tailnet, `/portal/api/yaptirimlar/${k4.veri.id as string}/geri-al`, { cerez, govde: { clientToken: randomUUID(), sebep: "ödeme alındı" } });
    const sonrakiSatirlar = await defter();
    const geriSatir = sonrakiSatirlar.find((r) => r.id === geri.veri.id);
    kontrol("§3a geri al → 201 GERI_AL satırı, hedefe bağlı", geri.status === 201 && geriSatir?.tur === "GERI_AL" && geriSatir.geriAlinanEylemId === k4.veri.id, `${geri.status}`);
    kontrol("§3b ileri satır YERİNDE (hiçbir satır silinmedi, defter büyüdü)", oncekiSatirlar.every((id) => sonrakiSatirlar.some((r) => r.id === id)) && sonrakiSatirlar.length === oncekiSatirlar.length + 1);
    kontrol("§3c ✓K geri alınan K4'ler kademeden düştü (kademe yok)", (await kademe()) === null);
    const ikinciGeri = await portalIstek(sunucu.tailnet, `/portal/api/yaptirimlar/${k4.veri.id as string}/geri-al`, { cerez, govde: { clientToken: randomUUID(), sebep: "tekrar" } });
    kontrol("§3d aynı eylem ikinci kez geri alınamaz → 409 DURUM_CAKISMASI", ikinciGeri.status === 409 && ikinciGeri.kod === "DURUM_CAKISMASI", `${ikinciGeri.status} ${ikinciGeri.kod}`);
    const tersinTersi = await portalIstek(sunucu.tailnet, `/portal/api/yaptirimlar/${geri.veri.id as string}/geri-al`, { cerez, govde: { clientToken: randomUUID(), sebep: "x" } });
    kontrol("§3e ters satırın kendisi geri alınamaz → 400", tersinTersi.status === 400, `${tersinTersi.status}`);
    const k5 = await portalIstek(sunucu.tailnet, yol("agir-yaptirim"), { cerez, govde: { clientToken: randomUUID(), kademe: "K5", sebep: "ödeme yok", onay: k.lisansNo } });
    kontrol("§3f K5 (onaylı) → 201 + kademe K5", k5.status === 201 && (await kademe()) === "K5");
    let silmeReddi = "";
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM yaptirim_eylemi WHERE id = '${k5.veri.id as string}'`);
    } catch (err) {
      silmeReddi = (err as Error).message;
    }
    let duzeltmeReddi = "";
    try {
      await prisma.$executeRawUnsafe(`UPDATE yaptirim_eylemi SET tur = 'K0' WHERE id = '${k5.veri.id as string}'`);
    } catch (err) {
      duzeltmeReddi = (err as Error).message;
    }
    kontrol("§3g DB seddi: defter satırı silinemez ve düzeltilemez", /Defter satırı/.test(silmeReddi) && /Defter satırı/.test(duzeltmeReddi));

    console.log("\n§4 sebep zorunlu · denetim · zil");
    const sebepsiz = await portalIstek(sunucu.tailnet, yol("yaptirim"), { cerez, govde: { clientToken: randomUUID(), kademe: "K1", sebep: "   " } });
    kontrol("§4a boşluktan ibaret sebep → 400", sebepsiz.status === 400, `${sebepsiz.status}`);
    const k3 = await portalIstek(sunucu.tailnet, yol("yaptirim"), { cerez, govde: { clientToken: randomUUID(), kademe: "K3", kisitlamaGun: 7, sebep: "30 gün gecikme" } });
    const k3Tarih = (k3.veri.parametre as { kisitlamaTarihi?: string } | undefined)?.kisitlamaTarihi;
    const k3Gun = k3Tarih ? (Date.parse(k3Tarih) - Date.now()) / 86_400_000 : -1;
    kontrol("§4b K3 7 gün → kısıtlama tarihi ~7 gün sonra", k3.status === 201 && k3Gun > 6.9 && k3Gun < 7.1, k3Gun.toFixed(2));
    const denetim = await prisma.denetim.findMany({ where: { varlikId: k.kurulumDbId, olay: { startsWith: "YAPTIRIM_" } } });
    kontrol("§4c her eylem denetimde, yapan portal kullanıcısı", denetim.length >= 6 && denetim.every((d) => d.yapan === `satici:${yonetici.kullaniciAdi}`), `${denetim.length}`);
    await bekle(300);
    const buKurulum = ziller.filter((z) => z.k === k.kurulumDbId && z.konu === "lisans");
    kontrol("§4d her eylem zili 'lisans' konusuyla çaldı (ret ve tekrar çalmaz)", buKurulum.length === (await defter()).length, `${buKurulum.length} zil / ${(await defter()).length} satır`);

    console.log("\n§5 geri sayımı 7 günden kısa K3 = AĞIR yaptırım");
    const operator = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(operator.id);
    const opCerez = (await portalGiris(sunucu.tailnet, "/portal/api", operator)).cerez!;
    const op = (u: string, govde: object) => portalIstek(sunucu.tailnet, u, { cerez: opCerez, govde: { clientToken: randomUUID(), ...govde } });
    const yon = (u: string, govde: object) => portalIstek(sunucu.tailnet, u, { cerez, govde: { clientToken: randomUUID(), ...govde } });
    const satirSayisi = (await defter()).length;
    const opKisa = await op(yol("yaptirim"), { kademe: "K3", kisitlamaGun: 3, sebep: "kısa geri sayım" });
    const opTarih = await op(yol("yaptirim"), { kademe: "K3", kisitlamaTarihi: new Date(Date.now() + 2 * 86_400_000).toISOString(), sebep: "kısa tarih" });
    kontrol("§5a operatör: 3 günlük K3 ve 2 gün sonraki tarihli K3 → 403 YETKISIZ, satır YOK", opKisa.status === 403 && opKisa.kod === "YETKISIZ" && opTarih.status === 403 && (await defter()).length === satirSayisi, `${opKisa.status}/${opTarih.status}`);
    const opSinir = await op(yol("yaptirim"), { kademe: "K3", kisitlamaGun: 7, sebep: "sınır" });
    kontrol("§5b ✓K operatör: 7 günlük K3 → 201 (sınır hafif)", opSinir.status === 201, `${opSinir.status} ${opSinir.kod ?? ""}`);
    const yonOnaysiz = await yon(yol("yaptirim"), { kademe: "K3", kisitlamaGun: 3, sebep: "kısa geri sayım" });
    const yonOnayli = await yon(yol("yaptirim"), { kademe: "K3", kisitlamaGun: 3, sebep: "kısa geri sayım", onay: k.lisansNo });
    kontrol("§5c yönetici: onaysız → 400 IKINCI_ONAY_GEREKLI; lisans no ile → 201", yonOnaysiz.status === 400 && yonOnaysiz.kod === "IKINCI_ONAY_GEREKLI" && yonOnayli.status === 201, `${yonOnaysiz.status}/${yonOnayli.status}`);
    const opGeri = await op(`/portal/api/yaptirimlar/${yonOnayli.veri.id as string}/geri-al`, { sebep: "ödendi" });
    const opHafifGeri = await op(`/portal/api/yaptirimlar/${opSinir.veri.id as string}/geri-al`, { sebep: "ödendi" });
    kontrol("§5d ağır K3'ü operatör geri alamaz → 403; hafif K3'ü alır → 201", opGeri.status === 403 && opHafifGeri.status === 201, `${opGeri.status}/${opHafifGeri.status}`);
    const vade = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const opPlan = await op(yol("planli-eylem"), { kademe: "K3", vade, kisitlamaGun: 2, sebep: "vade" });
    const yonPlanOnaysiz = await yon(yol("planli-eylem"), { kademe: "K3", vade, kisitlamaGun: 2, sebep: "vade" });
    const yonPlan = await yon(yol("planli-eylem"), { kademe: "K3", vade, kisitlamaGun: 2, sebep: "vade", onay: k.lisansNo });
    kontrol("§5e planlı kısa K3: operatör 403 · yönetici onaysız 400 · onaylı 201", opPlan.status === 403 && yonPlanOnaysiz.status === 400 && yonPlan.status === 201, `${opPlan.status}/${yonPlanOnaysiz.status}/${yonPlan.status}`);
    const kalem = [{ vade: new Date(Date.now() + 20 * 86_400_000).toISOString(), tutar: "10.00" }];
    const opTaksit = await op(yol("taksit-plani"), { aciklama: "kısa kısıtlama", kalemler: kalem, kisitlamaGun: 5 });
    const yonTaksitOnaysiz = await yon(yol("taksit-plani"), { aciklama: "kısa kısıtlama", kalemler: kalem, kisitlamaGun: 5 });
    const opTaksitVarsayilan = await op(yol("taksit-plani"), { aciklama: "varsayılan kısıtlama", kalemler: kalem });
    kontrol(
      "§5f taksit planı kısıtlama günü < 7: operatör 403 · yönetici onaysız 400; varsayılan (15) operatörde 201",
      opTaksit.status === 403 && yonTaksitOnaysiz.status === 400 && opTaksitVarsayilan.status === 201,
      `${opTaksit.status}/${yonTaksitOnaysiz.status}/${opTaksitVarsayilan.status}`,
    );
  } finally {
    await dinleyici.end().catch(() => undefined);
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
