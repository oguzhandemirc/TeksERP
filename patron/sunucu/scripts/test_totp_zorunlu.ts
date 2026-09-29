// =============================================================================
// TOTP ZORUNLULUĞU + HESAP YAŞAM DÖNGÜSÜ BEKÇİSİ (sözleşme §9.4), gerçek HTTP:
//   §1 DB seddi: AKTİF hesap parola + TOTP sırrı + son adım OLMADAN doğamaz (CHECK) — koddan bağımsız
//   §2 davet: incele → kabul (TOTP sırrı YALNIZ canlı yanıtta) → onaysız giriş YOK → yanlış kod RED →
//      doğru kod AKTİF → davet tek kullanımlık (tekrar 404)
//   §3 giriş: totp alanı yoksa 400 · yanlış kod ve yanlış parola AYNI 401 iletisi · aynı kod ikinci
//      kez GEÇMEZ (adım kilidi) · eşik aşımında 429 GIRIS_KILITLI · kilit bitince doğru üçlü girer
//   §4 yönetici: davet (belirteç bir kez; tekrar yanıtı "gösterilemez") · kilitle → oturum düşer,
//      giriş YOK · sıfırla → DAVETLI, eski oturum 401 · SON AKTİF YÖNETİCİ düşürülemez (409) · kişi
//      kendi hesabını kilitleyemez · bilinmeyen izin 400 · yönetici olmayan 403
//   §5 parola değişimi TOTP ister; öteki oturumlar kapanır
// Koşum: npx tsx scripts/test_totp_zorunlu.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withTesis } from "../src/lib/tenant";
import { inviteFacilityAdmin } from "../src/services/vendor-admin.service";
import { TEST_PAROLASI, api, girisYap, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, totpKodu, type Ortam, type TestHesabi } from "./lib/test-ortam";

async function dbSeddi(o: Ortam, tesisId: string): Promise<void> {
  console.log("\n§1 DB seddi");
  let red = false;
  try {
    await withTesis(o.goc.prisma, { tesisId }, (tx) =>
      tx.account.create({ data: { tesisId, email: `sed-${randomUUID().slice(0, 8)}@ornek.test`, name: "Sed", permissions: [], status: "AKTIF", passwordHash: "scrypt$x" } }),
    );
  } catch (err) {
    red = /accounts_active_needs_totp_check/.test((err as Error).message) || /check constraint/i.test((err as Error).message);
  }
  kontrol("§1a TOTP sırrı olmadan AKTİF hesap DB'de doğamaz (CHECK)", red);
}

