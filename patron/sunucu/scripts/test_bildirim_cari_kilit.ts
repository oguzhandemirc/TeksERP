// =============================================================================
// BİLDİRİM BEKÇİSİ — CARİ KİLİDİ (D4-I6; tasarım DALGA4 §10.8 + §12.2)
//   §1 saf: AKTİF kilit → `cari-kilit:<kilitId>`; açılış yalnız koyması o hesaba doğmuşsa `…:acildi`; BULUT HESAP
//      YAPMAZ — kilit tarihleri geçmiş/gelecek fark etmez (tarih karşılaştırması yok); eski fabrika (alan yok) /
//      bozuk alan → olay yok
//   §2 ⭐ uçtan uca: kilit konunca bir bildirim (adı + kapsam + sebep etiketi), ikinci turda AYNI kilit için ikinci
//      bildirim YOK; açılınca bir "açıldı" bildirimi, tekrar yok; yeni kilit yeni anahtar
//   §3 izinsiz hesap (`bulut:cari-bakiye:oku` yok) → ATLANDI · IZIN_YOK
//   §4 bulutun hiç AKTİF görmediği (devreye alınıştan önce açılmış) kilit → açılış bildirimi YOK
//   §6 ⭐ bakım budaması saklama süresi dolan cari-kilit satırını SİLMEZ → AKTİF kilit yeniden bildirilmez
//   §5 eski uygulama: `cari-kilit` anahtarı OLMAYAN ayar gövdesi 200 (eksik tür varsayılandan); tanınmayan tür 400
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): `cariLockText` koyma anahtarına tur sayacı eklendi
//    (`cari-kilit:<id>:<Date.now()>`) → §1a + §2a + §2b + §2c + §4a ❌ (9/5); geri alındı → 14/0.
//    Bakım budamasından `kind: { not: CARI_LOCK_KIND }` kaldırıldı → §6a ❌ (14/1; aynı kilit 2. kez); geri alındı → 15/0.
// Koşum: npx tsx scripts/test_bildirim_cari_kilit.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withTesis } from "../src/lib/tenant";
import { RecordingTransport } from "../src/push/transports";
import { runDaily } from "../src/services/maintenance";
import { asCariLock, cariLockText, type CariLockFact } from "../src/services/notification-cari-lock";
import type { CariLock } from "../src/wire/api";
import { ayar, ayarYaz, bildirimler, cihazKaydet, tur } from "./lib/bildirim-fikstur";
import { api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, type Ortam } from "./lib/test-ortam";

const KILIT = (g: Partial<CariLock> = {}): CariLock => ({
  durum: "AKTIF", kilitId: randomUUID(), kapsam: ["SEVK", "FATURA"], sebepKodu: "BORC", baslangic: "2026-10-01T08:00:00.000Z", acilis: null, ...g,
});

function safBolum(): void {
  console.log("\n§1 saf değerlendirme");
  const k = KILIT();
  const f: CariLockFact = { kilit: k, cariKartId: "kart-1", ad: "Örnek Tekstil" };
  const a = cariLockText(f, "h1", new Set());
  kontrol("§1a ⭐ AKTİF → anahtar = cari-kilit:<kilitId>, metin ad + kapsam + sebep etiketi",
    a?.dedupKey === `cari-kilit:${k.kilitId}` && a.body === "Örnek Tekstil: sevk · fatura onayı durduruldu (Borç)" && a.route === "/cariler/kart-1", JSON.stringify(a));
  const acik: CariLockFact = { ...f, kilit: { ...k, durum: "ACILDI", acilis: "2026-10-02T08:00:00.000Z" } };
  kontrol("§1b açılış: koyma bu hesaba doğmamışsa olay YOK", cariLockText(acik, "h1", new Set()) === null);
  const ac = cariLockText(acik, "h1", new Set([`h1|cari-kilit:${k.kilitId}`]));
  kontrol("§1c açılış: koyma doğmuşsa anahtar …:acildi", ac?.dedupKey === `cari-kilit:${k.kilitId}:acildi` && ac.title === "Cari kilidi açıldı");
  const eski = cariLockText({ ...f, kilit: { ...k, baslangic: "1990-01-01T00:00:00.000Z" } }, "h1", new Set());
  const ileri = cariLockText({ ...f, kilit: { ...k, baslangic: "2099-01-01T00:00:00.000Z" } }, "h1", new Set());
  kontrol("§1d ⭐ bulut hesap yapmaz: tarih ne olursa olsun aynı olay (tarih karşılaştırması yok)", JSON.stringify(eski) === JSON.stringify(a) && JSON.stringify(ileri) === JSON.stringify(a));
  kontrol("§1e eski fabrika (alan yok) ve bozuk alan → olay yok", asCariLock(undefined) === null && asCariLock(null) === null && asCariLock({ durum: "X", kilitId: "1", kapsam: [], sebepKodu: "B" }) === null);
  kontrol("§1f bilinmeyen kod olduğu gibi (bulut kod kataloğu türetmez)", cariLockText({ ...f, ad: null, kilit: { ...k, kapsam: ["YENI"], sebepKodu: "ZZ" } }, "h1", new Set())?.body === "Bir cari: YENI durduruldu (ZZ)");
}

