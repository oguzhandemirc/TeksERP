// =============================================================================
// E-POSTA TEKİLLİĞİ BEKÇİSİ (G19) — bulut genelinde tekillik YALNIZ etkin hesapta, başka tesisin varlığı sızmaz.
// Gerçek HTTP; üç tesis, aynı e-posta:
//   §1 davet başka tesisi SORMAZ: A'da AKTİF olan e-posta B'de davet edilir (201, yanıt taze e-postayla aynı biçim)
//   §2 onayda çakışma GENEL iletiyle reddedilir (409 DAVET_ETKINLESTIRILEMEDI; tesis/hesap adı yok) · B'deki hesap
//      DAVETLI kalır · A etkilenmez · B'nin ayak izi sebepsiz
//   §3 arşiv e-postayı TUTMAZ: A'daki hesap PASİF olunca B'deki aynı davet onaylanır · giriş B'ye çözülür
//   §4 davet e-postayı TUTMAZ: C'de bekleyen DAVETLİ varken başka tesiste etkinleştirme engellenmez · giriş
//      DAVETLİ/PASİF satırı aday saymaz
//   §5 aynı tesiste PASİF olmayan iki hesap aynı e-postayı taşıyamaz (409 EPOSTA_KULLANIMDA) · arşivlenenin
//      e-postası aynı tesiste yeniden davet edilir · DB seddi: kısmi UNIQUE'ler doğrudan SQL'le de geçilmez
// Koşum: npx tsx scripts/test_eposta_tekilligi.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withTesis } from "../src/lib/tenant";
import { TEST_PAROLASI, api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, totpKodu, type Ortam, type TestHesabi, type Yanit } from "./lib/test-ortam";

const YONETICI = ["bulut:hesap:yonet", "bulut:siparis:oku"];

async function davet(o: Ortam, yonetici: TestHesabi, eposta: string): Promise<Yanit> {
  return api(o, "POST", "/api/hesaplar", { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), eposta, ad: "Ortak Kişi", sablon: "SATIS" } });
}

/** Davet kabul + onay; onay yanıtı ve TOTP sırrı. */
async function etkinlestir(o: Ortam, token: string): Promise<{ onay: Yanit; sir: string }> {
  const kabul = await api(o, "POST", "/api/davet/kabul", { govde: { davet: token, parola: TEST_PAROLASI } });
  const sir = (kabul.json.data as { totpSirri: string }).totpSirri;
  o.saat.ilerlet(31_000);
  const onay = await api(o, "POST", "/api/davet/onay", { govde: { davet: token, totp: totpKodu(sir, o.saat.simdi()) } });
  return { onay, sir };
}

async function giris(o: Ortam, eposta: string, sir: string): Promise<Yanit> {
  o.saat.ilerlet(31_000);
  return api(o, "POST", "/api/oturum/ac", { govde: { eposta, parola: TEST_PAROLASI, totp: totpKodu(sir, o.saat.simdi()) } });
}

const hesapDurumu = async (o: Ortam, tesisId: string, id: string) => withTesis(o.goc.prisma, { tesisId }, async (tx) => (await tx.account.findUniqueOrThrow({ where: { id } })).status);