async function davetBolumu(o: Ortam, tesisId: string): Promise<void> {
  console.log("\n§2 davet akışı");
  const eposta = `davetli-${randomUUID().slice(0, 8)}@Ornek.Test`;
  const d = await inviteFacilityAdmin(o.goc.prisma, { tesisId, email: eposta, name: "Davetli Yönetici", validHours: 24 }, o.saat.simdi());
  const inc = await api(o, "POST", "/api/davet/incele", { govde: { davet: d.token } });
  kontrol("§2a incele: e-posta küçük harfe normalleşmiş, tesis adı", inc.status === 200 && (inc.json.data as { eposta?: string }).eposta === eposta.toLowerCase());
  const zayif = await api(o, "POST", "/api/davet/kabul", { govde: { davet: d.token, parola: "kisa" } });
  kontrol("§2b zayıf parola 400 PAROLA_ZAYIF", zayif.status === 400 && zayif.json.details?.code === "PAROLA_ZAYIF");
  const kabul = await api(o, "POST", "/api/davet/kabul", { govde: { davet: d.token, parola: TEST_PAROLASI } });
  const sir = (kabul.json.data as { totpSirri?: string; otpauth?: string }) ?? {};
  kontrol("§2c kabul: TOTP sırrı + otpauth YALNIZ bu yanıtta", kabul.status === 200 && typeof sir.totpSirri === "string" && /^otpauth:\/\/totp\//.test(sir.otpauth ?? ""));
  o.saat.ilerlet(31_000);
  const onaysiz = await api(o, "POST", "/api/oturum/ac", { govde: { eposta, parola: TEST_PAROLASI, totp: totpKodu(sir.totpSirri!, o.saat.simdi()) } });
  kontrol("§2d onaysız (DAVETLI) hesap GİREMEZ → 401", onaysiz.status === 401 && onaysiz.json.details?.code === "GIRIS_BASARISIZ");
  const yanlis = await api(o, "POST", "/api/davet/onay", { govde: { davet: d.token, totp: "000000" } });
  kontrol("§2e yanlış kodla onay RED", yanlis.status === 400);
  o.saat.ilerlet(31_000);
  const onay = await api(o, "POST", "/api/davet/onay", { govde: { davet: d.token, totp: totpKodu(sir.totpSirri!, o.saat.simdi()) } });
  kontrol("§2f doğru kodla onay → AKTİF", onay.status === 200 && (onay.json.data as { durum?: string }).durum === "AKTIF");
  const tekrar = await api(o, "POST", "/api/davet/incele", { govde: { davet: d.token } });
  kontrol("§2g davet tek kullanımlık: onaydan sonra 404 DAVET_GECERSIZ", tekrar.status === 404 && tekrar.json.details?.code === "DAVET_GECERSIZ");
  const sahte = await api(o, "POST", "/api/davet/incele", { govde: { davet: "x".repeat(43) } });
  kontrol("§2h uydurma davet 404", sahte.status === 404);
}

async function girisBolumu(o: Ortam, h: TestHesabi): Promise<void> {
  console.log("\n§3 giriş: TOTP zorunlu");
  const totpsuz = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: TEST_PAROLASI } });
  kontrol("§3a totp alanı yok → 400 (TOTP'siz oturum YOK)", totpsuz.status === 400);
  o.saat.ilerlet(31_000);
  const yanlisKod = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: TEST_PAROLASI, totp: "123456" } });
  o.saat.ilerlet(31_000);
  const yanlisParola = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: "yanlis-parola-uzun-123", totp: totpKodu(h.sir, o.saat.simdi()) } });
  const yok = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: "olmayan@ornek.test", parola: TEST_PAROLASI, totp: "123456" } });
  kontrol("§3b yanlış kod · yanlış parola · bilinmeyen hesap AYNI 401 iletisi", [yanlisKod, yanlisParola, yok].every((r) => r.status === 401 && r.json.message === yanlisKod.json.message));
  o.saat.ilerlet(31_000);
  const kod = totpKodu(h.sir, o.saat.simdi());
  const ok = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: TEST_PAROLASI, totp: kod } });
  const ayniKod = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: TEST_PAROLASI, totp: kod } });
  kontrol("§3c doğru üçlü 200 + belirteç", ok.status === 200 && typeof (ok.json.data as { belirtec?: string }).belirtec === "string");
  kontrol("§3d aynı TOTP kodu ikinci kez GEÇMEZ (adım kilidi)", ayniKod.status === 401);
  for (let i = 0; i < o.ctx.config.GIRIS_ESIGI; i++) {
    o.saat.ilerlet(31_000);
    await api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: TEST_PAROLASI, totp: "000001" } });
  }
  o.saat.ilerlet(31_000);
  const kilitli = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: TEST_PAROLASI, totp: totpKodu(h.sir, o.saat.simdi()) } });
  kontrol("§3e eşik aşımı → 429 GIRIS_KILITLI (doğru üçlü de girmez)", kilitli.status === 429 && kilitli.json.details?.code === "GIRIS_KILITLI");
  o.saat.ilerlet((o.ctx.config.KILIT_DK + 1) * 60_000);
  const acildi = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: h.eposta, parola: TEST_PAROLASI, totp: totpKodu(h.sir, o.saat.simdi()) } });
  kontrol("§3f kilit bitince doğru üçlü girer", acildi.status === 200);
  h.belirtec = (acildi.json.data as { belirtec: string }).belirtec;
}

