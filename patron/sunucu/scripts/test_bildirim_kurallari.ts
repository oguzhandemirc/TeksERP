// =============================================================================
// BİLDİRİM KURALLARI BEKÇİSİ (B5) — her kural negatif + pozitif:
//   §1 tekrar gönderim YOK: aynı olay iki turda tek satır, tek gönderim (pozitif: yeni gün yeni olay)
//   §2 sessiz saatte gönderilmez → bitişe ertelenir (deneme hakkı yanmaz); bitişte gider · sessiz kapalı → hemen gider
//   §3 kapalı türe / "bildirim yok"a gönderilmez (ATLANDI) · açık tür gider · sonradan açılınca eski olay GİTMEZ
//   §4 izinsiz hesaba gitmez: finans içerikli çek bildirimi yalnız finans izinli hesaba; doğuştan sonra izni
//      düşürülen hesaba gönderim anında da gitmez
//   §5 gelen kutusu sonucu yalnız yazana; eşik yalnız karşılaştırma (eşik = değer → olay yok)
//   §6 tesis saati: gün anahtarı ve sessiz saat ANLIK `tesis.saatDilimi`nden (RLS altında okunur; yoksa İstanbul)
// Koşum: npx tsx scripts/test_bildirim_kurallari.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withTesis } from "../src/lib/tenant";
import { RecordingTransport } from "../src/push/transports";
import { ayar, ayarYaz, anlikYaz, bildirimler, cihazKaydet, GECIKEN, simdikiSessiz, tur } from "./lib/bildirim-fikstur";
import { hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, type Ortam, type TestHesabi } from "./lib/test-ortam";

const OZET_SIPARIS = ["bulut:ozet:oku", "bulut:siparis:oku"];
const DAY = 86_400_000;

/** İstanbul 05:00 = New York 22:00 (önceki gün): gün anahtarı ve 21:00–23:00 sessizliği TESİS diliminden. */
async function tesisSaatiBolumu(o: Ortam): Promise<void> {
  o.saat.ayarla(Date.parse("2026-10-10T02:00:00Z"));
  const k = await tesisKur(o);
  try {
    const h = await hesapKur(o, k.tesisId, OZET_SIPARIS);
    await cihazKaydet(o, h);
    await ayarYaz(o, h, ayar({ sessiz: { acik: true, baslangic: "21:00", bitis: "23:00" } }));
    await anlikYaz(o, k.tesisId, "ozet.siparis", GECIKEN(3));
    await anlikYaz(o, k.tesisId, "tesis", { saatDilimi: "America/New_York" });
    const t = new RecordingTransport();
    const r = await tur(o, k.tesisId, t);
    const satir = (await bildirimler(o, k.tesisId, "geciken-siparis"))[0];
    kontrol("§6a ⭐ gün anahtarı tesis gününden (New York 09.10, İstanbul 10.10 değil)", satir?.dedupKey === "geciken-siparis:2026-10-09", satir?.dedupKey ?? "satır yok");
    kontrol("§6b ⭐ sessiz saat tesis saatinden: New York 22:00 sessizde → ertelendi, gitmedi", r.created === 1 && t.sent.length === 0 && satir?.status === "BEKLIYOR", JSON.stringify(r));
  } finally {
    await temizleTesis(o, k.tesisId);
  }
}

