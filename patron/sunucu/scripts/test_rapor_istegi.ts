// =============================================================================
// RAPOR İSTEĞİ BEKÇİSİ (sözleşme §7) — bulut hesap yapmaz, rapor FABRİKADA hesaplanır:
//   §1 kapılar: audit ailesi ve kişi adlı rapor buluttan İSTENEMEZ · aile izni + rapor:oku şart ·
//      fabrikanın rapor kataloğunda olmayan anahtar 404 · istek zili `rapor`
//   §2 fabrika: `rapor/al` ATOMİK claim (eşzamanlı ikisi ayrık) · `rapor/sonuc` HAZIR → hesap sonucu
//      görür · tekrar sonuç idempotent · sahibi olmayan kurulum 409
//   §3 sonuç RLS'i: aileye izni olmayan hesap (yönetici görünürlüğüyle bile) sonucu GÖREMEZ
//   §4 5 dk içinde aynı parametre → yeni istek doğrudan HAZIR (mevcut sonuç), zil YOK · standart görüntü (istekId null)
//   §5 claim süresi: bir kez BEKLIYOR'a döner, ikincide HATA `ZAMAN_ASIMI` · yazar BEKLIYOR iken iptal
// Koşum: npx tsx scripts/test_rapor_istegi.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { expireClaims } from "../src/services/maintenance";
import { api, hesapKur, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, type Ortam, type TestHesabi, type TestKurulumu } from "./lib/test-ortam";

type Alinan = { istekler: { istekId: string; raporAnahtari: string }[] };

