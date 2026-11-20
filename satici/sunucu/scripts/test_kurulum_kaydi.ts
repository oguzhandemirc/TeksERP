// =============================================================================
// KURULUM KAYDI (3d-2) — satıcı tarafı.
//   §1 yoklamadaki `kurulumKayitlari` `kurulum_kaydi` DEFTERİNE (kurulum, kayitId) ile idempotent yazılır
//      ve portal kurulum ayrıntısında görünür.
//   §2 eski destek talebi sistemi (3d-2) 2026-11-20 söküldü: `POST /v1/destek` 404, yoklama yanıtı `destek`
//      alanı taşımaz, portal `/destek` uçları yok.
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı): N1 `skipDuplicates` kaldırıldı → §1c/§1d/§1f ❌ ·
//   N2 `/v1/destek` ucu geri bağlandı → §2a ❌.
// Koşum: npx tsx scripts/test_kurulum_kaydi.ts   (yalnız *_test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import { ENDPOINTS } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kiraIdOf,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
  yoklamaGovdesi,
} from "./lib/test-ortam";

function kayit(kayitId: string, tur: "KURULUM" | "GERI_ALMA" = "KURULUM") {
  return {
    kayitId, tur, tarih: "2026-09-29T21:30:00Z", commit: "1234567", paketOzeti: "b".repeat(64),
    oncekiSurum: "2.11.1", yeniSurum: "2.11.2", migrationSayisi: 365, yeniMigrationSayisi: 16,
    geriDonus: { damga: "20260929_213000", kod: true, veri: true, veriSifreli: false },
  };
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
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
    let sonKira = kiraIdOf(e.json);
    const yokla = async (ek: Record<string, unknown> = {}) => {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
        kurulumId: k.kurulumId, amac: "yokla", anahtar,
        govde: { ...yoklamaGovdesi({ sonKiraId: sonKira, parmakIzi: f.parmakIzi }), ...ek },
      });
      if (y.status === 200) sonKira = kiraIdOf(y.json);
      return y;
    };

    console.log("\n§1 kurulum kaydı → defter (idempotent)");
    const A = randomUUID();
    const B = randomUUID();
    const y1 = await yokla({ kurulumKayitlari: [kayit(A), kayit(B, "GERI_ALMA")] });
    // Kaynak kimlikli başka satır da var (etkinleştirmedeki sözleşme kabulü, kaynak = kabulId): yalnız kur.ps1 olayları sayılır.
    const satirlar = () =>
      prisma.kurulumKaydi.findMany({ where: { kurulumId: k.kurulumDbId, kaynakKayitId: { not: null }, olay: { in: ["BACKEND_KURULDU", "BACKEND_GERI_ALINDI"] } }, orderBy: { createdAt: "asc" } });
    const s1 = await satirlar();
    kontrol("§1a yoklama kayıtlı gövdeyle 200", y1.status === 200, `${y1.status} ${y1.kod ?? ""}`);
    kontrol("§1b ⭐ iki kayıt deftere yazıldı (olay türü + kaynak kimliği + ayrıntı)",
      s1.length === 2 && s1.some((r) => r.olay === "BACKEND_KURULDU" && r.kaynakKayitId === A && (r.ayrinti as { yeniSurum?: string }).yeniSurum === "2.11.2")
        && s1.some((r) => r.olay === "BACKEND_GERI_ALINDI" && r.kaynakKayitId === B), `${s1.length}`);
    await yokla({ kurulumKayitlari: [kayit(A), kayit(B, "GERI_ALMA")] });
    await yokla({ kurulumKayitlari: [kayit(A), kayit(B, "GERI_ALMA"), kayit(randomUUID())] });
    kontrol("§1c ⭐ tekrar yoklama aynı kaydı İKİNCİ kez yazmaz (2 → 3, yeni kayıt kadar)", (await satirlar()).length === 3, `${(await satirlar()).length}`);
    const eski = await yokla();
    kontrol("§1d alan yoksa (eski fabrika) yoklama olağan", eski.status === 200 && (await satirlar()).length === 3);
    const yol = await yokla({ kurulumKayitlari: [{ ...kayit(randomUUID()), yol: "C:\\x.dump" }] });
    kontrol("§1e allowlist dışı alanlı kayıt KATI şemada 400", yol.status === 400 && yol.kod === "GOVDE_GECERSIZ", `${yol.status} ${yol.kod ?? ""}`);

    const yonetici = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(yonetici.id);
    const g = await portalGiris(sunucu.portal, "/portal/api", yonetici);
    const cerez = g.cerez ?? "";
    const det = await portalIstek(sunucu.portal, `/portal/api/kurulumlar/${k.kurulumDbId}`, { cerez });
    const kk = (det.veri.kurulumKaydi ?? []) as Array<{ olay: string; kaynakKayitId: string | null }>;
    kontrol("§1f ⭐ portal kurulum ayrıntısı kurulum kayıtlarını taşır", det.status === 200 && kk.filter((r) => r.olay === "BACKEND_KURULDU").length === 2, `${det.status}`);


    console.log("\n§2 eski destek talebi sistemi söküldü");
    const d = await imzaliPost(sunucu.genel, "/v1/destek", { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: { v: 1 } });
    kontrol("§2a ⭐ `POST /v1/destek` artık yok (404)", d.status === 404, `${d.status} ${d.kod ?? ""}`);
    const y2 = await yokla();
    kontrol("§2b yoklama yanıtı `destek` alanı taşımaz", y2.status === 200 && !("destek" in y2.json), `${y2.status}`);
    const pd = await portalIstek(sunucu.portal, "/portal/api/destek", { cerez });
    kontrol("§2c portal `/destek` ucu yok (404)", pd.status === 404, `${pd.status}`);
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
