// =============================================================================
// DAĞITIM — SAKLAMA / BUDAMA (Faz 3d). Beyan: gövdesi budanan tek tablo `dagitim_dosyasi` (satır KALIR).
//   §1 saklama süresi dolan dosyanın GÖVDESİ silinir; satır + defter kalır (govdeBudandiAt + GOVDE_BUDANDI);
//      süresi dolmayan dosyaya dokunulmaz; ikinci tur boş (idempotent)
//   §2 budanmış gövde: eski bağlantı 410 GOVDE_BUDANDI, yeni paylaşım 410, portal indirmesi 410
//   §3 yarım yükleme: süre aşımındaki açık oturum TERK + kota iadesi + parçalar silinir + YUKLEME_TERK;
//      taze oturum AÇIK kalır
//   §4 beyan: dağıtım kodunda satır silme YOK; bakım işi iki adımı koşar; BODY_PRUNED_MODELS = [dagitimDosyasi]
// Koşum: npx tsx scripts/test_dagitim_budama.ts   (yalnız *_test DB)
// =============================================================================
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { abandonStaleSessions, BODY_PRUNED_MODELS, pruneExpiredBodies } from "../src/distribution/retention";
import { completeSession, startSession, writePart, type SessionOwner } from "../src/distribution/sessions.service";
import { bodyPath } from "../src/distribution/storage";
import { dagitimOrtamiKur, genelIstek, sha256 } from "./lib/dagitim-ortam";
import { hedefDbKapisi, kapat, kontrol, portalFetch, SATICI_KOKU, sonuc } from "./lib/test-ortam";

