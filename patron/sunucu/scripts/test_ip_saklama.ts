// =============================================================================
// ERİŞİM (IP) KAYDI BEKÇİSİ (Ek-6/A §2.4, Ek-3 D: "30 gün", zaman bazlı) — gerçek HTTP, vekil başlığıyla:
//   §1 giriş olayları istemci adresini taşır: GIRIS · GIRIS_BASARISIZ · GIRIS_REDDEDILDI (vekil başlığından)
//   §2 30. gün sınırı: olaydan 30 gün − 1 dk sonra IP DURUR (negatif) · tam 30. gün IP alanı SİLİNİR (pozitif);
//      olay satırı ve öteki alanları (oturum, istemci) KALIR · IP'siz olay dokunulmaz · başka tesis etkilenmez
//   §3 hesap güvenlik kaydı ekranı (API) IP'yi 30 gün gösterir, sonra göstermez
//   §4 uygulamanın erişim günlüğü satırı IP ve sorgu dizgisi TAŞIMAZ (yöntem + yol + durum + süre)
// Koşum: npx tsx scripts/test_ip_saklama.ts
// =============================================================================
import { withTesis } from "../src/lib/tenant";
import { IP_RETENTION_DAYS, stripAgedIps } from "../src/services/maintenance";
import { TEST_PAROLASI, api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, totpKodu, type Ortam, type TestHesabi } from "./lib/test-ortam";

const GUN = 86_400_000;
const BASLIK = "x-bekci-ip";

async function girisIp(o: Ortam, h: Pick<TestHesabi, "eposta" | "sir">, ip: string, parola = TEST_PAROLASI): Promise<number> {
  o.saat.ilerlet(31_000);
  const res = await fetch(`${o.adres}/api/oturum/ac?izle=gizli`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [BASLIK]: ip },
    body: JSON.stringify({ eposta: h.eposta, parola, totp: totpKodu(h.sir, o.saat.simdi()) }),
  });
  await res.text();
  return res.status;
}

