// =============================================================================
// DAĞITIM — İNDİRME BAĞLANTISI (/d/<belirteç>, Faz 3d). Ölçülen:
//   §1 ilk kurulum bağlantısı portalda doğar; belirteç YALNIZ ilk yanıtta (tekrar oynatmada ve DB'de YOK)
//   §2 yetkisiz indirme: bilinmeyen/biçimsiz belirteç 404; oturumsuz portal çağrısı 401
//   §3 GET açılış sayfası ve HEAD hak TÜKETMEZ; POST indirir, gövde derlemeyle birebir, defter INDIRILDI
//   §4 sayısı dolan bağlantı 410 (sayaç tavanı aşmaz); eşzamanlı indirmede tam `azami` kadar 200
//   §5 süresi dolmuş bağlantı 410; §6 derleme bağlantıdan sonra değişirse hak tüketilmeden 410
//   §7 iptal: ters kayıt (BAGLANTI_IPTAL), ikinci iptal 409, iptal edilmiş bağlantı 410; defter değişmez (tetikleyici)
//   §8 erişim günlüğü belirteci maskeler
// Koşum: npx tsx scripts/test_dagitim_baglanti.ts   (yalnız *_test DB)
// =============================================================================
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { maskTokenPath } from "../src/distribution/tokens";
import { dagitimOrtamiKur, genelIstek, sha256 } from "./lib/dagitim-ortam";
import { hedefDbKapisi, kapat, kontrol, sonuc } from "./lib/test-ortam";

