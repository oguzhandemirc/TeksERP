// =============================================================================
// HATA RAPORU — satıcı tarafı (`POST /v1/hata-raporu`, müşteri onaylı, kişisel verisiz).
//   §1 kurulum imzalı parti grupları yazar; grup anahtarı gövdeden YENİDEN hesaplanır.
//   §2 aynı `partiId` (yeni nonce) sayacı İKİNCİ kez artırmaz; yeni parti aynı grubu artırır (ilk/son min/maks).
//   §3 KATI allowlist: tanınmayan anahtar, mesaj alanı, id'li yol, mutlak/kullanıcı dizinli yığın, serbest kod → 400;
//      başka amaçla imzalı istek 401.
//   §4 kurulum başına grup tavanı: dolunca YENİ grup alınmaz, var olanın sayacı sürer.
//   §5 portal: kurulum özeti + kurulumun grupları (kaynak süzmesi sunucuda, tanınmayan kaynak 400).
//   §6 budama (telemetri): saklama günü dolan grup ve parti silinir; ikisi de PRUNED_MODELS beyanında.
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı): N1 parti tekrar denetimi kaldırıldı → §2a ❌ ·
//   N2 grup tavanı denetimi kaldırıldı → §4a ❌ · N3 amaç `yokla` da kabul edildi → §3f ❌.
// Koşum: npx tsx scripts/test_hata_raporu.ts   (yalnız *_test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import { ENDPOINTS, errorReportGroupKey } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
} from "./lib/test-ortam";