async function yonetimBolumu(o: Ortam, tesisId: string, yonetici: TestHesabi, uye: TestHesabi): Promise<void> {
  console.log("\n§4 hesap yönetimi");
  const token = randomUUID();
  const govde = { clientToken: token, eposta: `ekip-${randomUUID().slice(0, 8)}@ornek.test`, ad: "Ekip Üyesi", sablon: "SATIS" };
  const d1 = await api(o, "POST", "/api/hesaplar", { belirtec: yonetici.belirtec, govde });
  const d2 = await api(o, "POST", "/api/hesaplar", { belirtec: yonetici.belirtec, govde });
  kontrol("§4a davet 201 + belirteç canlı yanıtta", d1.status === 201 && typeof (d1.json.data as { davet?: string }).davet === "string");
  kontrol("§4b tekrar yanıtı belirteci TAŞIMAZ (davetGosterilemez)", d2.status === 201 && (d2.json.data as { davet?: string; davetGosterilemez?: boolean }).davet === undefined && (d2.json.data as { davetGosterilemez?: boolean }).davetGosterilemez === true);
  const bilinmez = await api(o, "POST", "/api/hesaplar", { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), eposta: `x-${randomUUID().slice(0, 6)}@ornek.test`, ad: "X", izinler: ["bulut:super"] } });
  kontrol("§4c bilinmeyen izin → 400 IZIN_BILINMIYOR", bilinmez.status === 400 && bilinmez.json.details?.code === "IZIN_BILINMIYOR");
  const ayniEposta = await api(o, "POST", "/api/hesaplar", { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), eposta: uye.eposta, ad: "Kopya", sablon: "SATIS" } });
  kontrol("§4d aynı e-posta → 409 EPOSTA_KULLANIMDA", ayniEposta.status === 409 && ayniEposta.json.details?.code === "EPOSTA_KULLANIMDA");
  const yetkisiz = await api(o, "GET", "/api/hesaplar", { belirtec: uye.belirtec });
  kontrol("§4e yönetici olmayan → 403", yetkisiz.status === 403);
  const kendi = await api(o, "POST", `/api/hesaplar/${yonetici.accountId}/durum`, { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), durum: "KILITLI" } });
  kontrol("§4f kişi kendi hesabını kilitleyemez → 409", kendi.status === 409);
  const kilit = await api(o, "POST", `/api/hesaplar/${uye.accountId}/durum`, { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), durum: "KILITLI" } });
  const uyeOturum = await api(o, "GET", "/api/oturum", { belirtec: uye.belirtec });
  kontrol("§4g kilitle → üyenin açık oturumu 401", kilit.status === 200 && uyeOturum.status === 401);
  o.saat.ilerlet(31_000);
  const kilitliGiris = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: uye.eposta, parola: TEST_PAROLASI, totp: totpKodu(uye.sir, o.saat.simdi()) } });
  kontrol("§4h KİLİTLİ hesap giremez", kilitliGiris.status === 401);
  await api(o, "POST", `/api/hesaplar/${uye.accountId}/durum`, { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), durum: "AKTIF" } });
  uye.belirtec = await girisYap(o, uye);
  const sifirla = await api(o, "POST", `/api/hesaplar/${uye.accountId}/sifirla`, { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID() } });
  const eski = await api(o, "GET", "/api/oturum", { belirtec: uye.belirtec });
  kontrol("§4i sıfırla → DAVETLI + yeni davet, eski oturum 401", sifirla.status === 200 && (sifirla.json.data as { hesap?: { durum?: string } }).hesap?.durum === "DAVETLI" && eski.status === 401);
  // son yönetici: yöneticinin kendi izinlerinden hesap:yonet düşürülürse tesiste AKTİF yönetici kalmaz
  const adminler = await withTesis(o.goc.prisma, { tesisId }, (tx) => tx.account.findMany({ where: { tesisId, status: "AKTIF", permissions: { has: "bulut:hesap:yonet" } } }));
  const digerleri = adminler.filter((a) => a.id !== yonetici.accountId);
  for (const a of digerleri) {
    await api(o, "PATCH", `/api/hesaplar/${a.id}`, { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), izinler: ["bulut:siparis:oku"] } });
  }
  const son = await api(o, "PATCH", `/api/hesaplar/${yonetici.accountId}`, { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), izinler: ["bulut:siparis:oku"] } });
  kontrol("§4j SON AKTİF YÖNETİCİ düşürülemez → 409 SON_YONETICI", son.status === 409 && son.json.details?.code === "SON_YONETICI", `${digerleri.length} diğer yönetici düşürüldü`);
  const denetim = await api(o, "GET", "/api/hesaplar/denetim", { belirtec: yonetici.belirtec });
  const olaylar = (denetim.json.data as { kayitlar: { olay: string }[] }).kayitlar.map((x) => x.olay);
  kontrol("§4k bulut denetimi yazıldı (davet · kilit · sıfırlama · giriş)", ["HESAP_DAVET", "HESAP_KILITLI", "HESAP_SIFIRLANDI", "GIRIS"].every((e) => olaylar.includes(e)));
  kontrol("§4l denetim özetinde sır YOK (davet belirteci, parola)", !JSON.stringify(denetim.json).includes((d1.json.data as { davet: string }).davet) && !JSON.stringify(denetim.json).includes(TEST_PAROLASI));
}

