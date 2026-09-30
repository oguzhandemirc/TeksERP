// =============================================================================
// KAPANAN HESABIN KİMLİĞİ BEKÇİSİ (Ek-6/A §2.5) — saat ENJEKTE, gerçek HTTP:
//   §1 kapanış anı: PASIF geçişi `closed_at`ı AYNI claim'de yazar · oturumlar kapanır · DB CHECK PASIF ⇔ kapanış
//   §2 30. gün sınırı: kapanıştan 30 gün − 1 dk SİLİNMEZ (negatif) · tam 30. gün SİLİNİR (pozitif)
//   §3 ne silinir: ad/e-posta tombstone · parola/TOTP/davet NULL · oturum + cihaz satırı YOK · gelen kutusu yazar
//      adı tombstone · NE KALIR: satır ve kimliği, gelen kutusu hesap kimliği, durum PASIF, izinler · ayak izi
//   §4 kapsam: KILITLI (kapanmamış) hesap 60 günde bile silinmez · başka tesisin hesabı etkilenmez · ikinci tur etkisiz
//   §5 yeniden tanımlama kapısı: arşivdeki hesap düzenlenemez (409) · DB CHECK silinmiş hesaba parola yazdırmaz
//   §6 e-posta: silinmeden önce aynı e-postayla davet 409, silindikten sonra 201
//   §7 işlem makbuzu (ISLEM_SAKLAMA_GUN > 30 iken de): davet · güncelleme · gelen kutusu · fabrika kilidi · sıfırlama ·
//      kapanış makbuzları KALIR ama 30. günde hiçbirinde silinen hesabın e-postası/adı YOK (tombstone) · makbuzun
//      kimliği/eylemi/gövde özeti değişmez · aynı işlem kimliği tombstone'lu saklı yanıtı alır, başka gövde 409 ·
//      başka hesabın makbuzu dokunulmaz · ayak izi makbuz sayısını taşır
// Koşum: npx tsx scripts/test_kimlik_silme.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withTesis } from "../src/lib/tenant";
import { IDENTITY_PURGE_DAYS, purgeClosedIdentities, runDaily, tombstoneEmail, tombstoneName } from "../src/services/maintenance";
import { api, hesapKur, imzali, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, type Ortam } from "./lib/test-ortam";

const GUN = 86_400_000;
const YONETICI = ["bulut:hesap:yonet", "bulut:cari:yaz", "bulut:siparis:oku"];

async function hesap(o: Ortam, tesisId: string, id: string) {
  return withTesis(o.goc.prisma, { tesisId }, (tx) => tx.account.findUnique({ where: { id } }));
}

async function sayim(o: Ortam, tesisId: string, accountId: string) {
  return withTesis(o.goc.prisma, { tesisId }, async (tx) => ({
    oturum: await tx.session.count({ where: { tesisId, accountId } }),
    cihaz: await tx.pushDevice.count({ where: { tesisId, accountId } }),
    gelenKutusu: await tx.inboxMessage.findMany({ where: { tesisId, accountId }, select: { accountName: true, accountId: true } }),
  }));
}