async function main(): Promise<void> {
  hedefDbKapisi();
  const d = await dagitimOrtamiKur({ PARCA_AZAMI_MB: "1" });
  const { prisma } = await import("../src/lib/prisma");
  const config = d.ortam.ctx.config;
  try {
    const sahip: SessionOwner = { kind: "SATICI", customerId: d.musteriId, actor: "bekci" };
    const yukle = async (owner: SessionOwner, ad: string, veri: Buffer): Promise<string> => {
      const s = await startSession(config, { owner, clientToken: randomUUID(), name: ad, size: veri.length, sha256: sha256(veri) }, Date.now());
      await writePart(config, { owner, sessionId: s.oturumId, index: 0, sha256: sha256(veri), body: Readable.from([veri]), nowMs: Date.now() });
      return (await completeSession(config, { owner, sessionId: s.oturumId, nowMs: Date.now() })).id;
    };
    const eskiId = await yukle(sahip, "eski.pdf", randomBytes(4000));
    const taze = randomBytes(5000);
    const tazeId = await yukle(sahip, "taze.pdf", taze);
    const eski = await prisma.dagitimDosyasi.findUniqueOrThrow({ where: { id: eskiId } });
    const eskiBag = await d.p("POST", "/dagitim/baglantilar", { tur: "DOSYA", musteriId: d.musteriId, dosyaId: eskiId, gecerlilikSaat: 24, azamiIndirme: 5 });
    await prisma.dagitimDosyasi.update({ where: { id: eskiId }, data: { saklamaBitis: new Date(Date.now() - 60_000) } });
    const satirOnce = await prisma.dagitimDosyasi.count({ where: { musteriId: d.musteriId } });

    console.log("\n§1 gövde budaması");
    const n1 = await pruneExpiredBodies(config, Date.now());
    const eskiSonra = await prisma.dagitimDosyasi.findUniqueOrThrow({ where: { id: eskiId } });
    const tazeSonra = await prisma.dagitimDosyasi.findUniqueOrThrow({ where: { id: tazeId } });
    kontrol("§1a süresi dolan gövde silindi, satır KALDI (govdeBudandiAt dolu)", n1 >= 1 && eskiSonra.govdeBudandiAt !== null && !existsSync(bodyPath(config.DOSYA_DIZINI, eski.depoAnahtari)), `${n1}`);
    kontrol("§1b süresi dolmayan dosyaya dokunulmadı (gövde birebir)", tazeSonra.govdeBudandiAt === null && sha256(readFileSync(bodyPath(config.DOSYA_DIZINI, tazeSonra.depoAnahtari))) === sha256(taze));
    kontrol("§1c satır sayısı değişmedi (budama SATIR silmez)", (await prisma.dagitimDosyasi.count({ where: { musteriId: d.musteriId } })) === satirOnce);
    const olaylar = (await prisma.dagitimDefteri.findMany({ where: { dosyaId: eskiId }, orderBy: { createdAt: "asc" } })).map((x) => x.olay);
    kontrol("§1d defter: DOSYA_YUKLENDI → BAGLANTI_VERILDI → GOVDE_BUDANDI", olaylar.join(",") === "DOSYA_YUKLENDI,BAGLANTI_VERILDI,GOVDE_BUDANDI", olaylar.join(","));
    const n2 = await pruneExpiredBodies(config, Date.now());
    kontrol("§1e ikinci tur aynı dosyayı yeniden budamaz", n2 === 0 && (await prisma.dagitimDefteri.count({ where: { dosyaId: eskiId, olay: "GOVDE_BUDANDI" } })) === 1, `${n2}`);

    console.log("\n§2 budanmış gövde");
    const eskiIndir = await genelIstek(d.sunucu.genel, `/d/${String(eskiBag.veri.belirtec)}`, { yontem: "POST" });
    const yeniBag = await d.p("POST", "/dagitim/baglantilar", { tur: "DOSYA", musteriId: d.musteriId, dosyaId: eskiId, gecerlilikSaat: 24, azamiIndirme: 1 });
    const portal = await portalFetch(`${d.sunucu.portal}/portal/api/ham/dosyalar/${eskiId}`, { headers: { Cookie: d.yonetici.cerez } });
    kontrol("§2a eski bağlantı 410 GOVDE_BUDANDI · yeni paylaşım 410 · portal indirmesi 410", eskiIndir.status === 410 && eskiIndir.kod === "GOVDE_BUDANDI" && yeniBag.status === 410 && portal.status === 410, `${eskiIndir.status}/${yeniBag.status}/${portal.status}`);
    const bag = await prisma.indirmeBaglantisi.findFirstOrThrow({ where: { dosyaId: eskiId } });
    kontrol("§2b budanmış gövdede hak TÜKETİLMEDİ", bag.indirmeSayisi === 0);

    console.log("\n§3 yarım yükleme");
    const ist = await d.p("POST", "/dagitim/yukleme-istekleri", { musteriId: d.musteriId, gecerlilikSaat: 48, kotaMb: 10, azamiDosyaMb: 3 });
    const istek = await prisma.yuklemeIstegi.findUniqueOrThrow({ where: { id: (ist.veri.istek as { id: string }).id } });
    const musteri: SessionOwner = { kind: "ISTEK", request: istek, actor: "musteri:bekci" };
    const buyuk = randomBytes(1024 * 1024 + 10);
    const yarim = await startSession(config, { owner: musteri, clientToken: randomUUID(), name: "yarim.zip", size: buyuk.length, sha256: sha256(buyuk) }, Date.now());
    const ilk = buyuk.subarray(0, 1024 * 1024);
    await writePart(config, { owner: musteri, sessionId: yarim.oturumId, index: 0, sha256: sha256(ilk), body: Readable.from([ilk]), nowMs: Date.now() });
    const yeni = await startSession(config, { owner: musteri, clientToken: randomUUID(), name: "yeni.zip", size: 100, sha256: sha256(randomBytes(4)) }, Date.now());
    await prisma.yuklemeOturumu.update({ where: { id: yarim.oturumId }, data: { sonEtkinlik: new Date(Date.now() - (config.YUKLEME_TERK_SAAT + 1) * 3_600_000) } });
    const once = Number((await prisma.yuklemeIstegi.findUniqueOrThrow({ where: { id: istek.id } })).kullanilanBayt);
    const t1 = await abandonStaleSessions(config, Date.now());
    const y1 = await prisma.yuklemeOturumu.findUniqueOrThrow({ where: { id: yarim.oturumId } });
    const y2 = await prisma.yuklemeOturumu.findUniqueOrThrow({ where: { id: yeni.oturumId } });
    const sonra = Number((await prisma.yuklemeIstegi.findUniqueOrThrow({ where: { id: istek.id } })).kullanilanBayt);
    kontrol("§3a süre aşımındaki oturum TERK, taze oturum AÇIK", t1 >= 1 && y1.durum === "TERK" && y2.durum === "ACIK", `${t1} ${y1.durum}/${y2.durum}`);
    kontrol("§3b kota iade edildi, parçalar silindi, parça satırları KALDI", once - sonra === buyuk.length && !existsSync(path.join(config.DOSYA_DIZINI, "parca", yarim.oturumId)) && (await prisma.yuklemeParcasi.count({ where: { oturumId: yarim.oturumId } })) === 1, `${once - sonra}`);
    kontrol("§3c defter YUKLEME_TERK (sebep SURE_ASIMI)", (await prisma.dagitimDefteri.count({ where: { oturumId: yarim.oturumId, olay: "YUKLEME_TERK" } })) === 1);

    console.log("\n§4 beyan");
    const dizin = path.join(SATICI_KOKU, "src", "distribution");
    const silen = readdirSync(dizin).filter((f) => /\.(delete|deleteMany)\(|DELETE FROM|TRUNCATE/i.test(readFileSync(path.join(dizin, f), "utf8")));
    kontrol("§4a dağıtım kodunda satır silme yok (yalnız gövde/parça dosyası)", silen.length === 0, silen.join(","));
    const bakim = readFileSync(path.join(SATICI_KOKU, "src", "services", "maintenance.ts"), "utf8");
    kontrol("§4b bakım işi iki adımı koşar", /pruneExpiredBodies\(this\.ctx\.config/.test(bakim) && /abandonStaleSessions\(this\.ctx\.config/.test(bakim));
    kontrol("§4c gövde budama beyanı yalnız dagitimDosyasi", JSON.stringify(BODY_PRUNED_MODELS) === '["dagitimDosyasi"]');
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
