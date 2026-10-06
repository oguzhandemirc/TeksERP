// =============================================================================
// AÇIK MODÜLLER (K10): fabrikanın yoklamada bildirdiği AÇIK modül adları → kurulum durumu → portal ayrıntısı.
//   §1 uçtan uca (gerçek sunucu + süreç içi portal): alan YOKSA (eski fabrika) yoklama kabul + portal null ("bilinmiyor")
//      · alan VARSA sıralı saklanır + zaman damgası · sonraki yoklama alansız → önceki bildirim KALIR (silmez) ·
//      boş liste "hiçbiri açık değil" olarak saklanır · portal ayrıntısı listeyi taşır
//   §2 KATI şema: serbest metin / yinelenen ad / liste olmayan değer → yoklama 400 (iş verisi sızamaz)
// Koşum: npx tsx scripts/test_acik_moduller.ts   (yalnız *_test DB)
// =============================================================================
import { ENDPOINTS, parseJws, type LeaseDoc } from "../src/lisans-protokol";
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
  sunucuBaslat,
  temizleKurulumlar,
  temizlePortal,
  yoklamaGovdesi,
  type Yanit,
} from "./lib/test-ortam";

function kiraKimligi(y: Yanit): string | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as LeaseDoc).kiraId : null;
}

async function uctanUca(t: { kurulumlar: string[]; kidler: string[]; kullanicilar: string[] }): Promise<void> {
  const { prisma } = await import("../src/lib/prisma");
  const ortam = await anahtarOrtamiKur();
  const sunucu = await sunucuBaslat(ortam);
  const portal = await portalSunuculariKur(ortam.ctx);
  try {
    const k = await kurulumFiksturu(ortam.ctx);
    t.kurulumlar.push(k.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    t.kidler.push(anahtar.kid);
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId, amac: "etkinlestir", anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: ortam.f.parmakIzi }),
    });
    let uc: string | null = null;
    uc = kiraKimligi(et);
    const yokla = async (ek: Record<string, unknown> = {}) => {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
        kurulumId: k.kurulumId, amac: "yokla", anahtar,
        govde: { ...yoklamaGovdesi({ sonKiraId: uc, hak: { hakId: k.hakId, surum: 1 }, parmakIzi: ortam.f.parmakIzi }), ...ek },
      });
      const yeni = kiraKimligi(y);
      if (yeni) uc = yeni;
      return y;
    };
    const oku = () => prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId }, select: { acikModuller: true, acikModullerZamani: true } });

    console.log("\n§1 uçtan uca — yoklama → kurulum durumu → portal");
    const eski = await yokla();
    const d0 = await oku();
    kontrol("§1a ESKİ fabrika (alan yok): yoklama kabul, açık modül null (portal 'bilinmiyor')", eski.status === 200 && d0.acikModuller === null && d0.acikModullerZamani === null, `${eski.status}`);
    const y1 = await yokla({ acikModuller: ["tezgah.enabled", "finance.enabled", "production.enabled"] });
    const d1 = await oku();
    kontrol("§1b alan VARSA sıralı saklanır + zaman damgası", y1.status === 200 && JSON.stringify(d1.acikModuller) === '["finance.enabled","production.enabled","tezgah.enabled"]' && d1.acikModullerZamani !== null, JSON.stringify(d1.acikModuller));
    await yokla();
    const d2 = await oku();
    kontrol("§1c sonraki yoklama alansız: önceki bildirim KALIR (silinmez)", JSON.stringify(d2.acikModuller) === JSON.stringify(d1.acikModuller));
    const kul = await portalKullaniciAc(ortam.ctx, "SATICI_OPERATOR");
    t.kullanicilar.push(kul.id);
    const giris = await portalGiris(portal.portal, "/portal/api", kul);
    const detay = await portalIstek(portal.portal, `/portal/api/kurulumlar/${k.kurulumDbId}`, { cerez: giris.cerez ?? "" });
    const kur = (detay.json.data as { kurulum?: { acikModuller?: string[] | null } } | undefined)?.kurulum;
    kontrol("§1d portal ayrıntısı açık modül listesini taşır", detay.status === 200 && JSON.stringify(kur?.acikModuller) === '["finance.enabled","production.enabled","tezgah.enabled"]', JSON.stringify(kur?.acikModuller));
    await yokla({ acikModuller: [] });
    const d3 = await oku();
    kontrol("§1e boş liste 'hiçbiri açık değil' olarak saklanır (null'dan ayrı)", Array.isArray(d3.acikModuller) && (d3.acikModuller as unknown[]).length === 0);

    console.log("\n§2 KATI şema — iş verisi sızamaz");
    const kotu = await yokla({ acikModuller: ["Müşteri Adı Ltd"] });
    const cift = await yokla({ acikModuller: ["finance.enabled", "finance.enabled"] });
    const nesne = await yokla({ acikModuller: { finance: true } });
    kontrol("§2a serbest metin · yinelenen ad · liste olmayan değer → 400", kotu.status === 400 && cift.status === 400 && nesne.status === 400, `${kotu.status} ${cift.status} ${nesne.status}`);
    const d4 = await oku();
    kontrol("§2b reddedilen yoklama saklananı değiştirmez", Array.isArray(d4.acikModuller) && (d4.acikModuller as unknown[]).length === 0);
  } finally {
    await portal.kapat();
    await sunucu.durdur();
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const t = { kurulumlar: [] as string[], kidler: [] as string[], kullanicilar: [] as string[] };
  try {
    await uctanUca(t);
  } finally {
    await temizleKurulumlar(t.kurulumlar, t.kidler);
    await temizlePortal({ kullanicilar: t.kullanicilar });
    await kapat();
  }
  sonuc();
}

main().catch(async (e) => {
  console.error("❌ Bekçi çöktü:", e);
  await kapat();
  process.exit(1);
});