async function parolaBolumu(o: Ortam, h: TestHesabi): Promise<void> {
  console.log("\n§5 parola değişimi");
  const ikinci = await girisYap(o, h);
  o.saat.ilerlet(31_000);
  const totpsuz = await api(o, "POST", "/api/oturum/parola", { belirtec: h.belirtec, govde: { mevcutParola: TEST_PAROLASI, yeniParola: "yeni-bulut-parolasi-2026", totp: "000000" } });
  kontrol("§5a yanlış TOTP ile parola değişmez", totpsuz.status === 400);
  o.saat.ilerlet(31_000);
  const ok = await api(o, "POST", "/api/oturum/parola", { belirtec: h.belirtec, govde: { mevcutParola: TEST_PAROLASI, yeniParola: "yeni-bulut-parolasi-2026", totp: totpKodu(h.sir, o.saat.simdi()) } });
  const oteki = await api(o, "GET", "/api/oturum", { belirtec: ikinci });
  const bu = await api(o, "GET", "/api/oturum", { belirtec: h.belirtec });
  kontrol("§5b doğru TOTP ile değişir; öteki oturum kapanır, bu oturum sürer", ok.status === 200 && oteki.status === 401 && bu.status === 200);
}

async function main(): Promise<void> {
  // Giriş hız sınırı (IP başına, gerçek saat) bu bekçinin onlarca girişini kesmesin — kilit ölçülüyor.
  const o = await ortamKur({ GIRIS_HIZ_DK: "1000" });
  const k = await tesisKur(o);
  try {
    await dbSeddi(o, k.tesisId);
    await davetBolumu(o, k.tesisId);
    const yonetici = await hesapKur(o, k.tesisId, ["bulut:hesap:yonet", "bulut:siparis:oku"]);
    const uye = await hesapKur(o, k.tesisId, ["bulut:siparis:oku"]);
    const girisci = await hesapKur(o, k.tesisId, ["bulut:siparis:oku"]);
    await girisBolumu(o, girisci);
    await yonetimBolumu(o, k.tesisId, yonetici, uye);
    await parolaBolumu(o, girisci);
  } finally {
    await temizleTesis(o, k.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
