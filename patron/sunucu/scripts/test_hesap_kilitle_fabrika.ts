// =============================================================================
// FABRİKADAN HESAP KİLİTLEME BEKÇİSİ (B6) — gerçek HTTP, imzalı fabrika kanalı `POST /v1/hesap-kilitle`:
//   §1 AKTIF → KILITLI; yanıt sözleşme şemasına uyar; kilitlenen hesabın oturumu KAPANIR
//   §2 aynı işlem kimliği + aynı gövde → saklı yanıt; başka gövde → 409 ISLEM_KIMLIGI_CAKISTI
//   §3 zaten KILITLI hesap → değişmeden döner (yeni işlem kimliğiyle de)
//   §4 başka tesisin hesabı → 404 BULUNAMADI (kiracı İMZADAN, gövdeden değil)
//   §5 son aktif hesap yöneticisi kilitlenemez → 409 SON_YONETICI (ikinci yönetici varken kilitlenir)
//   §6 KATI gövde (tanınmayan anahtar 400) · denetim satırı aktörü `fabrika:<kurulumId>`
// Koşum: npx tsx scripts/test_hesap_kilitle_fabrika.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withTesis } from "../src/lib/tenant";
import { AccountLockResponseSchema } from "../src/wire/esitleme";
import { api, hesapKur, imzali, kanonik, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, type Ortam, type TestKurulumu } from "./lib/test-ortam";

const YOL = "/v1/hesap-kilitle";
const YONETICI = ["bulut:hesap:yonet"];

function kilitle(o: Ortam, k: TestKurulumu, hesapId: string, islemKimligi = randomUUID(), isteyen = "Fabrika Yöneticisi") {
  return imzali(o, k, YOL, { govde: { v: 1, hesapId, islemKimligi, isteyen } });
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const k = await tesisKur(o);
  const yabanci = await tesisKur(o);
  try {
    const y1 = await hesapKur(o, k.tesisId, YONETICI);
    const y2 = await hesapKur(o, k.tesisId, YONETICI);
    const okur = await hesapKur(o, k.tesisId, ["bulut:siparis:oku"]);
    const disari = await hesapKur(o, yabanci.tesisId, ["bulut:siparis:oku"]);

    console.log("\n§1 AKTIF → KILITLI");
    const once = await api(o, "GET", "/api/oturum", { belirtec: okur.belirtec });
    kontrol("§1 körlük zemini: hesabın oturumu kilitten ÖNCE açık", once.status === 200, `${once.status}`);
    const islem = randomUUID();
    const r1 = await kilitle(o, k, okur.accountId, islem);
    const p1 = AccountLockResponseSchema.safeParse(r1.json);
    kontrol("§1a 200 + sözleşme şemasına uyar", r1.status === 200 && p1.success, `${r1.status} ${JSON.stringify(r1.json).slice(0, 160)}`);
    kontrol("§1b hesap KILITLI döner", p1.success && p1.data.hesap.durum === "KILITLI" && p1.data.hesap.id === okur.accountId);
    const sonra = await api(o, "GET", "/api/oturum", { belirtec: okur.belirtec });
    kontrol("§1c kilitlenen hesabın oturumu kullanılamaz", sonra.status === 401, `${sonra.status}`);
    const acik = await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.session.count({ where: { accountId: okur.accountId, closedAt: null } }));
    kontrol("§1d oturum satırı KAPATILDI (yalnız durum kapısına güvenilmez)", acik === 0, `açık ${acik}`);

    console.log("\n§2 işlem kimliği");
    const r2 = await kilitle(o, k, okur.accountId, islem);
    kontrol("§2a aynı kimlik + aynı gövde → saklı yanıt", r2.status === 200 && kanonik(r2.json) === kanonik(r1.json));
    const r3 = await kilitle(o, k, okur.accountId, islem, "Başka Biri");
    kontrol("§2b aynı kimlik + başka gövde → 409 ISLEM_KIMLIGI_CAKISTI", r3.status === 409 && r3.json.details?.code === "ISLEM_KIMLIGI_CAKISTI", `${r3.status}`);

    console.log("\n§3 zaten KILITLI");
    const r4 = await kilitle(o, k, okur.accountId);
    kontrol("§3 zaten KILITLI → 200, durum değişmeden KILITLI", r4.status === 200 && (r4.json as { hesap?: { durum?: string } }).hesap?.durum === "KILITLI", `${r4.status}`);

    console.log("\n§4 kiracı sınırı");
    const r5 = await kilitle(o, k, disari.accountId);
    kontrol("§4 başka tesisin hesabı → 404 BULUNAMADI", r5.status === 404 && r5.json.details?.code === "BULUNAMADI", `${r5.status}`);
    const disariDurum = await withTesis(o.goc, { tesisId: yabanci.tesisId }, (tx) => tx.account.findUnique({ where: { id: disari.accountId }, select: { status: true } }));
    kontrol("§4b başka tesisin hesabı DOKUNULMADI (AKTIF)", disariDurum?.status === "AKTIF", String(disariDurum?.status));

    console.log("\n§5 son aktif yönetici");
    const r6 = await kilitle(o, k, y1.accountId);
    kontrol("§5a ikinci yönetici varken yönetici kilitlenir", r6.status === 200, `${r6.status}`);
    const r7 = await kilitle(o, k, y2.accountId);
    kontrol("§5b son aktif yönetici → 409 SON_YONETICI", r7.status === 409 && r7.json.details?.code === "SON_YONETICI", `${r7.status} ${String(r7.json.details?.code)}`);

    console.log("\n§6 gövde + denetim");
    const r8 = await imzali(o, k, YOL, { govde: { v: 1, hesapId: y2.accountId, islemKimligi: randomUUID(), isteyen: "x", tesisId: yabanci.tesisId } });
    kontrol("§6a tanınmayan anahtar → 400 GOVDE_GECERSIZ", r8.status === 400 && r8.json.details?.code === "GOVDE_GECERSIZ", `${r8.status}`);
    const iz = await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.accountAudit.findMany({ where: { tesisId: k.tesisId, event: "HESAP_KILITLI", entityId: okur.accountId } }));
    kontrol("§6b denetim: aktör fabrika:<kurulumId>, kaynak fabrika", iz.length === 1 && iz[0]!.actor === `fabrika:${k.kurulumId}`, iz.map((x) => x.actor).join(","));
  } finally {
    await temizleTesis(o, k.tesisId);
    await temizleTesis(o, yabanci.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