async function main(): Promise<void> {
  const o = await ortamKur();
  // Saat SABİT: İstanbul öğlesi (gün dönümü ve varsayılan gece sessizliği gerçek saate bağlı kalmasın).
  o.saat.ayarla(Date.parse("2026-10-01T09:00:00Z"));
  const k = await tesisKur(o);
  try {
    const a = await hesapKur(o, k.tesisId, OZET_SIPARIS);
    await cihazKaydet(o, a);
    await ayarYaz(o, a, ayar());
    await anlikYaz(o, k.tesisId, "ozet.siparis", GECIKEN(3));

    console.log("\n§1 tekrar gönderim yok");
    const t = new RecordingTransport();
    const r1 = await tur(o, k.tesisId, t);
    const r2 = await tur(o, k.tesisId, t);
    kontrol("§1a ⭐ ilk tur: geciken sipariş olayı doğdu ve gitti", r1.created === 1 && r1.sent === 1 && t.sent.length === 1, JSON.stringify(r1));
    kontrol("§1b ⭐ ikinci tur: AYNI olay yeniden doğmaz, yeniden gitmez", r2.created === 0 && t.sent.length === 1, JSON.stringify(r2));
    o.saat.ilerlet(DAY);
    const r3 = await tur(o, k.tesisId, t);
    kontrol("§1c pozitif: ertesi gün koşul sürüyorsa yeni gün anahtarıyla bir kez daha", r3.created === 1 && t.sent.length === 2);
    kontrol("§1d gönderilen mesaj rota taşır (dokununca ekran)", t.sent[0]?.msg.route === "/siparisler");

    console.log("\n§2 sessiz saat");
    o.saat.ilerlet(DAY);
    await ayarYaz(o, a, ayar({ sessiz: simdikiSessiz(o.saat.simdi(), 30) }));
    const s1 = await tur(o, k.tesisId, t);
    const bekleyen = (await bildirimler(o, k.tesisId)).at(-1)!;
    kontrol("§2a ⭐ sessiz pencerede GÖNDERİLMEZ", s1.sent === 0 && s1.deferred === 1 && t.sent.length === 2, JSON.stringify(s1));
    kontrol("§2b ertelenen satır BEKLIYOR, bitişe kurulu, deneme hakkı yanmadı", bekleyen.status === "BEKLIYOR" && bekleyen.attempts === 0 && bekleyen.nextAttemptAt.getTime() > o.saat.simdi());
    o.saat.ilerlet(10 * 60_000);
    const s2 = await tur(o, k.tesisId, t);
    kontrol("§2c pencere sürerken vadesi gelmemiş satır alınmaz", s2.sent === 0 && s2.deferred === 0);
    o.saat.ilerlet(25 * 60_000);
    const s3 = await tur(o, k.tesisId, t);
    kontrol("§2d ⭐ pozitif: bitişten sonra gider", s3.sent === 1 && t.sent.length === 3, JSON.stringify(s3));

    console.log("\n§3 kapalı tür / bildirim yok");
    o.saat.ilerlet(DAY);
    await ayarYaz(o, a, ayar({ turler: { "geciken-siparis": false } }));
    const k1 = await tur(o, k.tesisId, t);
    const son = (await bildirimler(o, k.tesisId)).at(-1)!;
    kontrol("§3a ⭐ kapalı türe gönderilmez (ATLANDI · TUR_KAPALI)", k1.sent === 0 && son.status === "ATLANDI" && son.skipReason === "TUR_KAPALI" && t.sent.length === 3);
    await ayarYaz(o, a, ayar());
    const k2 = await tur(o, k.tesisId, t);
    kontrol("§3b tür sonradan açılınca aynı günün eski olayı GİTMEZ", k2.created === 0 && k2.sent === 0 && t.sent.length === 3);
    o.saat.ilerlet(DAY);
    await ayarYaz(o, a, ayar({ acik: false }));
    await tur(o, k.tesisId, t);
    kontrol("§3c ⭐ 'bildirim yok' → hiçbir tür gitmez (BILDIRIM_KAPALI)", (await bildirimler(o, k.tesisId)).at(-1)!.skipReason === "BILDIRIM_KAPALI" && t.sent.length === 3);
    o.saat.ilerlet(DAY);
    await ayarYaz(o, a, null);
    const k3 = await tur(o, k.tesisId, t);
    kontrol("§3d pozitif: varsayılana dönen hesap (tür açık) alır", k3.sent === 1 && t.sent.length === 4, JSON.stringify(k3));

    console.log("\n§4 izin");
    const fin = await hesapKur(o, k.tesisId, ["bulut:cari-bakiye:oku", "bulut:cek:oku"]);
    const finsiz = await hesapKur(o, k.tesisId, ["bulut:ozet:oku", "bulut:cek:oku"]);
    const tf = new RecordingTransport();
    const tokFin = await cihazKaydet(o, fin);
    const tokFinsiz = await cihazKaydet(o, finsiz);
    for (const h of [fin, finsiz]) await ayarYaz(o, h, ayar({ esikler: { gecikenKalemUst: null } }));
    await anlikYaz(o, k.tesisId, "ozet-finans", { kasalar: [], bankalar: [], cekDurum: [], yaslandirma: [], cekVade: [{ kova: "SOON", tur: "ALINAN", doviz: "TRY", adet: 2, tutar: "45000.00" }] });
    await tur(o, k.tesisId, tf);
    const cek = await bildirimler(o, k.tesisId, "cek-vadesi");
    const finsizSatir = cek.find((n) => n.accountId === finsiz.accountId);
    kontrol("§4a ⭐ finans izni olmayan hesaba finans bildirimi GİTMEZ (IZIN_YOK)", finsizSatir?.skipReason === "IZIN_YOK" && !tf.sent.some((s) => s.target.token === tokFinsiz));
    kontrol("§4b pozitif: finans izinli hesap alır (tutar içerir)", tf.sent.some((s) => s.target.token === tokFin && s.msg.body.includes("45000.00")));
    kontrol("§4c izinsiz 'a' hesabı (sipariş izni) çek bildirimi almaz", cek.find((n) => n.accountId === a.accountId)?.skipReason === "IZIN_YOK");
    o.saat.ilerlet(DAY);
    await ayarYaz(o, fin, ayar({ esikler: { gecikenKalemUst: null }, sessiz: simdikiSessiz(o.saat.simdi(), 30) }));
    await tur(o, k.tesisId, tf);
    const dogan = (await bildirimler(o, k.tesisId, "cek-vadesi")).filter((n) => n.accountId === fin.accountId).at(-1)!;
    await withTesis(o.goc.prisma, { tesisId: k.tesisId }, (tx) => tx.account.update({ where: { id: fin.accountId }, data: { permissions: ["bulut:ozet:oku"] } }));
    const once = tf.sent.length;
    o.saat.ilerlet(40 * 60_000);
    await tur(o, k.tesisId, tf);
    const gec = (await bildirimler(o, k.tesisId, "cek-vadesi")).filter((n) => n.accountId === fin.accountId).at(-1)!;
    kontrol("§4d ⭐ doğuşta izinliydi (BEKLIYOR), izni düştü → gönderim anında GİTMEZ (IZIN_YOK)", dogan.status === "BEKLIYOR" && tf.sent.length === once && gec.skipReason === "IZIN_YOK", `${dogan.status} → ${gec.status}/${gec.skipReason}`);

    console.log("\n§5 gelen kutusu + eşik karşılaştırması");
    await gelenKutusuBolumu(o, k.tesisId, a, finsiz);

    console.log("\n§6 tesis saati (ANLIK tesis.saatDilimi)");
    await tesisSaatiBolumu(o);
  } finally {
    await temizleTesis(o, k.tesisId);
    await o.kapat();
  }
  sonuc();
}

