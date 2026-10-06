// =============================================================================
// GÜNCELLEME GRUBU (tek ortak paket O2 — docs/design/TEK-ORTAK-PAKET.md §3.1, §10 K-3/K-4): satıcının `kanal`
// satırı = güncelleme grubu (`test` · `oncu` · `genel`); kira `kanal.kod`u, belirteç `yolOneki=/<grup>/<ürün>/` taşır.
// §1 grup satırları: aktif olanlar tam üç grup, terfi sırasıyla; migration ikinci koşumda hiçbir satırı değiştirmez
// §2 K-3 varsayılan: grup verilmeden açılan kurulum TEST → test, diğer sınıflar → genel; açık seçim kazanır
// §3 RED: grup olmayan kod (kayıtsız · emekli satır) ne doğuşta ne taşımada kabul edilir; emekli kanaldaki kurulumun
//    başka alanı düzenlenebilir (kanal düzeni kurulumu kilitlemez)
// §4 grup değişimi: kurulum_kaydi GUNCELLENDI satırı önceki → yeni grubu taşır, zil ("lisans") çalar
// §5 kira + belirteç: kira `kanal.kod` = grup, belirteç yolları `/<grup>/{electron,mobil,backend}/`; grup değişince
//    sonraki yoklama yeni grubu taşır
// §6 EMEKLİ kanal (demofabrika durumu, ölçüm): ETKİN kurulum KİRA ALIR (lisans kesilmez) ama İNDİRME BELİRTECİ ALMAZ;
//    iptal edilen kurulum 403 KURULUM_IPTAL; iptal + pasif 401 KURULUM_BILINMIYOR (ikisinde de kira yok, belirteç yok)
// §7 K-4: grubu yalnız satıcı tarafı değiştirir — bayi rota tablosunda kurulum düzenleme yok; operatör (kurulum
//    düzenleme yetkisi) değiştirebilir
// ✓K saf yüklemler kör değil: grup olmayan / pasif grup belirteç almaz, varsayılan sınıfa bağlı
// Koşum: npx tsx scripts/test_guncelleme_grubu.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { ENDPOINTS, parseJws, type LeaseDoc } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kanalFiksturu,
  kapat,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  SATICI_KOKU,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
  yoklamaGovdesi,
  type Yanit,
} from "./lib/test-ortam";

const MIGRATION = path.join(SATICI_KOKU, "prisma", "migrations", "20261006120000_guncelleme_gruplari", "migration.sql");
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function kiraOf(y: Yanit): LeaseDoc | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as LeaseDoc) : null;
}

const yollar = (y: Yanit): string =>
  ((y.json.indirmeBelirtecleri as { yolOneki: string; belirtec: string }[] | undefined) ?? []).map((b) => b.yolOneki).join(",");