async function durum(o: Ortam, belirtec: string, id: string, d: "AKTIF" | "KILITLI" | "PASIF") {
  return api(o, "POST", `/api/hesaplar/${id}/durum`, { belirtec, govde: { clientToken: randomUUID(), durum: d } });
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const a = await tesisKur(o);
  const b = await tesisKur(o);
  try {
    const yonetici = await hesapKur(o, a.tesisId, YONETICI);
    const hedef = await hesapKur(o, a.tesisId, YONETICI);
    const kilitli = await hesapKur(o, a.tesisId, ["bulut:siparis:oku"]);
    const digerTesis = await hesapKur(o, b.tesisId, YONETICI);
    const mesaj = await api(o, "POST", "/api/gelen-kutusu", { belirtec: hedef.belirtec, govde: { mesajId: randomUUID(), tur: "CARI", govde: { ad: "Kapanacak Hesabın Carisi", roller: { musteri: true, tedarikci: false } } } });
    const cihaz = await api(o, "POST", "/api/cihazlar", { belirtec: hedef.belirtec, govde: { platform: "android", belirtec: `ExponentPushToken[${randomUUID()}]`, ad: "Telefon" } });
    if (mesaj.status !== 201 || cihaz.status !== 201) throw new Error(`fikstür: mesaj ${mesaj.status} cihaz ${cihaz.status}`);

    console.log("\n§1 kapanış anı");
    const kapanis = o.saat.simdi();
    const r = await durum(o, yonetici.belirtec, hedef.accountId, "PASIF");
    const h1 = await hesap(o, a.tesisId, hedef.accountId);
    kontrol("§1a PASIF geçişi kapanış anını AYNI claim'de yazar", r.status === 200 && h1?.status === "PASIF" && h1.closedAt?.getTime() === kapanis, h1?.closedAt?.toISOString());
    kontrol("§1b kapanışta oturum kapanır (oturum 401)", (await api(o, "GET", "/api/oturum", { belirtec: hedef.belirtec })).status === 401);
    await durum(o, yonetici.belirtec, kilitli.accountId, "KILITLI");
    const check = await withTesis(o.goc.prisma, { tesisId: a.tesisId }, (tx) => tx.account.update({ where: { id: kilitli.accountId }, data: { closedAt: new Date() } })).then(() => "gecti", (e: Error) => /accounts_\w+_check/.exec(e.message)?.[0] ?? e.message.slice(0, 60));
    kontrol("§1c DB CHECK: PASIF olmayan hesaba kapanış anı yazılamaz (çift yüklem)", /accounts_closed_pair_check/.test(check), check.slice(0, 80));

    console.log("\n§2 30. gün sınırı");
    const sinir = kapanis + IDENTITY_PURGE_DAYS * GUN;
    const n0 = await purgeClosedIdentities(o.ctx, a.tesisId, sinir - 60_000);
    const h2 = await hesap(o, a.tesisId, hedef.accountId);
    kontrol("§2a 30 gün − 1 dk: SİLİNMEZ (negatif sınır)", n0 === 0 && h2?.email === hedef.eposta && h2.identityPurgedAt === null);
    const n1 = await purgeClosedIdentities(o.ctx, a.tesisId, sinir);
    kontrol("§2b tam 30. gün: SİLİNİR (pozitif sınır)", n1 === 1, String(n1));

    console.log("\n§3 ne silinir, ne kalır");
    const h3 = await hesap(o, a.tesisId, hedef.accountId);
    kontrol("§3a ad ve e-posta tombstone", h3?.name === tombstoneName(hedef.accountId) && h3.email === tombstoneEmail(hedef.accountId), `${h3?.name} · ${h3?.email}`);
    kontrol("§3b parola özeti · TOTP sırrı + adımı · davet NULL", h3?.passwordHash === null && h3.totpSecretSealed === null && h3.totpLastStep === null && h3.inviteTokenHash === null);
    kontrol("§3c satır ve kimlik KALIR (PASIF, izinler, kimlik silme anı)", h3?.id === hedef.accountId && h3.status === "PASIF" && h3.permissions.length === YONETICI.length && h3.identityPurgedAt?.getTime() === sinir);
    const s3 = await sayim(o, a.tesisId, hedef.accountId);
    kontrol("§3d oturum ve cihaz anahtarı satırı YOK", s3.oturum === 0 && s3.cihaz === 0, JSON.stringify({ oturum: s3.oturum, cihaz: s3.cihaz }));
    kontrol("§3e gelen kutusu: yazar adı tombstone, hesap kimliği aynı (iz kırılmaz)", s3.gelenKutusu.length === 1 && s3.gelenKutusu[0]!.accountName === tombstoneName(hedef.accountId) && s3.gelenKutusu[0]!.accountId === hedef.accountId);
    const liste = await api(o, "GET", "/api/gelen-kutusu", { belirtec: yonetici.belirtec });
    kontrol("§3f yönetici listesinde yazar 'Silinmiş hesap #…'", ((liste.json.data as { kayitlar: { hesapAdi: string }[] }).kayitlar ?? []).some((k) => k.hesapAdi === tombstoneName(hedef.accountId)));
    const iz = await withTesis(o.goc.prisma, { tesisId: a.tesisId }, (tx) => tx.accountAudit.findFirst({ where: { tesisId: a.tesisId, event: "HESAP_KIMLIGI_SILINDI", entityId: hedef.accountId } }));
    kontrol("§3g ayak izi HESAP_KIMLIGI_SILINDI (kategoriler + sayılar, kimlik içeriği yok)", iz?.actor === "sistem" && JSON.stringify(iz.summary).includes('"cihaz":1') && !JSON.stringify(iz.summary).includes(hedef.eposta));

    console.log("\n§4 kapsam");
    const n2 = await purgeClosedIdentities(o.ctx, a.tesisId, kapanis + 60 * GUN);
    const k4 = await hesap(o, a.tesisId, kilitli.accountId);
    kontrol("§4a KILITLI (kapanmamış) hesap 60 günde bile silinmez · ikinci tur etkisiz", n2 === 0 && k4?.email === kilitli.eposta && k4.status === "KILITLI");
    const d4 = await hesap(o, b.tesisId, digerTesis.accountId);
    kontrol("§4b başka tesisin hesabı etkilenmez", d4?.email === digerTesis.eposta && d4.identityPurgedAt === null);

    console.log("\n§5 yeniden tanımlama kapısı");
    const duzenle = await api(o, "PATCH", `/api/hesaplar/${hedef.accountId}`, { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), ad: "Geri Getirilen Ad" } });
    kontrol("§5a arşivdeki hesap düzenlenemez (409)", duzenle.status === 409 && duzenle.json.details?.code === "DURUM_CAKISMASI", String(duzenle.status));
    const sir = await withTesis(o.goc.prisma, { tesisId: a.tesisId }, (tx) => tx.account.update({ where: { id: hedef.accountId }, data: { passwordHash: "scrypt$x" } })).then(() => "gecti", (e: Error) => /accounts_\w+_check/.exec(e.message)?.[0] ?? e.message.slice(0, 60));
    kontrol("§5b DB CHECK: kimliği silinmiş hesaba parola yazılamaz", /accounts_purged_no_secret_check/.test(sir), sir.slice(0, 80));

    console.log("\n§6 e-posta yeniden kullanımı");
    const kapanacak = await hesapKur(o, a.tesisId, ["bulut:siparis:oku"]);
    await durum(o, yonetici.belirtec, kapanacak.accountId, "PASIF");
    const erken = await api(o, "POST", "/api/hesaplar", { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), eposta: kapanacak.eposta, ad: "Yeni", sablon: "SATIS" } });
    kontrol("§6a silinmeden önce aynı e-posta 409 EPOSTA_KULLANIMDA", erken.status === 409 && erken.json.details?.code === "EPOSTA_KULLANIMDA", String(erken.status));
    await purgeClosedIdentities(o.ctx, a.tesisId, o.saat.simdi() + IDENTITY_PURGE_DAYS * GUN);
    const sonra = await api(o, "POST", "/api/hesaplar", { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), eposta: kapanacak.eposta, ad: "Yeni", sablon: "SATIS" } });
    kontrol("§6b silindikten sonra aynı e-postayla davet 201", sonra.status === 201, String(sonra.status));

    console.log("\n§7 işlem makbuzu: kimlik tombstone, makbuz ve tekrar sözleşmesi KALIR (ISLEM_SAKLAMA_GUN > 30 iken de)");
    const m = await hesapKur(o, a.tesisId, ["bulut:cari:yaz"]);
    const mAd = `Makbuz Kişisi ${randomUUID().slice(0, 8)}`;
    const dEposta = `makbuz-${randomUUID().slice(0, 12)}@ornek.test`;
    const dAd = `Davetli Kişi ${randomUUID().slice(0, 8)}`;
    const digerAd = `Kalan Kişi ${randomUUID().slice(0, 8)}`;
    const kapatToken = randomUUID();
    const yonet = (method: string, yol: string, govde: unknown) => api(o, method, yol, { belirtec: yonetici.belirtec, govde });
    const adla = await yonet("PATCH", `/api/hesaplar/${m.accountId}`, { clientToken: randomUUID(), ad: mAd });
    const yazi = await api(o, "POST", "/api/gelen-kutusu", { belirtec: m.belirtec, govde: { mesajId: randomUUID(), tur: "CARI", govde: { ad: "Makbuz Carisi", roller: { musteri: true, tedarikci: false } } } });
    const kilit = await imzali(o, a, "/v1/hesap-kilitle", { govde: { v: 1, hesapId: m.accountId, islemKimligi: randomUUID(), isteyen: "Fabrika Yöneticisi" } });
    const sifirla = await yonet("POST", `/api/hesaplar/${m.accountId}/sifirla`, { clientToken: randomUUID() });
    const kapat = await yonet("POST", `/api/hesaplar/${m.accountId}/durum`, { clientToken: kapatToken, durum: "PASIF" });
    const davet = await yonet("POST", "/api/hesaplar", { clientToken: randomUUID(), eposta: dEposta, ad: dAd, sablon: "SATIS" });
    const davetId = (davet.json.data as { hesap?: { id?: string } } | undefined)?.hesap?.id ?? "";
    const dKapat = await durum(o, yonetici.belirtec, davetId, "PASIF");
    const diger = await yonet("PATCH", `/api/hesaplar/${kilitli.accountId}`, { clientToken: randomUUID(), ad: digerAd });
    const kodlar = [adla, yazi, kilit, sifirla, kapat, davet, dKapat, diger].map((x) => x.status);
    if (kodlar.join(",") !== "200,201,200,200,200,201,200,200") throw new Error(`§7 fikstür: ${kodlar.join(",")}`);
    const makbuzlar = () => withTesis(o.goc.prisma, { tesisId: a.tesisId }, (tx) => tx.operationReceipt.findMany({ where: { tesisId: a.tesisId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
    const kimlikler = [m.eposta, mAd, dEposta, dAd];
    const tasiyan = (rows: Awaited<ReturnType<typeof makbuzlar>>) => rows.filter((r) => kimlikler.some((k) => JSON.stringify(r.response).includes(k)));
    const once = await makbuzlar();
    kontrol("§7a fikstür: silinecek iki hesabın kimliğini taşıyan makbuz ≥ 7 (güncelleme · gelen kutusu · fabrika kilidi · sıfırlama · kapanış ×2 · davet)", tasiyan(once).length >= 7, tasiyan(once).map((r) => r.action).join(","));
    const t30 = o.saat.simdi() + IDENTITY_PURGE_DAYS * GUN;
    const silinen = await purgeClosedIdentities(o.ctx, a.tesisId, t30);
    const uzunSaklama = { ...o.ctx, config: { ...o.ctx.config, ISLEM_SAKLAMA_GUN: 45 } };
    await runDaily(uzunSaklama, t30);
    const kalan = await makbuzlar();
    kontrol("§7b 30. gün: iki hesabın kimliği silindi", silinen === 2, String(silinen));
    kontrol(
      "§7c ⭐ makbuzlar KALIR (ISLEM_SAKLAMA_GUN 45 — budama silmedi) ve hiçbirinde silinen hesabın e-postası/adı YOK",
      kalan.length === once.length && tasiyan(kalan).length === 0,
      `${once.length}→${kalan.length} · kimlik taşıyan: ${tasiyan(kalan).map((r) => r.action).join(",") || "yok"}`,
    );
    const kapanis7 = kalan.find((r) => r.clientToken === kapatToken)?.response as { id?: string; ad?: string; eposta?: string } | undefined;
    const gelen7 = kalan.find((r) => r.action === "GELEN_KUTUSU_CARI" && r.accountId === m.accountId)?.response as { hesapAdi?: string } | undefined;
    kontrol(
      "§7d yanıt biçimi kalır: hesap görünümünde kimlik aynı, ad/e-posta tombstone · gelen kutusu yazar adı tombstone",
      kapanis7?.id === m.accountId && kapanis7.ad === tombstoneName(m.accountId) && kapanis7.eposta === tombstoneEmail(m.accountId) && gelen7?.hesapAdi === tombstoneName(m.accountId),
      JSON.stringify({ kapanis7, gelen7 }).slice(0, 160),
    );
    const degismez = once.every((r) => {
      const k = kalan.find((x) => x.id === r.id);
      return !!k && k.accountId === r.accountId && k.action === r.action && k.bodyDigest === r.bodyDigest && k.responseStatus === r.responseStatus && k.clientToken === r.clientToken;
    });
    kontrol("§7e makbuzun işlem kimliği · sahibi · eylemi · gövde özeti · durum kodu DEĞİŞMEZ (tekrar kapısı onlara dayanır)", degismez);
    const tekrar = await yonet("POST", `/api/hesaplar/${m.accountId}/durum`, { clientToken: kapatToken, durum: "PASIF" });
    const cakisma = await yonet("POST", `/api/hesaplar/${m.accountId}/durum`, { clientToken: kapatToken, durum: "KILITLI" });
    kontrol(
      "§7f tekrar sözleşmesi: aynı işlem kimliği + gövde → saklı (tombstone'lu) yanıt · başka gövde → 409 ISLEM_KIMLIGI_CAKISTI",
      tekrar.status === 200 &&
        tekrar.headers.get("idempotent-replay") === "true" &&
        (tekrar.json.data as { eposta?: string } | undefined)?.eposta === tombstoneEmail(m.accountId) &&
        !JSON.stringify(tekrar.json).includes(m.eposta) &&
        cakisma.status === 409 &&
        cakisma.json.details?.code === "ISLEM_KIMLIGI_CAKISTI",
      `${tekrar.status} · ${cakisma.status} ${cakisma.json.details?.code ?? ""}`,
    );
    kontrol("§7g başka hesabın makbuzu dokunulmaz (adı ve e-postası aynen)", kalan.some((r) => JSON.stringify(r.response).includes(digerAd) && JSON.stringify(r.response).includes(kilitli.eposta)));
    const iz7 = await withTesis(o.goc.prisma, { tesisId: a.tesisId }, (tx) => tx.accountAudit.findFirst({ where: { tesisId: a.tesisId, event: "HESAP_KIMLIGI_SILINDI", entityId: m.accountId } }));
    kontrol("§7h ayak izi silinen hesabın makbuz sayısını taşır (5), kimlik içeriği yok", (iz7?.summary as { makbuz?: number } | null)?.makbuz === 5 && !JSON.stringify(iz7?.summary).includes(m.eposta), JSON.stringify(iz7?.summary));
  } finally {
    await temizleTesis(o, a.tesisId);
    await temizleTesis(o, b.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