async function kayitYaz(o: Ortam, tesisId: string, projeksiyon: string, recordId: string, veri: unknown): Promise<void> {
  await withTesis(o.goc, { tesisId, projections: [projeksiyon] }, (tx) => tx.$executeRaw`
    INSERT INTO projection_rows (tesis_id, projection, record_id, data, version_at, sort_at, updated_at)
    VALUES (${tesisId}::uuid, ${projeksiyon}, ${recordId}::uuid, ${JSON.stringify(veri)}::jsonb, now(), now(), now())
    ON CONFLICT (tesis_id, projection, record_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`);
}

async function main(): Promise<void> {
  safBolum();
  const o = await ortamKur();
  o.saat.ayarla(Date.parse("2026-10-01T09:00:00Z"));
  const k = await tesisKur(o);
  try {
    const fin = await hesapKur(o, k.tesisId, ["bulut:cari-bakiye:oku"]);
    const ozet = await hesapKur(o, k.tesisId, ["bulut:ozet:oku"]);
    await cihazKaydet(o, fin);
    await ayarYaz(o, fin, ayar());
    await ayarYaz(o, ozet, ayar());
    const kart = randomUUID();
    const hesap = randomUUID();
    await kayitYaz(o, k.tesisId, "cari-kart", kart, { id: kart, ad: "Bekçi Tekstil", kod: "BK1" });
    const k1 = KILIT();
    await kayitYaz(o, k.tesisId, "cari-hesap", hesap, { id: hesap, tur: "CUSTOMER", cariKartId: kart, aktif: true, kilit: k1 });

    console.log("\n§2 uçtan uca");
    const t = new RecordingTransport();
    await tur(o, k.tesisId, t);
    const r2 = await tur(o, k.tesisId, t);
    const satir = (await bildirimler(o, k.tesisId, "cari-kilit")).filter((n) => n.accountId === fin.accountId);
    kontrol("§2a ⭐ kilit konunca tek bildirim, anahtar = cari-kilit:<kilitId>, gönderildi", satir.length === 1 && satir[0]!.dedupKey === `cari-kilit:${k1.kilitId}` && t.sent.length === 1 && t.sent[0]!.msg.body.includes("Bekçi Tekstil"), JSON.stringify(satir.map((s) => s.dedupKey)));
    kontrol("§2b ⭐ ikinci tur: AYNI kilit için ikinci bildirim YOK", r2.created === 0 && t.sent.length === 1, JSON.stringify(r2));
    await kayitYaz(o, k.tesisId, "cari-hesap", hesap, { id: hesap, tur: "CUSTOMER", cariKartId: kart, aktif: true, kilit: { ...k1, durum: "ACILDI", acilis: "2026-10-01T10:00:00.000Z" } });
    await tur(o, k.tesisId, t);
    const r4 = await tur(o, k.tesisId, t);
    const acil = (await bildirimler(o, k.tesisId, "cari-kilit")).filter((n) => n.accountId === fin.accountId && n.dedupKey === `cari-kilit:${k1.kilitId}:acildi`);
    kontrol("§2c açılınca bir 'açıldı' bildirimi; tekrar turda yok", acil.length === 1 && t.sent.length === 2 && r4.created === 0, `${acil.length}/${t.sent.length}/${r4.created}`);
    const k2 = KILIT({ kapsam: ["KABUL"], sebepKodu: "RISK" });
    await kayitYaz(o, k.tesisId, "cari-hesap", hesap, { id: hesap, tur: "CUSTOMER", cariKartId: kart, aktif: true, kilit: k2 });
    await tur(o, k.tesisId, t);
    kontrol("§2d yeni kilit → yeni anahtarla bir bildirim", t.sent.length === 3 && t.sent[2]!.msg.body.includes("yeni iş kabulü") && t.sent[2]!.msg.body.includes("Risk"));

    console.log("\n§3 izin");
    const ozetSatir = (await bildirimler(o, k.tesisId, "cari-kilit")).filter((n) => n.accountId === ozet.accountId);
    kontrol("§3a ⭐ cari bakiye izni olmayan hesaba gitmez (ATLANDI · IZIN_YOK)", ozetSatir.length > 0 && ozetSatir.every((n) => n.status === "ATLANDI" && n.skipReason === "IZIN_YOK"));

    console.log("\n§4 hiç görülmemiş açılış");
    const hesap2 = randomUUID();
    const eskiKilit = KILIT({ durum: "ACILDI", acilis: "2026-09-01T00:00:00.000Z" });
    await kayitYaz(o, k.tesisId, "cari-hesap", hesap2, { id: hesap2, tur: "CUSTOMER", cariKartId: kart, aktif: true, kilit: eskiKilit });
    const r5 = await tur(o, k.tesisId, t);
    kontrol("§4a devreye alınıştan önce açılmış kilit → bildirim YOK", r5.created === 0 && !(await bildirimler(o, k.tesisId, "cari-kilit")).some((n) => n.dedupKey.includes(eskiKilit.kilitId)));

    console.log("\n§6 bakım budaması");
    const eski = new Date(o.saat.simdi() - (o.ctx.config.BILDIRIM_SAKLAMA_GUN + 1) * 86_400_000);
    await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.$executeRaw`UPDATE notifications SET updated_at = ${eski}::timestamptz WHERE tesis_id = ${k.tesisId}::uuid AND kind = 'cari-kilit'`);
    await runDaily(o.ctx, o.saat.simdi());
    const r6 = await tur(o, k.tesisId, t);
    const k2Satir = (await bildirimler(o, k.tesisId, "cari-kilit")).filter((n) => n.accountId === fin.accountId && n.dedupKey === `cari-kilit:${k2.kilitId}`);
    kontrol("§6a ⭐ saklama süresi dolsa da cari-kilit satırı budanmaz; sonraki turda AKTİF kilit yeniden bildirilmez", k2Satir.length === 1 && r6.created === 0 && t.sent.length === 3, `${k2Satir.length}/${r6.created}/${t.sent.length}`);

    console.log("\n§5 eski uygulama ayar gövdesi");
    const eskiGovde = ayar() as unknown as { turler: Record<string, boolean> };
    const { "cari-kilit": _yok, ...eskiTurler } = eskiGovde.turler;
    void _yok;
    const eskiYanit = await api(o, "POST", "/api/bildirim/ayarlar", { belirtec: fin.belirtec, govde: { ayarlar: { ...eskiGovde, turler: eskiTurler } } });
    kontrol("§5a ⭐ `cari-kilit` anahtarsız (eski uygulama) ayar → 200", eskiYanit.status === 200, String(eskiYanit.status));
    const yanlis = await api(o, "POST", "/api/bildirim/ayarlar", { belirtec: fin.belirtec, govde: { ayarlar: { ...eskiGovde, turler: { ...eskiGovde.turler, "uydurma-tur": true } } } });
    kontrol("§5b tanınmayan tür yine 400", yanlis.status === 400, String(yanlis.status));
  } finally {
    await temizleTesis(o, k.tesisId);
    await o.kapat();
  }
  sonuc();
}

void main();