const belirtecKanallari = (y: Yanit): string[] =>
  ((y.json.indirmeBelirtecleri as { belirtec: string }[] | undefined) ?? []).map((b) => {
    const p = parseJws(b.belirtec);
    return p.ok ? String((p.value.payload as { kanal?: unknown }).kanal) : "?";
  });

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000" });
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const ch = await import("../src/services/channel.service");
  const { DOORBELL_CHANNEL } = await import("../src/services/doorbell");
  const { cancelInstallation } = await import("../src/services/installation-admin.service");
  const { DEALER_PORTAL_ROUTES } = await import("../src/http/dealer-routes");
  const kullanicilar: string[] = [];
  const kurulumlar: string[] = [];
  const tesisler: string[] = [];
  const musteriler: string[] = [];
  const sahteler: string[] = [];
  const emekli = await kanalFiksturu(`bekci-emekli-${randomUUID().slice(0, 8)}`);
  const sunucu = await portalSunuculariKur(ctx);
  const dinleyici = new Client({ connectionString: process.env.DATABASE_URL });
  const ziller: { k: string; konu: string }[] = [];
  try {
    console.log("\n§1 grup satırları");
    const satirlar = await prisma.kanal.findMany({ where: { aktif: true }, orderBy: [{ sira: "asc" }, { kod: "asc" }] });
    kontrol(
      "§1a ⭐ aktif kanal = tam üç güncelleme grubu, terfi sırasıyla (UPDATE_GROUPS ile aynı); tür uretim",
      satirlar.map((s) => `${s.kod}:${s.sira}`).join() === ch.UPDATE_GROUPS.map((g, i) => `${g}:${i + 1}`).join() && satirlar.every((s) => s.tur === "uretim"),
      satirlar.map((s) => `${s.kod}:${s.sira}:${s.tur}`).join(),
    );
    const emekliSatir = await prisma.kanal.findUniqueOrThrow({ where: { kod: emekli } });
    kontrol("§1b grup olmayan satır emeklidir (aktif=false, silinmez)", emekliSatir.aktif === false);
    const goruntu = async (db: { kanal: typeof prisma.kanal }) =>
      JSON.stringify((await db.kanal.findMany({ orderBy: { kod: "asc" } })).map((k) => [k.kod, k.ad, k.tur, k.sira, k.aktif, k.guncelSurumler]));
    const once = await goruntu(prisma);
    let ikinci = "";
    const geriAl = new Error("geri al");
    await prisma
      .$transaction(async (tx) => {
        const sql = readFileSync(MIGRATION, "utf8").replace(/^--.*$/gm, "");
        for (const ifade of sql.split(";").map((x) => x.trim()).filter(Boolean)) await tx.$executeRawUnsafe(ifade);
        ikinci = await goruntu(tx);
        throw geriAl;
      })
      .catch((e: unknown) => {
        if (e !== geriAl) throw e;
      });
    kontrol("§1c migration idempotent: ikinci koşum hiçbir kanal satırını değiştirmez", ikinci === once, ikinci === once ? "" : `${once} ≠ ${ikinci}`);

    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    const operator = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(yonetici.id, operator.id);
    const cerez = (await portalGiris(sunucu.portal, "/portal/api", yonetici)).cerez!;
    const opCerez = (await portalGiris(sunucu.portal, "/portal/api", operator)).cerez!;
    const api = (yol: string, govde: Record<string, unknown>, yontem?: string, c = cerez) =>
      portalIstek(sunucu.portal, `/portal/api${yol}`, { cerez: c, yontem, govde: { clientToken: randomUUID(), ...govde } });
    const m = await api("/musteriler", { ad: `Bekçi Grup ${randomUUID().slice(0, 8)}` });
    musteriler.push(m.veri.id as string);
    const t = await api("/tesisler", { musteriId: m.veri.id, ad: "Merkez" });
    tesisler.push(t.veri.id as string);
    const ac = async (govde: Record<string, unknown>) => {
      const y = await api("/kurulumlar", { tesisId: t.veri.id, ...govde });
      if (y.status === 201) kurulumlar.push(y.veri.id as string);
      return y;
    };

    console.log("\n§2 K-3 varsayılan grup");
    const [kTest, kUretim, kDemo, kAcik] = [await ac({ sinif: "TEST" }), await ac({ sinif: "URETIM" }), await ac({ sinif: "DEMO" }), await ac({ sinif: "URETIM", kanalKodu: "oncu" })];
    kontrol(
      "§2a ⭐ grup verilmezse TEST → test · URETIM → genel · DEMO → genel; açık seçim (oncu) kazanır",
      [kTest, kUretim, kDemo, kAcik].every((y) => y.status === 201) &&
        [kTest, kUretim, kDemo, kAcik].map((y) => y.veri.kanalKodu).join() === "test,genel,genel,oncu",
      [kTest, kUretim, kDemo, kAcik].map((y) => `${y.status}:${String(y.veri.kanalKodu)}`).join(" "),
    );

    console.log("\n§3 grup olmayan kod RED");
    const kayitsiz = await ac({ sinif: "URETIM", kanalKodu: "demofabrika" });
    const emekliDogus = await ac({ sinif: "URETIM", kanalKodu: emekli });
    kontrol("§3a grup olmayan kod (kayıtsız · emekli satır) ile kurulum açılmaz → 400", kayitsiz.status === 400 && emekliDogus.status === 400, `${kayitsiz.status}/${emekliDogus.status}`);
    const sahte = `bekci-aktif-${randomUUID().slice(0, 8)}`;
    await prisma.kanal.create({ data: { kod: sahte, ad: "Bekçi: elle açılmış aktif satır", tur: "uretim", aktif: true } });
    sahteler.push(sahte);
    const sahteDogus = await ac({ sinif: "URETIM", kanalKodu: sahte });
    await prisma.kanal.update({ where: { kod: sahte }, data: { aktif: false } }); // sonda kırmızıda da §1a'yı kirletmesin
    kontrol("§3d aktif ama grup OLMAYAN satır (elle yazılmış) da kurulum almaz → 400 (grup kümesi koddan, satırdan değil)", sahteDogus.status === 400, `${sahteDogus.status}`);
    const kId = kUretim.veri.id as string;
    const tasima = await api(`/kurulumlar/${kId}`, { kanalKodu: emekli }, "PATCH");
    const sonra = await prisma.kurulum.findUniqueOrThrow({ where: { id: kId } });
    kontrol("§3b emekli kanala taşıma → 400, kurulum yerinde (genel)", tasima.status === 400 && sonra.kanalKodu === "genel", `${tasima.status} ${sonra.kanalKodu}`);
    await prisma.kurulum.update({ where: { id: kDemo.veri.id as string }, data: { kanalKodu: emekli } }); // eski düzenden kalan kurulum
    const adDegis = await api(`/kurulumlar/${kDemo.veri.id as string}`, { ad: "Eski kanaldaki sunucu", kanalKodu: emekli }, "PATCH");
    kontrol("§3c emekli kanaldaki kurulumun adı düzenlenir (aynı kanal kodu değişim sayılmaz) → 200", adDegis.status === 200 && adDegis.veri.kanalKodu === emekli, `${adDegis.status} ${adDegis.kod ?? ""}`);

    console.log("\n§4 + §5 grup değişimi · kira · belirteç");
    const f = await kurulumFiksturu(ctx, { sinif: "TEST", musteriId: m.veri.id as string, tesisId: t.veri.id as string });
    kurulumlar.push(f.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: f.kurulumId, amac: "etkinlestir", anahtar,
      govde: etkinlestirmeGovdesi({ kod: f.kod, kurulumId: f.kurulumId, anahtar, parmakIzi: ortam.f.parmakIzi }),
    });
    let uc = kiraOf(et)?.kiraId ?? null;
    const yokla = async (): Promise<Yanit> => {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
        kurulumId: f.kurulumId, amac: "yokla", anahtar,
        govde: yoklamaGovdesi({ sonKiraId: uc, hak: { hakId: f.hakId, surum: 1 }, parmakIzi: ortam.f.parmakIzi }),
      });
      uc = kiraOf(y)?.kiraId ?? uc;
      return y;
    };
    kontrol(
      "§5a ⭐ etkinleştirme: kira kanal.kod = test (K-3), belirteç yolları /test/{electron,mobil,backend}/, belirteç kanalı test",
      kiraOf(et)?.kanal.kod === "test" && yollar(et) === "/test/electron/,/test/mobil/,/test/backend/" && belirtecKanallari(et).every((k) => k === "test"),
      `${et.status} ${kiraOf(et)?.kanal.kod} ${yollar(et)}`,
    );
    await dinleyici.connect();
    dinleyici.on("notification", (n) => ziller.push(JSON.parse(n.payload ?? "{}") as { k: string; konu: string }));
    await dinleyici.query(`LISTEN ${DOORBELL_CHANNEL}`);
    const degis = await api(`/kurulumlar/${f.kurulumDbId}`, { kanalKodu: "oncu" }, "PATCH", opCerez);
    await bekle(300);
    const kayit = await prisma.kurulumKaydi.findFirst({ where: { kurulumId: f.kurulumDbId, olay: "GUNCELLENDI" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const ayrinti = kayit?.ayrinti as { alanlar?: string[]; grup?: { onceki?: string; yeni?: string } } | undefined;
    kontrol(
      "§4a ⭐ operatör grubu değiştirir (K-4: satıcı tarafı) → 200; kurulum_kaydi önceki → yeni grubu taşır",
      degis.status === 200 && ayrinti?.alanlar?.includes("kanalKodu") === true && ayrinti.grup?.onceki === "test" && ayrinti.grup.yeni === "oncu",
      `${degis.status} ${JSON.stringify(ayrinti)}`,
    );
    kontrol("§4b grup değişimi zili çalar (konu lisans)", ziller.some((z) => z.k === f.kurulumDbId && z.konu === "lisans"), JSON.stringify(ziller));
    const y2 = await yokla();
    kontrol(
      "§5b ⭐ sonraki yoklama yeni grubu taşır: kira oncu, belirteç /oncu/…",
      kiraOf(y2)?.kanal.kod === "oncu" && yollar(y2) === "/oncu/electron/,/oncu/mobil/,/oncu/backend/" && belirtecKanallari(y2).every((k) => k === "oncu"),
      `${y2.status} ${kiraOf(y2)?.kanal.kod} ${yollar(y2)}`,
    );

    console.log("\n§6 emekli kanal (demofabrika durumu) — ölçüm");
    await prisma.kurulum.update({ where: { id: f.kurulumDbId }, data: { kanalKodu: emekli } });
    const y3 = await yokla();
    kontrol(
      "§6a ⭐ ETKİN kurulum emekli kanalda KİRA ALIR (lisans kesilmez, kira kanal.kod = emekli kod) ama İNDİRME BELİRTECİ ALMAZ",
      y3.status === 200 && kiraOf(y3)?.kanal.kod === emekli && yollar(y3) === "",
      `${y3.status} ${kiraOf(y3)?.kanal.kod} [${yollar(y3)}]`,
    );
    await cancelInstallation({ installationDbId: f.kurulumDbId, reason: "bekçi: emekli kanal ölçümü", actor: "bekci" });
    const y4 = await yokla();
    kontrol("§6b iptal edilen kurulum → 403 KURULUM_IPTAL (kira yok, belirteç yok)", y4.status === 403 && y4.kod === "KURULUM_IPTAL" && yollar(y4) === "", `${y4.status} ${y4.kod ?? ""}`);
    const pasif = await api(`/kurulumlar/${f.kurulumDbId}/pasif`, { sebep: "bekçi: emekli kanal" });
    const y5 = await yokla();
    kontrol(
      "§6c iptal + pasif (portal) → 200; pasif kurulum satıcıda tanınmaz → 401 KURULUM_BILINMIYOR (kira yok, belirteç yok)",
      pasif.status === 200 && y5.status === 401 && y5.kod === "KURULUM_BILINMIYOR" && yollar(y5) === "",
      `${pasif.status} ${pasif.kod ?? ""} · ${y5.status} ${y5.kod ?? ""}`,
    );

    console.log("\n§7 K-4 grubu kim değiştirir");
    const bayiKurulumYazmasi = DEALER_PORTAL_ROUTES.filter((r) => r.method === "patch" && /^\/kurulumlar\/:id$/.test(r.path));
    kontrol("§7a bayi rota tablosunda kurulum düzenleme (grup değişimi) yolu YOK", bayiKurulumYazmasi.length === 0, bayiKurulumYazmasi.map((r) => r.path).join());

    console.log("\n✓K saf yüklemler");
    kontrol(
      "✓K grup olmayan / pasif grup belirteç almaz; aktif grup alır; varsayılan sınıfa bağlı (TEST ≠ URETIM)",
      !ch.channelIssuesDownloads({ kod: "demofabrika", aktif: true }) && !ch.channelIssuesDownloads({ kod: "test", aktif: false }) &&
        !ch.channelIssuesDownloads(null) && ch.channelIssuesDownloads({ kod: "genel", aktif: true }) &&
        ch.defaultGroupFor("TEST") === "test" && ch.defaultGroupFor("URETIM") === "genel" && !ch.isUpdateGroup("ota"),
    );
  } finally {
    await dinleyici.end().catch(() => undefined);
    await sunucu.kapat();
    await temizleKurulumlar(kurulumlar, ortam.kidler);
    await temizlePortal({ kullanicilar, tesisler, musteriler, kanallar: [emekli, ...sahteler] });
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
