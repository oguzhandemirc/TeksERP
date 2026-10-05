// =============================================================================
// İMZALI SAAT SAPMASI (§B-3): fabrikanın yoklamada bildirdiği `saat.imzaliSapmaSn` → Yoklama.saat → portal künyesi.
//   §1 uçtan uca: alan YOKSA (eski fabrika) yoklama kabul + künye null · alan VARSA Yoklama.saat'te durur + künyede
//      uyarı (|sapma| ≥ SIGNED_SKEW_WARN_SECONDS) · eşik kenarı 299/300/−300 · son yoklama alansız → künye null
//   §2 KATI şema: metin / kesirli / aralık dışı değer → yoklama 400
// Koşum: npx tsx scripts/test_imzali_saat_sapmasi.ts   (yalnız *_test DB)
// =============================================================================
import { ENDPOINTS, SIGNED_SKEW_WARN_SECONDS, parseJws, type LeaseDoc } from "../src/lisans-protokol";
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

type Kunye = { saatSapmasi?: { sapmaSn: number; uyari: boolean; esikSn: number; an: string } | null; yoklamalar?: { saat: Record<string, unknown> }[] };

async function uctanUca(t: { kurulumlar: string[]; kidler: string[]; kullanicilar: string[] }): Promise<void> {
  const ortam = await anahtarOrtamiKur();
  const sunucu = await sunucuBaslat(ortam);
  const portal = await portalSunuculariKur(ortam.ctx);
  try {
    const k = await kurulumFiksturu(ortam.ctx, { kanal: "bekci-saat" });
    t.kurulumlar.push(k.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    t.kidler.push(anahtar.kid);
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId, amac: "etkinlestir", anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: ortam.f.parmakIzi }),
    });
    let uc: string | null = kiraKimligi(et);
    const yokla = async (imzali?: unknown) => {
      const g = yoklamaGovdesi({ sonKiraId: uc, hak: { hakId: k.hakId, surum: 1 }, parmakIzi: ortam.f.parmakIzi });
      const govde = imzali === undefined ? g : { ...g, saat: { ...g.saat, imzaliSapmaSn: imzali } };
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde });
      const yeni = kiraKimligi(y);
      if (yeni) uc = yeni;
      return y;
    };
    const kul = await portalKullaniciAc(ortam.ctx, "SATICI_OPERATOR");
    t.kullanicilar.push(kul.id);
    const giris = await portalGiris(portal.portal, "/portal/api", kul);
    const kunye = async (): Promise<Kunye> =>
      ((await portalIstek(portal.portal, `/portal/api/kurulumlar/${k.kurulumDbId}`, { cerez: giris.cerez ?? "" })).json.data ?? {}) as Kunye;

    console.log("\n§1 uçtan uca — yoklama → Yoklama.saat → portal künyesi");
    const eski = await yokla();
    const d0 = await kunye();
    kontrol("§1a ESKİ fabrika (alan yok): yoklama kabul, künye saatSapmasi null", eski.status === 200 && d0.saatSapmasi === null, `${eski.status} ${JSON.stringify(d0.saatSapmasi)}`);
    const y1 = await yokla(420);
    const d1 = await kunye();
    kontrol(
      "§1b ⭐ alan VARSA Yoklama.saat'te durur + künyede uyarı (7 dk ≥ eşik)",
      y1.status === 200 && d1.yoklamalar?.[0]?.saat.imzaliSapmaSn === 420 && d1.saatSapmasi?.sapmaSn === 420 && d1.saatSapmasi.uyari && d1.saatSapmasi.esikSn === SIGNED_SKEW_WARN_SECONDS,
      `${y1.status} ${JSON.stringify(d1.saatSapmasi)}`,
    );
    await yokla(SIGNED_SKEW_WARN_SECONDS - 1);
    const alt = (await kunye()).saatSapmasi;
    await yokla(SIGNED_SKEW_WARN_SECONDS);
    const esik = (await kunye()).saatSapmasi;
    await yokla(-SIGNED_SKEW_WARN_SECONDS);
    const geri = (await kunye()).saatSapmasi;
    kontrol("§1c eşik kenarı: 299 → uyarı yok · 300 → uyarı · −300 → uyarı (yön fark etmez)", alt?.uyari === false && esik?.uyari === true && geri?.uyari === true, `${JSON.stringify(alt)} ${JSON.stringify(esik)} ${JSON.stringify(geri)}`);
    await yokla();
    const d2 = await kunye();
    kontrol("§1d son yoklama alansız (ölçülmedi) → künye null; geçmiş satır alanı korur", d2.saatSapmasi === null && d2.yoklamalar?.[1]?.saat.imzaliSapmaSn === -SIGNED_SKEW_WARN_SECONDS, JSON.stringify(d2.saatSapmasi));

    console.log("\n§2 KATI şema");
    const metin = await yokla("420");
    const kesir = await yokla(1.5);
    const asiri = await yokla(2e9);
    kontrol("§2a metin · kesirli · aralık dışı → 400", metin.status === 400 && kesir.status === 400 && asiri.status === 400, `${metin.status} ${kesir.status} ${asiri.status}`);
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