async function main(): Promise<void> {
  const o = await ortamKur({ GIRIS_HIZ_DK: "1000" });
  const a = await tesisKur(o, { ad: "Bekçi A Dokuma" });
  const b = await tesisKur(o, { ad: "Bekçi B Tekstil" });
  const c = await tesisKur(o, { ad: "Bekçi C Örme" });
  try {
    const ya = await hesapKur(o, a.tesisId, YONETICI);
    const yb = await hesapKur(o, b.tesisId, YONETICI);
    const yc = await hesapKur(o, c.tesisId, YONETICI);
    const ortak = await hesapKur(o, a.tesisId, ["bulut:siparis:oku"]);

    console.log("\n§1 davet başka tesisi sormaz");
    const dB = await davet(o, yb, ortak.eposta);
    const taze = await davet(o, yb, `taze-${randomUUID().slice(0, 8)}@ornek.test`);
    const bicim = (r: Yanit) => Object.keys((r.json.data as Record<string, unknown>) ?? {}).sort().join(",");
    kontrol("§1a ⭐ A'da AKTİF e-posta B'de davet edilir → 201 (409 yok: varlık sızmaz)", dB.status === 201, `${dB.status} ${dB.json.details?.code ?? ""}`);
    kontrol("§1b yanıt biçimi taze e-postayla aynı", dB.status === taze.status && bicim(dB) === bicim(taze), bicim(dB));
    const tokenB = (dB.json.data as { davet: string; hesap: { id: string } }).davet;
    const hesapB = (dB.json.data as { hesap: { id: string } }).hesap.id;

    console.log("\n§2 onayda genel ret");
    const r2 = await etkinlestir(o, tokenB);
    const ileti = r2.onay.json.message ?? "";
    kontrol("§2a ⭐ onay → 409 DAVET_ETKINLESTIRILEMEDI", r2.onay.status === 409 && r2.onay.json.details?.code === "DAVET_ETKINLESTIRILEMEDI", `${r2.onay.status} ${r2.onay.json.details?.code}`);
    kontrol("§2b ileti başka tesisi/hesabı ANMAZ (tesis adı · 'zaten var' · 'başka tesis' yok)", !/Bekçi A|zaten var|başka (bir )?tesis/i.test(ileti) && ileti.length > 0, ileti);
    kontrol("§2c B'deki hesap DAVETLİ kalır · A'daki hesap AKTİF", (await hesapDurumu(o, b.tesisId, hesapB)) === "DAVETLI" && (await hesapDurumu(o, a.tesisId, ortak.accountId)) === "AKTIF");
    const izB = await withTesis(o.goc.prisma, { tesisId: b.tesisId }, (tx) => tx.accountAudit.findFirst({ where: { tesisId: b.tesisId, entityId: hesapB, event: "DAVET_ETKINLESTIRILEMEDI" } }));
    kontrol("§2d B'nin ayak izi sebepsiz (özette tesis/hesap bilgisi yok)", izB !== null && (izB.summary === null || JSON.stringify(izB.summary) === "{}" || JSON.stringify(izB.summary) === "null"), JSON.stringify(izB?.summary));
    const girisA = await giris(o, ortak.eposta, ortak.sir);
    kontrol("§2e e-posta hâlâ A'daki etkin hesaba çözülür", girisA.status === 200 && (girisA.json.data as { tesisId?: string }).tesisId === a.tesisId);

    console.log("\n§3 arşiv e-postayı tutmaz");
    const arsiv = await api(o, "POST", `/api/hesaplar/${ortak.accountId}/durum`, { belirtec: ya.belirtec, govde: { clientToken: randomUUID(), durum: "PASIF" } });
    o.saat.ilerlet(31_000);
    const onay2 = await api(o, "POST", "/api/davet/onay", { govde: { davet: tokenB, totp: totpKodu(r2.sir, o.saat.simdi()) } });
    kontrol("§3a ⭐ A'daki hesap PASİF → B'deki aynı davet onaylanır (AKTİF)", arsiv.status === 200 && onay2.status === 200 && (onay2.json.data as { durum?: string }).durum === "AKTIF", `${arsiv.status}/${onay2.status}`);
    const girisB = await giris(o, ortak.eposta, r2.sir);
    kontrol("§3b giriş artık B'deki hesaba çözülür", girisB.status === 200 && (girisB.json.data as { tesisId?: string }).tesisId === b.tesisId);

    console.log("\n§4 davet e-postayı tutmaz; giriş yalnız etkin hesaba çözülür");
    const yeni = `isgal-${randomUUID().slice(0, 8)}@ornek.test`;
    const dC = await davet(o, yc, yeni);
    const dA = await davet(o, ya, yeni);
    const rA = await etkinlestir(o, (dA.json.data as { davet: string }).davet);
    kontrol("§4a ⭐ C'de bekleyen DAVETLİ varken A'da aynı e-posta etkinleşir (davet işgal etmez)", dC.status === 201 && dA.status === 201 && rA.onay.status === 200, `${dC.status}/${dA.status}/${rA.onay.status}`);
    const gA = await giris(o, yeni, rA.sir);
    kontrol("§4b giriş DAVETLİ (C) satırını aday saymaz → A'ya çözülür", gA.status === 200 && (gA.json.data as { tesisId?: string }).tesisId === a.tesisId);
    const gPasif = await giris(o, ortak.eposta, ortak.sir);
    kontrol("§4c PASİF (A) satırın eski sırrı girmez (aday değil) — 401", gPasif.status === 401);

    console.log("\n§5 tesis içi tekillik + DB seddi");
    const ikinci = await davet(o, yb, ortak.eposta);
    kontrol("§5a aynı tesiste PASİF olmayan hesap varken aynı e-posta → 409 EPOSTA_KULLANIMDA", ikinci.status === 409 && ikinci.json.details?.code === "EPOSTA_KULLANIMDA", `${ikinci.status}`);
    const yeniden = await davet(o, ya, ortak.eposta);
    kontrol("§5b arşivlenenin e-postası aynı tesiste (A) yeniden davet edilir → 201", yeniden.status === 201, `${yeniden.status}`);
    const sed = async (tesisId: string, status: "DAVETLI" | "AKTIF") =>
      withTesis(o.goc.prisma, { tesisId }, (tx) =>
        tx.$executeRaw`INSERT INTO accounts (id, tesis_id, email, name, permissions, status, password_hash, totp_secret_sealed, totp_last_step, updated_at)
          VALUES (gen_random_uuid(), ${tesisId}::uuid, ${ortak.eposta}, 'Sed', '{}', ${status}::"AccountStatus", 'scrypt$x', 'x', 1, now())`,
      ).then(() => "gecti", (e: Error) => /accounts_\w+_key/.exec(e.message)?.[0] ?? e.message.slice(0, 80));
    const tesisIci = await sed(b.tesisId, "DAVETLI");
    const genel = await sed(c.tesisId, "AKTIF");
    kontrol("§5c ⭐ DB seddi: aynı tesiste ikinci PASİF-olmayan satır (tesis_email) · başka tesiste ikinci ETKİN satır (email_etkin) doğrudan SQL'le de RED", tesisIci === "accounts_tesis_email_key" && genel === "accounts_email_etkin_key", `${tesisIci} · ${genel}`);
  } finally {
    for (const t of [a, b, c]) await temizleTesis(o, t.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