/** §5 — gelen kutusu sonucu yalnız yazana gider; eşik = değer olay DOĞURMAZ (yalnız karşılaştırma). */
async function gelenKutusuBolumu(o: Ortam, tesisId: string, yazar: TestHesabi, baska: TestHesabi): Promise<void> {
  const t = new RecordingTransport();
  const tokYazar = await cihazKaydet(o, yazar);
  const mesajId = randomUUID();
  await withTesis(o.goc.prisma, { tesisId }, (tx) =>
    tx.inboxMessage.create({ data: { tesisId, messageId: mesajId, kind: "SIPARIS", body: {}, accountId: yazar.accountId, accountName: "Bekçi", status: "ISLENDI", processedAt: new Date(o.saat.simdi()), result: { siparisId: randomUUID() } } }),
  );
  await tur(o, tesisId, t);
  const satirlar = (await bildirimler(o, tesisId, "gelen-kutusu-sonucu")).filter((n) => n.dedupKey.includes(mesajId));
  kontrol("§5a ⭐ gelen kutusu sonucu yazana gider (rota mesaja)", satirlar.length === 1 && satirlar[0]!.accountId === yazar.accountId && t.sent.some((x) => x.target.token === tokYazar && x.msg.route === `/gelen-kutusu/${mesajId}`));
  kontrol("§5b başka hesaba gelen kutusu sonucu doğmaz", !satirlar.some((n) => n.accountId === baska.accountId));
  const gecikenSay = async () => (await bildirimler(o, tesisId, "geciken-siparis")).filter((n) => n.accountId === yazar.accountId).length;
  o.saat.ilerlet(DAY);
  await ayarYaz(o, yazar, ayar({ esikler: { gecikenKalemUst: 3 } }));
  const n0 = await gecikenSay();
  await tur(o, tesisId, t);
  kontrol("§5c eşik = değer (3 > 3 değil) → olay YOK", (await gecikenSay()) === n0);
  await ayarYaz(o, yazar, ayar({ esikler: { gecikenKalemUst: 2 } }));
  await tur(o, tesisId, t);
  kontrol("§5d pozitif: eşik 2 < 3 → olay doğar", (await gecikenSay()) === n0 + 1);
}

main().catch((e: Error) => {
  console.error(`❌ bekçi çöktü: ${e.stack ?? e.message}`);
  process.exit(1);
});