async function katalog(o: Ortam, k: TestKurulumu): Promise<void> {
  const ufuk = new Date(o.saat.simdi() - 10_000);
  const veri = { raporlar: [{ anahtar: "sales/order-intake" }, { anahtar: "finance/aging" }, { anahtar: "audit/user-activity" }] };
  const r = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk, anliklar: [{ projeksiyon: "rapor-katalogu", icerikOzeti: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", veri }] }) });
  if (r.status !== 200) throw new Error(`katalog: ${r.status}`);
}

const iste = (o: Ortam, h: TestHesabi, raporAnahtari: string, parametreler: Record<string, unknown> = { baslangic: "2026-09-01", bitis: "2026-09-28" }) =>
  api(o, "POST", "/api/raporlar", { belirtec: h.belirtec, govde: { clientToken: randomUUID(), raporAnahtari, parametreler } });

/** `rapor/sonuc` gövdesi (S13/S14 biçimi — ortak tel şeması `ReportResultRequestSchema`). */
function sonucGovdesi(istekId: string | null, raporAnahtari: string, hesaplandi: string, g: { veri?: unknown; hataKodu?: string; parametreler?: Record<string, unknown>; donem?: string | null }) {
  const hazir = g.hataKodu === undefined;
  return {
    v: 1,
    istekId,
    raporAnahtari,
    parametreler: g.parametreler ?? {},
    donem: g.donem ?? null,
    durum: hazir ? "HAZIR" : "HATA",
    veri: hazir ? g.veri : null,
    hataKodu: hazir ? null : g.hataKodu,
    hesaplandi,
    kaynakUfuk: hesaplandi,
  };
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const k = await tesisKur(o);
  try {
    await katalog(o, k);
    const satis = await hesapKur(o, k.tesisId, ["bulut:rapor:oku", "bulut:siparis:oku"]);
    const muhasebe = await hesapKur(o, k.tesisId, ["bulut:rapor:oku", "bulut:cari-bakiye:oku"]);
    const yonetici = await hesapKur(o, k.tesisId, ["bulut:hesap:yonet", "bulut:rapor:oku", "bulut:siparis:oku"]);

    console.log("\n§1 istek kapıları");
    const audit = await iste(o, muhasebe, "audit/user-activity");
    kontrol("§1a audit ailesi buluttan istenemez → 404 RAPOR_BULUTTA_YOK", audit.status === 404 && audit.json.details?.code === "RAPOR_BULUTTA_YOK");
    const kisi = await iste(o, yonetici, "production/operator-performance");
    kontrol("§1b kişi adlı rapor (operatör performansı) → 404 RAPOR_BULUTTA_YOK", kisi.status === 404 && kisi.json.details?.code === "RAPOR_BULUTTA_YOK");
    const aileYok = await iste(o, satis, "finance/aging");
    kontrol("§1c finans raporu, finans izni yok → 403", aileYok.status === 403);
    const katalogDisi = await iste(o, satis, "sales/demand-analysis");
    kontrol("§1d fabrikanın kataloğunda olmayan rapor → 404 RAPOR_BILINMIYOR", katalogDisi.status === 404 && katalogDisi.json.details?.code === "RAPOR_BILINMIYOR");
    const zilOnce = o.zil.caldi.length;
    const r1 = await iste(o, satis, "sales/order-intake");
    const r2 = await iste(o, muhasebe, "finance/aging");
    const id1 = (r1.json.data as { id: string }).id;
    const id2 = (r2.json.data as { id: string }).id;
    kontrol("§1e geçerli istekler 201 BEKLIYOR", r1.status === 201 && r2.status === 201 && (r1.json.data as { durum?: string }).durum === "BEKLIYOR");
    kontrol("§1f zil `rapor` çaldı", o.zil.caldi.slice(zilOnce).filter((z) => z.konu === "rapor").length === 2);

    console.log("\n§2 fabrika claim + sonuç");
    const [a, b] = await Promise.all([imzali(o, k, "/v1/rapor/al", { govde: { v: 1, enFazla: 1 } }), imzali(o, k, "/v1/rapor/al", { govde: { v: 1, enFazla: 1 } })]);
    const ia = (a.json as unknown as Alinan).istekler.map((x) => x.istekId);
    const ib = (b.json as unknown as Alinan).istekler.map((x) => x.istekId);
    kontrol("§2a eşzamanlı iki `al` (enFazla 1) ayrık ve SINIRA uyar: 1+1", ia.length === 1 && ib.length === 1 && !ia.some((x) => ib.includes(x)), `${ia.length}+${ib.length}`);
    const hesap = new Date(o.saat.simdi()).toISOString();
    const s1 = await imzali(o, k, "/v1/rapor/sonuc", { govde: sonucGovdesi(id1, "sales/order-intake", hesap, { veri: { satirlar: [{ ay: "2026-09", metre: "1200.0" }] } }) });
    kontrol("§2b HAZIR sonucu kabul", s1.status === 200 && (s1.json as unknown as { kabul: boolean }).kabul === true, `${s1.status} ${JSON.stringify(s1.json).slice(0, 100)}`);
    const s1b = await imzali(o, k, "/v1/rapor/sonuc", { govde: sonucGovdesi(id1, "sales/order-intake", hesap, { veri: { satirlar: [] } }) });
    kontrol("§2c aynı isteğe tekrar sonuç (ağ tekrarı) → kabul, ilk sonuç korunur", s1b.status === 200);
    const g1 = await api(o, "GET", `/api/raporlar/${id1}`, { belirtec: satis.belirtec });
    const sonuc1 = (g1.json.data as { durum?: string; sonuc?: { veri?: { satirlar?: unknown[] } } }) ?? {};
    kontrol("§2d yazar sonucu görür", sonuc1.durum === "HAZIR" && sonuc1.sonuc?.veri?.satirlar?.length === 1);
    const baska = await tesisKur(o);
    try {
      const yabanci = await imzali(o, baska, "/v1/rapor/sonuc", { govde: sonucGovdesi(id2, "finance/aging", hesap, { hataKodu: "PARAMETRE_GECERSIZ" }) });
      kontrol("§2e başka tesisin kurulumu isteği göremez → 404", yabanci.status === 404);
    } finally {
      await temizleTesis(o, baska.tesisId);
    }
    const yanlisAnahtar = await imzali(o, k, "/v1/rapor/sonuc", { govde: sonucGovdesi(id2, "sales/order-intake", hesap, { veri: { x: 1 } }) });
    kontrol("§2e2 sonuç isteğin rapor anahtarıyla uyuşmuyor → 400", yanlisAnahtar.status === 400, `${yanlisAnahtar.status}`);
    const eskiBicim = await imzali(o, k, "/v1/rapor/sonuc", { govde: { v: 1, istekId: id2, durum: "HAZIR", veri: { x: 1 }, hesaplandi: hesap } });
    kontrol("§2e3 eksik alanlı (S13 öncesi) gövde → 400 GOVDE_GECERSIZ", eskiBicim.status === 400 && eskiBicim.json.details?.code === "GOVDE_GECERSIZ");
    const s2 = await imzali(o, k, "/v1/rapor/sonuc", { govde: sonucGovdesi(id2, "finance/aging", hesap, { veri: { kovalar: [{ gun: "0-30", tutar: "500.00" }] } }) });
    kontrol("§2f finans raporu sonucu kabul", s2.status === 200);

    console.log("\n§3 sonuç RLS'i");
    const yon = await api(o, "GET", `/api/raporlar/${id2}`, { belirtec: yonetici.belirtec });
    const yonVeri = yon.json.data as { durum?: string; sonuc?: unknown };
    kontrol("§3a yönetici isteği GÖRÜR ama finans ailesi izni yok → sonuc null", yon.status === 200 && yonVeri.durum === "HAZIR" && yonVeri.sonuc === null);
    const muh = await api(o, "GET", `/api/raporlar/${id2}`, { belirtec: muhasebe.belirtec });
    kontrol("§3b aile izni olan yazar sonucu görür", (muh.json.data as { sonuc?: { veri?: unknown } }).sonuc !== null);

    console.log("\n§4 5 dk içinde aynı parametre");
    const zil2 = o.zil.caldi.length;
    const tekrar = await iste(o, satis, "sales/order-intake");
    kontrol("§4a aynı parametre → doğrudan HAZIR (mevcut sonuç), zil YOK", tekrar.status === 201 && (tekrar.json.data as { durum?: string }).durum === "HAZIR" && o.zil.caldi.length === zil2);
    o.saat.ilerlet(6 * 60_000);
    const eskidi = await iste(o, satis, "sales/order-intake");
    kontrol("§4b 5 dk sonra → yeni hesap (BEKLIYOR)", (eskidi.json.data as { durum?: string }).durum === "BEKLIYOR");

    console.log("\n§4c standart görüntü (istekId null, S13)");
    const stdParam = { baslangic: "2026-08-01", bitis: "2026-08-31" };
    const std = await imzali(o, k, "/v1/rapor/sonuc", { govde: sonucGovdesi(null, "sales/order-intake", new Date(o.saat.simdi()).toISOString(), { veri: { satirlar: [] }, parametreler: stdParam, donem: "gecen-ay" }) });
    kontrol("§4c standart görüntü kabul", std.status === 200 && (std.json as unknown as { kabul?: boolean }).kabul === true, `${std.status} ${JSON.stringify(std.json).slice(0, 120)}`);
    const stdIstek = await iste(o, satis, "sales/order-intake", stdParam);
    kontrol("§4d aynı parametreli istek standart görüntüden doğrudan HAZIR", (stdIstek.json.data as { durum?: string }).durum === "HAZIR");
    const stdAudit = await imzali(o, k, "/v1/rapor/sonuc", { govde: sonucGovdesi(null, "audit/user-activity", new Date(o.saat.simdi()).toISOString(), { veri: {} }) });
    kontrol("§4e bulutta sunulmayan raporun standart görüntüsü → 404", stdAudit.status === 404);

    console.log("\n§5 claim süresi + iptal");
    const idE = (eskidi.json.data as { id: string }).id;
    const al1 = await imzali(o, k, "/v1/rapor/al", { govde: { v: 1 } });
    kontrol("§5a istek alındı", (al1.json as unknown as Alinan).istekler.some((x) => x.istekId === idE));
    const dk = (o.ctx.config.RAPOR_CLAIM_DK + 1) * 60_000;
    await expireClaims(o.ctx, o.saat.simdi() + dk);
    const d1 = await api(o, "GET", `/api/raporlar/${idE}`, { belirtec: satis.belirtec });
    kontrol("§5b ilk süre dolumu → BEKLIYOR", (d1.json.data as { durum?: string }).durum === "BEKLIYOR");
    await imzali(o, k, "/v1/rapor/al", { govde: { v: 1 } });
    await expireClaims(o.ctx, o.saat.simdi() + 2 * dk);
    const d2 = await api(o, "GET", `/api/raporlar/${idE}`, { belirtec: satis.belirtec });
    const v2 = d2.json.data as { durum?: string; hataKodu?: string };
    kontrol("§5c ikinci süre dolumu → HATA ZAMAN_ASIMI", v2.durum === "HATA" && v2.hataKodu === "ZAMAN_ASIMI");
    const bekleyen = await iste(o, satis, "sales/order-intake", { baslangic: "2026-01-01", bitis: "2026-01-31" });
    const idB = (bekleyen.json.data as { id: string }).id;
    const iptalBaska = await api(o, "POST", `/api/raporlar/${idB}/iptal`, { belirtec: yonetici.belirtec, govde: {} });
    const iptal = await api(o, "POST", `/api/raporlar/${idB}/iptal`, { belirtec: satis.belirtec, govde: {} });
    kontrol("§5d yalnız yazar iptal eder (başkası 404; yazar 200 IPTAL)", iptalBaska.status === 404 && iptal.status === 200 && (iptal.json.data as { durum?: string }).durum === "IPTAL");
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