async function olay(o: Ortam, tesisId: string, event: string, entityId: string) {
  return withTesis(o.goc, { tesisId }, (tx) => tx.accountAudit.findFirst({ where: { tesisId, event, entityId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));
}
const ipOf = (summary: unknown): unknown => (summary && typeof summary === "object" ? (summary as Record<string, unknown>).ip : undefined);

async function main(): Promise<void> {
  const o = await ortamKur({ VEKIL_IP_BASLIGI: BASLIK, GUVENILIR_VEKIL_AGLARI: "127.0.0.1/32,::1/128" });
  const a = await tesisKur(o);
  const b = await tesisKur(o);
  try {
    const h = await hesapKur(o, a.tesisId, ["bulut:hesap:yonet"]);
    const kilitlenecek = await hesapKur(o, a.tesisId, ["bulut:siparis:oku"]);
    const hb = await hesapKur(o, b.tesisId, ["bulut:hesap:yonet"]);

    console.log("\n§1 giriş olayları istemci adresini taşır");
    kontrol("§1a başarılı giriş 200", (await girisIp(o, h, "203.0.113.7")) === 200);
    const giris = await olay(o, a.tesisId, "GIRIS", h.accountId);
    kontrol("§1b GIRIS olayı IP'yi vekil başlığından taşır (oturum + istemci alanlarıyla)", ipOf(giris?.summary) === "203.0.113.7" && JSON.stringify(giris?.summary).includes("oturumId"), JSON.stringify(giris?.summary));
    kontrol("§1c hatalı parola 401", (await girisIp(o, h, "198.51.100.9", "yanlis-parola-deneme")) === 401);
    const basarisiz = await olay(o, a.tesisId, "GIRIS_BASARISIZ", h.accountId);
    kontrol("§1d GIRIS_BASARISIZ IP taşır", ipOf(basarisiz?.summary) === "198.51.100.9", JSON.stringify(basarisiz?.summary));
    await withTesis(o.goc, { tesisId: a.tesisId }, (tx) => tx.account.update({ where: { id: kilitlenecek.accountId }, data: { status: "KILITLI" } }));
    await girisIp(o, kilitlenecek, "192.0.2.44");
    const red = await olay(o, a.tesisId, "GIRIS_REDDEDILDI", kilitlenecek.accountId);
    kontrol("§1e GIRIS_REDDEDILDI (kilitli hesap) IP taşır", ipOf(red?.summary) === "192.0.2.44", JSON.stringify(red?.summary));
    await girisIp(o, hb, "192.0.2.200");

    console.log("\n§2 30. gün sınırı (zaman bazlı)");
    const t = giris!.createdAt.getTime();
    const sonGiris = Math.max(t, basarisiz!.createdAt.getTime(), red!.createdAt.getTime());
    await stripAgedIps(o.ctx, a.tesisId, t + IP_RETENTION_DAYS * GUN - 60_000);
    kontrol("§2a olaydan 30 gün − 1 dk sonra IP DURUR (negatif sınır)", ipOf((await olay(o, a.tesisId, "GIRIS", h.accountId))?.summary) === "203.0.113.7");
    const n = await stripAgedIps(o.ctx, a.tesisId, sonGiris + IP_RETENTION_DAYS * GUN);
    const sonra = await olay(o, a.tesisId, "GIRIS", h.accountId);
    kontrol("§2b tam 30. gün: IP alanı SİLİNİR (pozitif sınır)", n >= 3 && ipOf(sonra?.summary) === undefined, `${n} satır`);
    kontrol("§2c olay satırı ve öteki alanları KALIR", sonra?.event === "GIRIS" && JSON.stringify(sonra.summary).includes("oturumId") && JSON.stringify(sonra.summary).includes("istemci"));
    kontrol("§2d başarısız/reddedilen olaylar da IP'siz, satırları duruyor", ipOf((await olay(o, a.tesisId, "GIRIS_BASARISIZ", h.accountId))?.summary) === undefined && ipOf((await olay(o, a.tesisId, "GIRIS_REDDEDILDI", kilitlenecek.accountId))?.summary) === undefined);
    const davet = await withTesis(o.goc, { tesisId: a.tesisId }, (tx) => tx.accountAudit.count({ where: { tesisId: a.tesisId, event: "YONETICI_DAVET" } }));
    kontrol("§2e IP'siz olaylar dokunulmadı", davet >= 2);
    kontrol("§2f başka tesisin giriş IP'si etkilenmedi", ipOf((await olay(o, b.tesisId, "GIRIS", hb.accountId))?.summary) === "192.0.2.200");

    console.log("\n§3 hesap güvenlik kaydı ekranı");
    const belirtecB = hb.belirtec;
    const listeB = await api(o, "GET", "/api/hesaplar/denetim?limit=50", { belirtec: belirtecB });
    const kayitlarB = (listeB.json.data as { kayitlar: { olay: string; ozet: unknown }[] }).kayitlar;
    kontrol("§3a 30 gün içinde yönetici IP'yi görür", kayitlarB.some((k) => k.olay === "GIRIS" && ipOf(k.ozet) === "192.0.2.200"));
    const listeA = await api(o, "GET", "/api/hesaplar/denetim?limit=50", { belirtec: h.belirtec });
    const kayitlarA = (listeA.json.data as { kayitlar: { olay: string; ozet: unknown }[] }).kayitlar;
    kontrol("§3b süresi dolan IP ekranda yok", listeA.status === 200 && !kayitlarA.some((k) => k.olay === "GIRIS" && ipOf(k.ozet) === "203.0.113.7"));

    console.log("\n§4 erişim günlüğü satırı");
    const satirlar: string[] = [];
    const eski = console.log;
    const eskiAyar = process.env.PATRON_ERISIM_GUNLUGU;
    process.env.PATRON_ERISIM_GUNLUGU = "1";
    console.log = (...args: unknown[]) => void satirlar.push(args.map(String).join(" "));
    try {
      await girisIp(o, h, "203.0.113.99");
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      console.log = eski;
      if (eskiAyar === undefined) delete process.env.PATRON_ERISIM_GUNLUGU;
      else process.env.PATRON_ERISIM_GUNLUGU = eskiAyar;
    }
    const satir = satirlar.find((l) => l.includes("/api/oturum/ac")) ?? "";
    kontrol("§4a erişim günlüğü satırı yöntem + yol + durum taşır", /\[patron\] POST \/api\/oturum\/ac 200 \d+ms/.test(satir), satir);
    kontrol("§4b satırda IP ve sorgu dizgisi YOK", satir !== "" && !satir.includes("203.0.113.99") && !satir.includes("izle"));
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