async function main(): Promise<void> {
  hedefDbKapisi();
  const d = await dagitimOrtamiKur();
  const { prisma } = await import("../src/lib/prisma");
  try {
    mkdirSync(d.dizin.derleme, { recursive: true });
    const derleme = "TeksERP-Kurulum-bekci.exe";
    const icerik = randomBytes(300_000);
    writeFileSync(path.join(d.dizin.derleme, derleme), icerik);
    const ver = (ek: Record<string, unknown> = {}) =>
      d.p("POST", "/dagitim/baglantilar", { tur: "ILK_KURULUM", musteriId: d.musteriId, kurulumId: d.kurulumDbId, derlemeAdi: derleme, gecerlilikSaat: 24, azamiIndirme: 2, ...ek });
    const indir = (b: string) => genelIstek(d.sunucu.genel, `/d/${b}`, { yontem: "POST" });
    const sayac = async (id: string) => (await prisma.indirmeBaglantisi.findUniqueOrThrow({ where: { id } })).indirmeSayisi;

    console.log("\n§1 bağlantı doğumu");
    const liste = await d.p("GET", "/dagitim/derlemeler");
    kontrol("§1a derleme listesi dizindeki dosyayı gösterir", JSON.stringify(liste.json.data).includes(derleme), `${liste.status}`);
    const clientToken = randomUUID();
    const govde = { clientToken, tur: "ILK_KURULUM", musteriId: d.musteriId, kurulumId: d.kurulumDbId, derlemeAdi: derleme, gecerlilikSaat: 24, azamiIndirme: 2 };
    const ilk = await d.p("POST", "/dagitim/baglantilar", govde);
    const b = String(ilk.veri.belirtec ?? "");
    const link = ilk.veri.baglanti as { id: string; derlemeSha256: string; belirtecSonu: string };
    kontrol("§1b 201 + belirteç + /d yolu + donmuş derleme özeti", ilk.status === 201 && /^[A-Za-z0-9_-]{32}$/.test(b) && ilk.veri.yol === `/d/${b}` && link.derlemeSha256 === sha256(icerik), `${ilk.status} ${ilk.kod ?? ""}`);
    const tekrar = await d.p("POST", "/dagitim/baglantilar", govde);
    kontrol("§1c aynı işlem kimliği → aynı bağlantı, belirteç GÖSTERİLMEZ", tekrar.status === 201 && tekrar.basliklar.get("idempotent-replay") === "true" && tekrar.veri.belirtec === undefined && tekrar.veri.belirtecGosterilemez === true && (tekrar.veri.baglanti as { id: string }).id === link.id);
    const satir = JSON.stringify(await prisma.indirmeBaglantisi.findUniqueOrThrow({ where: { id: link.id } }), (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v));
    const islem = JSON.stringify(await prisma.portalIslemi.findUniqueOrThrow({ where: { clientToken } }));
    kontrol("§1d belirteç düz metni DB'de YOK (bağlantı satırı + saklanan yanıt); yalnız son 4", !satir.includes(b) && !islem.includes(b) && link.belirtecSonu === b.slice(-4));
    const yabanci = await d.p("POST", "/dagitim/baglantilar", { tur: "ILK_KURULUM", musteriId: d.musteriId, derlemeAdi: "../../etc/passwd.exe", gecerlilikSaat: 1, azamiIndirme: 1 });
    const yok = await d.p("POST", "/dagitim/baglantilar", { tur: "ILK_KURULUM", musteriId: d.musteriId, derlemeAdi: "olmayan.exe", gecerlilikSaat: 1, azamiIndirme: 1 });
    kontrol("§1e dizin dışı derleme adı 400, olmayan derleme 404", yabanci.status === 400 && yok.status === 404, `${yabanci.status}/${yok.status}`);
    const sinirDisi = await ver({ azamiIndirme: 0 });
    kontrol("§1f indirme sayısı 1–1000 dışı → 400", sinirDisi.status === 400, `${sinirDisi.status}`);

    console.log("\n§2 yetkisiz indirme");
    const bilinmeyen = await indir(randomBytes(24).toString("base64url"));
    const bicimsiz = await genelIstek(d.sunucu.genel, "/d/..%2F..%2Fx");
    const oturumsuz = await genelIstek(d.sunucu.tailnet, "/portal/api/dagitim/baglantilar");
    kontrol("§2a bilinmeyen belirteç 404 (varlık sızmaz)", bilinmeyen.status === 404 && bilinmeyen.kod === "BULUNAMADI", `${bilinmeyen.status}`);
    kontrol("§2b biçimsiz belirteç 404", bicimsiz.status === 404, `${bicimsiz.status}`);
    kontrol("§2c oturumsuz portal listesi 401", oturumsuz.status === 401, `${oturumsuz.status}`);

    console.log("\n§3 açılış sayfası hak tüketmez; indirme");
    const sayfa = await genelIstek(d.sunucu.genel, `/d/${b}`);
    const bas = await genelIstek(d.sunucu.genel, `/d/${b}`, { yontem: "HEAD" });
    kontrol(
      "§3a GET açılış sayfası: ad + form POST, no-referrer + CSP; HEAD 200",
      sayfa.status === 200 && sayfa.body.toString().includes(derleme) && sayfa.body.toString().includes('method="post"') && sayfa.basliklar.get("referrer-policy") === "no-referrer" && /script-src 'none'/.test(sayfa.basliklar.get("content-security-policy") ?? "") && bas.status === 200,
    );
    kontrol("§3b GET + HEAD sayacı DEĞİŞTİRMEDİ", (await sayac(link.id)) === 0);
    const i1 = await indir(b);
    kontrol("§3c POST → 200, gövde derlemeyle birebir, attachment", i1.status === 200 && sha256(i1.body) === sha256(icerik) && /attachment/.test(i1.basliklar.get("content-disposition") ?? ""), `${i1.status}`);
    const defter = await prisma.dagitimDefteri.findMany({ where: { baglantiId: link.id }, orderBy: { createdAt: "asc" } });
    kontrol("§3d defter: BAGLANTI_VERILDI → INDIRILDI", defter.map((x) => x.olay).join(",") === "BAGLANTI_VERILDI,INDIRILDI", defter.map((x) => x.olay).join(","));

    console.log("\n§4 sayı sınırı");
    const i2 = await indir(b);
    const i3 = await indir(b);
    kontrol("§4a ikinci indirme 200, üçüncü 410 BAGLANTI_GECERSIZ; sayaç 2'de kalır", i2.status === 200 && i3.status === 410 && i3.kod === "BAGLANTI_GECERSIZ" && (await sayac(link.id)) === 2, `${i2.status}/${i3.status}`);
    const es = await ver({ azamiIndirme: 3 });
    const esB = String(es.veri.belirtec);
    const sonuclar = await Promise.all(Array.from({ length: 6 }, () => indir(esB)));
    const tamam = sonuclar.filter((r) => r.status === 200).length;
    const red = sonuclar.filter((r) => r.status === 410).length;
    kontrol("§4b 6 eşzamanlı indirme, azami 3 → tam 3×200 + 3×410, sayaç 3", tamam === 3 && red === 3 && (await sayac((es.veri.baglanti as { id: string }).id)) === 3, `${tamam}/${red}`);

    console.log("\n§5 süre");
    const sure = await ver();
    const sureId = (sure.veri.baglanti as { id: string }).id;
    await prisma.indirmeBaglantisi.update({ where: { id: sureId }, data: { bitis: new Date(Date.now() - 1000) } });
    const s1 = await indir(String(sure.veri.belirtec));
    const s2 = await genelIstek(d.sunucu.genel, `/d/${String(sure.veri.belirtec)}`);
    kontrol("§5a süresi dolmuş: POST 410, açılış 410, sayaç 0", s1.status === 410 && s2.status === 410 && (await sayac(sureId)) === 0, `${s1.status}/${s2.status}`);

    console.log("\n§6 derleme değişti");
    const deg = await ver();
    const degisik = Buffer.from(icerik);
    degisik[0] = degisik[0]! ^ 0xff;
    writeFileSync(path.join(d.dizin.derleme, derleme), degisik);
    const dg = await indir(String(deg.veri.belirtec));
    kontrol("§6a aynı boyutta farklı derleme → 410, hak TÜKETİLMEDİ", dg.status === 410 && (await sayac((deg.veri.baglanti as { id: string }).id)) === 0, `${dg.status} ${dg.kod ?? ""}`);
    writeFileSync(path.join(d.dizin.derleme, derleme), icerik);

    console.log("\n§7 iptal (ters kayıt)");
    const ip = await ver();
    const ipId = (ip.veri.baglanti as { id: string }).id;
    const iptal = await d.p("POST", `/dagitim/baglantilar/${ipId}/iptal`, { sebep: "müşteri yanlış kişiye iletti" }, d.operator.cerez);
    const iptal2 = await d.p("POST", `/dagitim/baglantilar/${ipId}/iptal`, { sebep: "tekrar" });
    const ipIndir = await indir(String(ip.veri.belirtec));
    kontrol("§7a iptal 200 (operatör), ikinci iptal 409, iptal edilen 410", iptal.status === 200 && iptal2.status === 409 && iptal2.kod === "DURUM_CAKISMASI" && ipIndir.status === 410, `${iptal.status}/${iptal2.status}/${ipIndir.status}`);
    const ipDefter = await prisma.dagitimDefteri.findMany({ where: { baglantiId: ipId }, orderBy: { createdAt: "asc" } });
    kontrol("§7b defter: VERILDI satırı durur + BAGLANTI_IPTAL eklendi (silme yok)", ipDefter.map((x) => x.olay).join(",") === "BAGLANTI_VERILDI,BAGLANTI_IPTAL");
    const degistir = await prisma.dagitimDefteri.update({ where: { id: ipDefter[0]!.id }, data: { olay: "SAHTE" } }).then(() => "yazıldı", (e: Error) => e.message);
    kontrol("§7c ✓K defter satırı DEĞİŞTİRİLEMEZ (tetikleyici)", /Defter satırı değiştirilemez/.test(degistir), degistir.slice(0, 80));
    const l = await d.p("GET", `/dagitim/baglantilar?kurulumId=${d.kurulumDbId}`);
    kontrol("§7d kurulum listesi bağlantıları taşır, belirteç özeti TAŞIMAZ", Array.isArray(l.json.data) && (l.json.data as unknown[]).length >= 4 && !JSON.stringify(l.json.data).includes("belirtecOzeti"));

    console.log("\n§8 günlük maskesi");
    kontrol("§8a /d ve /y yolunda belirteç maskelenir, diğer yol aynen", maskTokenPath(`/d/${b}`) === "/d/***" && maskTokenPath(`/y/${b}/oturum/x`) === "/y/***/oturum/x" && maskTokenPath("/v1/yokla") === "/v1/yokla");
  } finally {
    await d.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