function kayit(ek: Record<string, unknown> = {}) {
  return {
    kaynak: "sunucu", surum: "2.12.0", kod: "UNHANDLED", sinif: "TypeError", bilesen: "rolls", yol: "/api/rolls/:id",
    yigin: ["src/services/roll.service.ts:120", "node_modules/express/lib/router.js:44"],
    ilk: "2026-10-06T08:00:00.000Z", son: "2026-10-06T08:05:00.000Z", sayi: 3, ...ek,
  };
}
const parti = (kayitlar: unknown[], ek: Record<string, unknown> = {}) => ({ v: 1, partiId: randomUUID(), kayitlar, dusurulen: 0, ...ek });

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { acceptErrorReport, pruneErrorReports } = await import("../src/services/error-report.service");
  const { PRUNED_MODELS } = await import("../src/services/maintenance");
  const sunucu = await portalSunuculariKur(ctx);
  const kurulumlar: string[] = [];
  const kullanicilar: string[] = [];
  try {
    const anahtar = kurulumAnahtariUret();
    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    const e = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId, amac: "etkinlestir", anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }),
    });
    kontrol("§0 fikstür: kurulum etkinleşti", e.status === 200, `${e.status} ${e.kod ?? ""}`);
    const gonder = (govde: unknown, amac: "hata-raporu" | "yokla" = "hata-raporu") =>
      imzaliPost(sunucu.genel, ENDPOINTS.ERROR_REPORT, { kurulumId: k.kurulumId, amac, anahtar, govde });
    const gruplar = () => prisma.hataRaporuGrubu.findMany({ where: { kurulumId: k.kurulumDbId }, orderBy: { createdAt: "asc" } });

    console.log("\n§1 parti → gruplar");
    const p1 = parti([kayit(), kayit({ kaynak: "panel", surum: "1.4.0", bilesen: "pencere", yol: "/rolls/:p", yigin: ["assets/index-a1.js:1"] })]);
    const r1 = await gonder(p1);
    const g1 = await gruplar();
    kontrol("§1a ⭐ 200 + kabul 2, iki grup", r1.status === 200 && r1.json.kabul === 2 && r1.json.partiId === p1.partiId && g1.length === 2, `${r1.status} ${r1.kod ?? ""} ${g1.length}`);
    const sunucuGrup = g1.find((g) => g.kaynak === "sunucu");
    kontrol("§1b grup anahtarı gövdeden yeniden hesaplanır + alanlar yazılır", sunucuGrup?.grupAnahtari === errorReportGroupKey(kayit() as never)
      && sunucuGrup.sayi === 3 && sunucuGrup.yigin.length === 2 && sunucuGrup.yol === "/api/rolls/:id");

    console.log("\n§2 tekrar ve birikim");
    const r2 = await gonder(p1);
    const g2 = await gruplar();
    kontrol("§2a ⭐ aynı partiId (yeni nonce) aynı yanıt, sayaç ARTMAZ", r2.status === 200 && r2.json.kabul === 2 && g2.find((g) => g.kaynak === "sunucu")?.sayi === 3, `${r2.status} ${g2.find((g) => g.kaynak === "sunucu")?.sayi}`);
    const r3 = await gonder(parti([kayit({ sayi: 4, ilk: "2026-10-06T07:00:00.000Z", son: "2026-10-06T09:00:00.000Z" })]));
    const g3 = (await gruplar()).find((g) => g.kaynak === "sunucu");
    kontrol("§2b ⭐ yeni parti aynı grubu artırır (3+4), ilk/son min/maks", r3.status === 200 && g3?.sayi === 7
      && g3.ilk.toISOString() === "2026-10-06T07:00:00.000Z" && g3.son.toISOString() === "2026-10-06T09:00:00.000Z", `${g3?.sayi}`);

    console.log("\n§3 KATI allowlist");
    const red = async (ad: string, govde: unknown) => {
      const r = await gonder(govde);
      kontrol(ad, r.status === 400 && r.kod === "GOVDE_GECERSIZ", `${r.status} ${r.kod ?? ""}`);
    };
    await red("§3a ⭐ tanınmayan üst anahtar (kullanici) 400", parti([kayit()], { kullanici: "ahmet" }));
    await red("§3b ⭐ kayıtta mesaj alanı 400", parti([kayit({ mesaj: "Ahmet Yılmaz kaydı bulunamadı" })]));
    await red("§3c ⭐ id'li yol (şablon değil) 400", parti([kayit({ yol: `/api/rolls/${randomUUID()}` })]));
    await red("§3d ⭐ mutlak/kullanıcı dizinli yığın 400", parti([kayit({ yigin: ["C:/Users/ahmet/app/x.js:1"] })]));
    await red("§3d2 göreli ama kullanıcı dizinli yığın 400", parti([kayit({ yigin: ["Users/ahmet/x.js:1"] })]));
    await red("§3e serbest metin kod 400", parti([kayit({ kod: "Müşteri X bulunamadı" })]));
    const amac = await gonder(parti([kayit()]), "yokla");
    kontrol("§3f ⭐ başka amaçla imzalı istek RED (401)", amac.status === 401, `${amac.status} ${amac.kod ?? ""}`);
    await red("§3g boş parti 400", parti([]));

    console.log("\n§4 grup tavanı");
    const auth = { installation: { id: k.kurulumDbId } } as never;
    const once = (await gruplar()).length;
    const t1 = await acceptErrorReport(auth, parti([kayit({ kod: "TAVAN_A" }), kayit({ kod: "TAVAN_B" })]) as never, once + 1);
    const sonra = await gruplar();
    kontrol("§4a ⭐ tavan dolunca yeni grup ALINMAZ (1 kabul)", t1.kabul === 1 && sonra.length === once + 1, `${t1.kabul} ${sonra.length}`);
    const t2 = await acceptErrorReport(auth, parti([kayit()]) as never, once + 1);
    kontrol("§4b tavanda var olan grubun sayacı sürer", t2.kabul === 1 && (await gruplar()).find((g) => g.kaynak === "sunucu" && g.kod === "UNHANDLED")?.sayi === 10);

    console.log("\n§5 portal");
    const yonetici = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(yonetici.id);
    const g = await portalGiris(sunucu.portal, "/portal/api", yonetici);
    const cerez = g.cerez ?? "";
    const oz = await portalIstek(sunucu.portal, "/portal/api/hata-raporlari", { cerez });
    const ozItems = (oz.veri.items ?? []) as Array<{ kurulum: { id: string } | null; grupSayisi: number; toplam: number }>;
    const bu = ozItems.find((i) => i.kurulum?.id === k.kurulumDbId);
    kontrol("§5a ⭐ özet kurulum bazında (grup sayısı + toplam)", oz.status === 200 && bu?.grupSayisi === (await gruplar()).length && bu.toplam > 0, `${oz.status} ${JSON.stringify(bu)}`);
    const ls = await portalIstek(sunucu.portal, `/portal/api/hata-raporlari/${k.kurulumDbId}?kaynak=panel`, { cerez });
    const lsItems = (ls.veri.items ?? []) as Array<{ kaynak: string }>;
    kontrol("§5b kaynak süzmesi sunucuda", ls.status === 200 && lsItems.length === 1 && lsItems[0]?.kaynak === "panel", `${ls.status} ${lsItems.length}`);
    const kotu = await portalIstek(sunucu.portal, `/portal/api/hata-raporlari/${k.kurulumDbId}?kaynak=xyz`, { cerez });
    kontrol("§5c tanınmayan kaynak 400 (fail-closed)", kotu.status === 400, `${kotu.status}`);

    console.log("\n§6 budama");
    kontrol("§6a iki tablo da budama beyanında", (PRUNED_MODELS as readonly string[]).includes("hataRaporuGrubu") && (PRUNED_MODELS as readonly string[]).includes("hataRaporuPartisi"));
    await pruneErrorReports(Date.parse("2026-10-06T09:00:00.000Z") + 10 * 86_400_000, 90);
    kontrol("§6b saklama süresi dolmamış grup KALIR", (await gruplar()).length > 0);
    await pruneErrorReports(Date.now() + 400 * 86_400_000, 90);
    const kalan = (await gruplar()).length + (await prisma.hataRaporuPartisi.count({ where: { kurulumId: k.kurulumDbId } }));
    kontrol("§6c ⭐ saklama süresi dolan grup ve parti silinir", kalan === 0, `${kalan}`);
  } catch (err) {
    kontrol("beklenmeyen hata", false, err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    await sunucu.kapat();
    await temizleKurulumlar(kurulumlar);
    await temizlePortal({ kullanicilar });
    await kapat();
  }
  sonuc();
}

void main();
