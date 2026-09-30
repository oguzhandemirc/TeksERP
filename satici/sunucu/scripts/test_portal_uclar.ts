// =============================================================================
// PORTAL UÇLARI — rota KAPSAMI. Satıcı (tailnet) ve bayi (genel) rota tablolarındaki HER rota gerçek
// bir iş akışında en az bir kez beklenen durumla çağrılır (kanal → müşteri → tesis → kurulum → HAK imzası →
// kod → /v1 etkinleştirme → yaptırım/uzatma/planlı/taksit → kopya uyarısı → taşıma → iptal → DR geri
// alma → bayi → kullanıcı → denetim → anahtar → oturum). Sonda tablo ile çağrılan küme EŞİTLENİR:
// tabloya eklenen ama burada koşulmayan rota KIRMIZIDIR (yeni uç ölçülmeden doğmaz).
// Yanıt hijyeni: anahtar durumu ve kullanıcı görünümü özel yarı / parola özeti / şifreli sır taşımaz.
// Kanal: kurulum yalnız KAYITLI kanala bağlanır; kiranın `kanal.guncelSurumler`i kanal satırından gelir.
// ⭐ KALICI SONDA ✓K1 (her koşumda): kapsam karşılaştırıcısı sentetik eksik ve fazla kümede ısırır.
// Koşum: npx tsx scripts/test_portal_uclar.ts
// =============================================================================
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DAY_MS, ENDPOINTS, parseJws } from "../src/lisans-protokol";
import { DEALER_PORTAL_ROUTES } from "../src/http/dealer-routes";
import type { PortalRouteDef } from "../src/http/portal-http";
import { VENDOR_PORTAL_ROUTES } from "../src/http/portal-routes";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { sertifikaBas, sertifikaYuku } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  ORTAM,
  TEST_KOK_PAROLASI,
  anahtarOrtamiKur,
  bayiKurulumlari,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kanalFiksturu,
  kapat,
  kontrol,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizleDagitim,
  temizlePortal,
  totpKodu,
  type PortalYanit,
} from "./lib/test-ortam";

/** Kapsam karşılaştırıcısı: tablo − çağrılan (eksik) ve çağrılan − tablo (hayalet). */
export function coverageGaps(table: readonly Pick<PortalRouteDef, "method" | "path">[], hit: ReadonlySet<string>): { missing: string[]; ghost: string[] } {
  const keys = new Set(table.map((r) => `${r.method.toUpperCase()} ${r.path}`));
  return { missing: [...keys].filter((k) => !hit.has(k)), ghost: [...hit].filter((k) => !keys.has(k)) };
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const dagitimKoku = mkdtempSync(path.join(os.tmpdir(), "uclar-dagitim-"));
  const derlemeDizini = path.join(dagitimKoku, "derlemeler");
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000", DOSYA_DIZINI: path.join(dagitimKoku, "dosyalar"), DERLEME_DIZINI: derlemeDizini });
  const { ctx, f } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const kullanicilar: string[] = [];
  const bayiler: string[] = [];
  const kurulumlar: string[] = [];
  const musteriler: string[] = [];
  const tesisler: string[] = [];
  const kanal = `uclar-${randomUUID().slice(0, 8)}`;
  const sunucu = await portalSunuculariKur(ctx);
  const vendorHit = new Set<string>();
  const bildirimJetonlari: string[] = [];
  const dealerHit = new Set<string>();
  const sapmalar: string[] = [];
  try {
    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    kullanicilar.push(yonetici.id);
    const cerez = (await portalGiris(sunucu.tailnet, "/portal/api", yonetici)).cerez!;
    /** Satıcı rotası: şablon + gerçek yol + beklenen durum. */
    const s = async (yontem: "get" | "post" | "patch", sablon: string, gercek: string, beklenen: number, govde?: object): Promise<PortalYanit> => {
      const y = await portalIstek(sunucu.tailnet, `/portal/api${gercek}`, {
        cerez,
        yontem: yontem.toUpperCase(),
        ...(govde === undefined ? {} : { govde: { clientToken: randomUUID(), ...govde } }),
      });
      vendorHit.add(`${yontem.toUpperCase()} ${sablon}`);
      if (y.status !== beklenen) sapmalar.push(`${yontem.toUpperCase()} ${sablon} → ${y.status} ${y.kod ?? ""} (beklenen ${beklenen}) ${String(y.json.message ?? "")}`);
      return y;
    };

    console.log("\n§1 satıcı akışı");
    const akisBaslangici = new Date(Date.now() - 1000);
    await s("get", "/katalog", "/katalog", 200);
    const kn = await s("post", "/kanallar", "/kanallar", 201, { kod: kanal, ad: "Uçlar kanalı", tur: "hazirlik" });
    const knTekrar = await portalIstek(sunucu.tailnet, "/portal/api/kanallar", { cerez, govde: { clientToken: randomUUID(), kod: kanal, ad: "x", tur: "uretim" } });
    const knSurumBozuk = await portalIstek(sunucu.tailnet, `/portal/api/kanallar/${kn.veri.id as string}`, { cerez, yontem: "PATCH", govde: { clientToken: randomUUID(), guncelSurumler: { panel: "1.3", web: "1.0.0" } } });
    kontrol("§1k0 aynı kanal kodu → 409; sürüm şeması dışı güncel sürüm → 400", knTekrar.status === 409 && knSurumBozuk.status === 400, `${knTekrar.status}/${knSurumBozuk.status}`);
    await s("patch", "/kanallar/:id", `/kanallar/${kn.veri.id as string}`, 200, { tur: "uretim", guncelSurumler: { backend: "2.11.2", panel: "1.3.2" } });
    const knListe = await s("get", "/kanallar", "/kanallar", 200);
    kontrol("§1k1 kanal listesinde kod · tür · güncel sürümler", JSON.stringify((knListe.veri as unknown as { kod: string; tur: string }[]).find((x) => x.kod === kanal)?.tur) === '"uretim"');
    const m = await s("post", "/musteriler", "/musteriler", 201, { ad: "Uçlar Tekstil", vergiNo: "1234567890" });
    const mId = m.veri.id as string;
    musteriler.push(mId);
    await s("patch", "/musteriler/:id", `/musteriler/${mId}`, 200, { vergiNo: "0987654321" });
    const liste = await s("get", "/musteriler", "/musteriler?arama=Uçlar&aktif=true&limit=5", 200);
    await s("get", "/musteriler/:id", `/musteriler/${mId}`, 200);
    const t = await s("post", "/tesisler", "/tesisler", 201, { musteriId: mId, ad: "Merkez" });
    const tId = t.veri.id as string;
    tesisler.push(tId);
    await s("patch", "/tesisler/:id", `/tesisler/${tId}`, 200, { ad: "Merkez Tesis" });
    await s("get", "/tesisler", `/tesisler?musteriId=${mId}`, 200);
    const kayitsiz = await portalIstek(sunucu.tailnet, "/portal/api/kurulumlar", { cerez, govde: { clientToken: randomUUID(), tesisId: tId, sinif: "URETIM", kanalKodu: "kayitsiz-kanal-yok" } });
    kontrol("§1k2 kayıtlı olmayan kanala kurulum açılamaz → 400", kayitsiz.status === 400, `${kayitsiz.status} ${kayitsiz.kod ?? ""}`);
    const istemciKimligi = await portalIstek(sunucu.tailnet, "/portal/api/kurulumlar", { cerez, govde: { clientToken: randomUUID(), tesisId: tId, kurulumId: randomUUID(), sinif: "URETIM", kanalKodu: kanal } });
    kontrol("§1k3 lisans kimliğini istemci VEREMEZ (D14; KATI gövde) → 400", istemciKimligi.status === 400 && istemciKimligi.kod === "GOVDE_GECERSIZ", `${istemciKimligi.status} ${istemciKimligi.kod ?? ""}`);
    const k = await s("post", "/kurulumlar", "/kurulumlar", 201, { tesisId: tId, sinif: "URETIM", kanalKodu: kanal, ad: "Ana sunucu" });
    const kId = k.veri.id as string;
    const kurulumId = k.veri.kurulumId as string;
    kontrol("§1k4 ✓K lisans kimliği sunucuda doğdu (UUID, satıcı kaydının id'sinden ayrı)", /^[0-9a-f-]{36}$/.test(kurulumId) && kurulumId !== kId, kurulumId);
    kurulumlar.push(kId);
    await s("patch", "/kurulumlar/:id", `/kurulumlar/${kId}`, 200, { yoklamaAraligiDk: 30, sinif: "TEST" });
    await portalIstek(sunucu.tailnet, `/portal/api/kurulumlar/${kId}`, { cerez, yontem: "PATCH", govde: { clientToken: randomUUID(), sinif: "URETIM" } });

    console.log("\n§1z dağıtım rotaları (Faz 3d; davranış test_dagitim_* bekçilerinde)");
    mkdirSync(derlemeDizini, { recursive: true });
    writeFileSync(path.join(derlemeDizini, "TeksERP-uclar.exe"), Buffer.from("uclar-derleme"));
    const ozet = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    await s("get", "/dagitim/derlemeler", "/dagitim/derlemeler", 200);
    const dBag = await s("post", "/dagitim/baglantilar", "/dagitim/baglantilar", 201, { tur: "ILK_KURULUM", musteriId: mId, kurulumId: kId, derlemeAdi: "TeksERP-uclar.exe", gecerlilikSaat: 1, azamiIndirme: 1 });
    await s("get", "/dagitim/baglantilar", `/dagitim/baglantilar?musteriId=${mId}`, 200);
    await s("post", "/dagitim/baglantilar/:id/iptal", `/dagitim/baglantilar/${(dBag.veri.baglanti as { id: string }).id}/iptal`, 200, { sebep: "uçlar kapsamı" });
    const dIst = await s("post", "/dagitim/yukleme-istekleri", "/dagitim/yukleme-istekleri", 201, { musteriId: mId, gecerlilikSaat: 1, kotaMb: 2, azamiDosyaMb: 1 });
    await s("get", "/dagitim/yukleme-istekleri", `/dagitim/yukleme-istekleri?musteriId=${mId}`, 200);
    await s("post", "/dagitim/yukleme-istekleri/:id/iptal", `/dagitim/yukleme-istekleri/${(dIst.veri.istek as { id: string }).id}/iptal`, 200, { sebep: "uçlar kapsamı" });
    const dIcerik = Buffer.from("uçlar giden dosyası");
    const dOt = await s("post", "/dagitim/giden-oturum", "/dagitim/giden-oturum", 200, { musteriId: mId, dosyaAdi: "not.txt", boyut: dIcerik.length, sha256: ozet(dIcerik) });
    const dOid = dOt.veri.oturumId as string;
    const dPut = await fetch(`${sunucu.tailnet}/portal/api/ham/giden-oturum/${dOid}/parca/0`, { method: "PUT", headers: { Cookie: cerez, "X-Parca-Sha256": ozet(dIcerik) }, body: new Uint8Array(dIcerik) });
    kontrol("§1z0 ham parça ucu (JSON tablosu dışı) oturumla 200", dPut.status === 200, `${dPut.status}`);
    await s("get", "/dagitim/giden-oturum/:id", `/dagitim/giden-oturum/${dOid}`, 200);
    await s("post", "/dagitim/giden-oturum/:id/tamamla", `/dagitim/giden-oturum/${dOid}/tamamla`, 200, {});
    await s("get", "/dagitim/dosyalar", `/dagitim/dosyalar?musteriId=${mId}`, 200);
    await s("get", "/dagitim/defter", `/dagitim/defter?musteriId=${mId}`, 200);
    await s("get", "/surumler", "/surumler", 200);
    const dYk = await s("post", "/yayincilar", "/yayincilar", 201, { kid: `uclar-${kanal}`, ad: "Uçlar yayıncı", acikAnahtar: generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x });
    await s("get", "/yayincilar", "/yayincilar", 200);
    await s("post", "/yayincilar/:id/pasif", `/yayincilar/${dYk.veri.id as string}/pasif`, 200, { sebep: "uçlar kapsamı" });
    const hak = await s("post", "/kurulumlar/:id/hak", `/kurulumlar/${kId}/hak`, 201, { kalici: false, bakimBitis: new Date(Date.now() + 365 * DAY_MS).toISOString() });
    const hakId = hak.veri.id as string;
    const uretimsiz = await portalIstek(sunucu.tailnet, `/portal/api/haklar/${hakId}/surum`, { cerez, govde: { clientToken: randomUUID(), kokParolasi: TEST_KOK_PAROLASI, sebep: "x", moduller: ["finance.enabled"] } });
    kontrol("§1a üretim modülü onaysız çıkarılamaz → 400 URETIM_MODULU_UYARISI", uretimsiz.status === 400 && uretimsiz.kod === "URETIM_MODULU_UYARISI", `${uretimsiz.status} ${uretimsiz.kod}`);
    const yanlisKok = await portalIstek(sunucu.tailnet, `/portal/api/haklar/${hakId}/surum`, { cerez, govde: { clientToken: randomUUID(), kokParolasi: "yanlis-kok-parolasi-x", sebep: "ilk imza" } });
    kontrol("§1b yanlış kök parolası → 400 IMZA_PAROLASI_HATALI", yanlisKok.status === 400 && yanlisKok.kod === "IMZA_PAROLASI_HATALI", `${yanlisKok.status} ${yanlisKok.kod}`);
    await s("post", "/haklar/:id/surum", `/haklar/${hakId}/surum`, 201, { kokParolasi: TEST_KOK_PAROLASI, sebep: "ilk imza", moduller: ["production.enabled", "finance.enabled"] });
    const sinifImzali = await portalIstek(sunucu.tailnet, `/portal/api/kurulumlar/${kId}`, { cerez, yontem: "PATCH", govde: { clientToken: randomUUID(), sinif: "TEST" } });
    kontrol("§1c imzalı hakkı olan kurulumun sınıfı değişmez → 409", sinifImzali.status === 409, `${sinifImzali.status}`);
    const hakAyrinti = await s("get", "/haklar/:id", `/haklar/${hakId}`, 200);
    kontrol("§1d HAK ayrıntısı: sürüm 1 imzalı, modüller uygulandı", (hakAyrinti.veri.guncelSurum as number) === 1 && JSON.stringify(hakAyrinti.veri.moduller) === '["production.enabled","finance.enabled"]');
    const kod = await s("post", "/kurulumlar/:id/etkinlestirme-kodu", `/kurulumlar/${kId}/etkinlestirme-kodu`, 201, { gecerlilikGun: 7 });
    const anahtar = kurulumAnahtariUret();
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: kod.veri.kod as string, kurulumId, anahtar, parmakIzi: f.parmakIzi }),
    });
    kontrol("§1e portalın ürettiği kodla /v1/etkinlestir → 200", et.status === 200, `${et.status} ${et.kod ?? ""}`);
    const kira = parseJws(et.json.kira);
    const kiraKanali = kira.ok ? (kira.value.payload.kanal as { kod?: string; guncelSurumler?: unknown } | undefined) : undefined;
    kontrol(
      "§1e2 kiranın kanalı kurulumun kanalı, güncel sürümler KANAL satırından",
      kiraKanali?.kod === kanal && JSON.stringify(kiraKanali.guncelSurumler) === JSON.stringify({ backend: "2.11.2", panel: "1.3.2" }),
      JSON.stringify(kiraKanali),
    );

    await s("post", "/kurulumlar/:id/zorlama", `/kurulumlar/${kId}/zorlama`, 200, { zorla: true, sebep: "gözlem temiz" });
    await s("post", "/kurulumlar/:id/uzat", `/kurulumlar/${kId}/uzat`, 200, { gun: 10, sebep: "10 gün uzat" });
    await s("post", "/kurulumlar/:id/gecerlilik", `/kurulumlar/${kId}/gecerlilik`, 200, { tarih: null, sebep: "kalıcı" });
    const k2 = await s("post", "/kurulumlar/:id/yaptirim", `/kurulumlar/${kId}/yaptirim`, 201, { kademe: "K2", moduller: ["finance.enabled"], sebep: "finans ödenmedi" });
    await s("post", "/yaptirimlar/:id/geri-al", `/yaptirimlar/${k2.veri.id as string}/geri-al`, 201, { sebep: "ödendi" });
    const k5 = await s("post", "/kurulumlar/:id/agir-yaptirim", `/kurulumlar/${kId}/agir-yaptirim`, 201, { kademe: "K5", sebep: "tam durdurma", onay: hak.veri.lisansNo });
    await portalIstek(sunucu.tailnet, `/portal/api/yaptirimlar/${k5.veri.id as string}/geri-al`, { cerez, govde: { clientToken: randomUUID(), sebep: "uzlaşıldı" } });
    const planli = await s("post", "/kurulumlar/:id/planli-eylem", `/kurulumlar/${kId}/planli-eylem`, 201, { kademe: "K0", vade: new Date(Date.now() + DAY_MS).toISOString(), mesaj: "hatırlatma", sebep: "vade" });
    await s("get", "/planli-eylemler", `/planli-eylemler?durum=BEKLIYOR&kurulumId=${kId}`, 200);
    await s("post", "/planli-eylemler/:id/iptal", `/planli-eylemler/${planli.veri.id as string}/iptal`, 200, { sebep: "gerek kalmadı" });
    const plan = await s("post", "/kurulumlar/:id/taksit-plani", `/kurulumlar/${kId}/taksit-plani`, 201, {
      aciklama: "tek taksit",
      kalemler: [{ vade: new Date(Date.now() + 20 * DAY_MS).toISOString(), tutar: "100.00" }],
    });
    await s("post", "/taksit-kalemleri/:id/odeme", `/taksit-kalemleri/${(plan.veri.kalemler as { id: string }[])[0]!.id}/odeme`, 200, {});
    await s("post", "/taksit-planlari/:id/kapat", `/taksit-planlari/${plan.veri.id as string}/kapat`, 200, { sebep: "tamamlandı" });

    const uyari = await prisma.kopyaUyarisi.create({
      data: { kurulumId: kId, tur: "PARMAK_IZI_UYUSMAZ", ilkGorulme: new Date(), sonGorulme: new Date(), sahipParmakIzi: f.parmakIzi, digerParmakIzi: f.parmakIzi },
    });
    await s("get", "/kopya-uyarilari", "/kopya-uyarilari?durum=ACIK", 200);
    await s("post", "/kopya-uyarilari/:id/kapat", `/kopya-uyarilari/${uyari.id}/kapat`, 200, { sebep: "anakart değişti", digerParmakIziniKabulEt: true });

    // Destek kutusu (3d-2): talep fabrikadan `/v1/destek` ile doğar — burada fikstür olarak DB'den.
    const talep = await prisma.destekTalebi.create({
      data: { kurulumId: kId, talepId: randomUUID(), talepNo: `DST-U${randomUUID().slice(0, 8)}`, konu: "uç kapsamı", aciklama: "uç kapsamı",
        ekTuru: "image/png", ek: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), saglik: {}, ortam: {} },
    });
    await s("get", "/destek", "/destek?durum=ACIK", 200);
    await s("get", "/destek/:id", `/destek/${talep.id}`, 200);
    await s("get", "/destek/:id/ek", `/destek/${talep.id}/ek`, 200);
    await s("post", "/destek/:id/yanitla", `/destek/${talep.id}/yanitla`, 200, { metin: "incelendi" });
    await s("post", "/destek/:id/kapat", `/destek/${talep.id}/kapat`, 200, { not: null });

    const tasi = async () => {
      const yeni = kurulumAnahtariUret();
      const r = await imzaliPost(sunucu.genel, ENDPOINTS.TRANSFER, {
        kurulumId,
        amac: "tasima",
        anahtar: yeni,
        govde: { v: 1, kurulumId, acikAnahtar: yeni.x, parmakIzi: f.parmakIzi, ortam: ORTAM, gerekce: "yeni sunucu" },
      });
      return r.json.talepId as string;
    };
    const red = await tasi();
    await s("get", "/tasima-talepleri", "/tasima-talepleri?durum=BEKLIYOR", 200);
    await s("post", "/tasima-talepleri/:id/reddet", `/tasima-talepleri/${red}/reddet`, 200, { sebep: "tanımadığımız makine" });
    const onay = await tasi();
    const onayYanit = await s("post", "/tasima-talepleri/:id/onayla", `/tasima-talepleri/${onay}/onayla`, 200, { sebep: "müşteri aradı" });
    const tasimaKodu = onayYanit.veri.tasimaKodu as { kod?: string | null; kodSonu?: string } | null;
    kontrol("§1l onay tek kullanımlık TAŞIMA KODU döner (düz kod yalnız bu yanıtta)", /^TKS(-[0-9A-Z]{4}){4}$/.test(String(tasimaKodu?.kod)) && tasimaKodu?.kodSonu === String(tasimaKodu?.kod).slice(-4), JSON.stringify(tasimaKodu?.kodSonu));
    const saklananlar = await prisma.portalIslemi.findMany({ where: { eylem: { in: ["KOD_URET", "TASIMA_ONAYLANDI"] }, createdAt: { gte: akisBaslangici } } });
    const saklananMetin = JSON.stringify(saklananlar.map((r) => r.yanit));
    kontrol(
      "§1l2 saklanan (tekrar) yanıt ne kodu ne son 4'ünü taşır — son 4 YALNIZ kod satırında",
      saklananlar.length >= 2 && !saklananMetin.includes("kodSonu") && !saklananMetin.includes(String(tasimaKodu?.kod)) && !saklananMetin.includes(String(kod.veri.kod)),
      `${saklananlar.length} satır`,
    );

    await s("post", "/kurulumlar/:id/iptal", `/kurulumlar/${kId}/iptal`, 200, { sebep: "sözleşme feshi" });
    await s("post", "/kurulumlar/:id/iptal-geri-al", `/kurulumlar/${kId}/iptal-geri-al`, 200, { sebep: "yanlış kurulum iptal edildi" });
    await prisma.kurulum.update({ where: { id: kId }, data: { durum: "DEVREDILDI" } });
    await s("post", "/kurulumlar/:id/dr-geri-al", `/kurulumlar/${kId}/dr-geri-al`, 200, { sebep: "ana sunucu döndü" });

    const bos = await s("post", "/kurulumlar", "/kurulumlar", 201, { tesisId: tId, sinif: "TEST", kanalKodu: kanal });
    kurulumlar.push(bos.veri.id as string);
    const canliPasif = await portalIstek(sunucu.tailnet, `/portal/api/kurulumlar/${kId}/pasif`, { cerez, govde: { clientToken: randomUUID(), sebep: "x" } });
    kontrol("§1f ETKİN kurulum pasife alınamaz (önce iptal) → 409", canliPasif.status === 409, `${canliPasif.status}`);
    await s("post", "/kurulumlar/:id/pasif", `/kurulumlar/${bos.veri.id as string}/pasif`, 200, { sebep: "yanlış açıldı" });
    await s("post", "/kurulumlar/:id/aktif", `/kurulumlar/${bos.veri.id as string}/aktif`, 200, { sebep: "geri alındı" });
    const tesisPasif = await portalIstek(sunucu.tailnet, `/portal/api/tesisler/${tId}/pasif`, { cerez, govde: { clientToken: randomUUID(), sebep: "x" } });
    kontrol("§1g aktif kurulumu olan tesis pasife alınamaz (MV-06) → 409", tesisPasif.status === 409, `${tesisPasif.status}`);
    const t2 = await portalIstek(sunucu.tailnet, "/portal/api/tesisler", { cerez, govde: { clientToken: randomUUID(), musteriId: mId, ad: "Depo" } });
    tesisler.push(t2.veri.id as string);
    await s("post", "/tesisler/:id/pasif", `/tesisler/${t2.veri.id as string}/pasif`, 200, { sebep: "kapandı" });
    await s("post", "/tesisler/:id/aktif", `/tesisler/${t2.veri.id as string}/aktif`, 200, { sebep: "açıldı" });
    const m2 = await portalIstek(sunucu.tailnet, "/portal/api/musteriler", { cerez, govde: { clientToken: randomUUID(), ad: "Boş Müşteri" } });
    musteriler.push(m2.veri.id as string);
    await s("post", "/musteriler/:id/pasif", `/musteriler/${m2.veri.id as string}/pasif`, 200, { sebep: "çalışmıyoruz" });
    await s("post", "/musteriler/:id/aktif", `/musteriler/${m2.veri.id as string}/aktif`, 200, { sebep: "döndü" });

    const kurulumListe = await s("get", "/kurulumlar", `/kurulumlar?durum=ETKIN&arama=${encodeURIComponent("Uçlar")}`, 200);
    const ayrinti = await s("get", "/kurulumlar/:id", `/kurulumlar/${kId}`, 200);
    kontrol(
      "§1h kurulum künyesi: hak · sürümler · yaptırım defteri · kiralar · yoklamalar · uyarılar · talepler · planlar · kayıt",
      ["hak", "hakSurumleri", "yaptirim", "yaptirimDefteri", "kiralar", "yoklamalar", "kopyaUyarilari", "tasimaTalepleri", "planliEylemler", "taksitPlanlari", "kurulumKaydi", "etkinlestirmeKodlari"].every((x) => x in ayrinti.veri),
      Object.keys(ayrinti.veri).join(","),
    );
    kontrol("§1i listeler süzmeyle dolu (müşteri araması · ETKİN kurulum araması)", ((liste.veri.items as unknown[]) ?? []).length === 1 && ((kurulumListe.veri.items as unknown[]) ?? []).length === 1);
    const pano = await s("get", "/pano", "/pano", 200);
    kontrol("§1j pano sayıları", typeof pano.veri.acikKopyaUyarisi === "number" && typeof pano.veri.kurulumlar === "object");

    console.log("\n§2 bayi · kullanıcı · denetim · anahtar");
    const bayi = await s("post", "/bayiler", "/bayiler", 201, { ad: "Uçlar Bayi", tavan: { moduller: ["production.enabled"], siniflar: ["URETIM"], kurulumAdedi: 3 }, sebep: "sözleşme" });
    const bayiId = bayi.veri.id as string;
    bayiler.push(bayiId);
    await kanalFiksturu("bayi-kanal");
    await s("post", "/bayiler/:id/tavan", `/bayiler/${bayiId}/tavan`, 201, {
      tavan: { moduller: ["production.enabled", "finance.enabled"], siniflar: ["URETIM"], kurulumAdedi: 3, kanallar: ["bayi-kanal"], kaliciIzni: true, bakimAyTavani: 24 },
      sebep: "finans eklendi",
    });
    const sertifika = sertifikaBas(f.kok, sertifikaYuku(f, f.bayi, "BAYI", { siniflar: ["URETIM"], bayi: { bayiId, moduller: ["production.enabled", "finance.enabled"] } }));
    writeKeyFileExclusive(
      path.join(ortam.dizin, `${f.bayi.kid}.bayi.json`),
      await wrapPrivateKey({ tur: "tekserp-bayi-anahtar", kid: f.bayi.kid, siniflar: ["URETIM"], sertifika }, f.bayi.privateKey, passwordBuffer("uclar-bayi-parolasi")),
    );
    await s("post", "/bayiler/:id/anahtar", `/bayiler/${bayiId}/anahtar`, 200, { kid: f.bayi.kid });
    await s("get", "/bayiler", "/bayiler", 200);
    const bayiAyrinti = await s("get", "/bayiler/:id", `/bayiler/${bayiId}`, 200);
    kontrol("§2a bayi ayrıntısı: güncel tavan v2 + geçmiş", (bayiAyrinti.veri.tavan as { surum: number }).surum === 2 && (bayiAyrinti.veri.tavanGecmisi as unknown[]).length === 2);
    await s("post", "/bayiler/:id/pasif", `/bayiler/${bayiId}/pasif`, 200, { sebep: "askı" });
    await s("post", "/bayiler/:id/aktif", `/bayiler/${bayiId}/aktif`, 200, { sebep: "askı bitti" });

    const opParola = `op-parola-${randomUUID()}`;
    const op = await s("post", "/kullanicilar", "/kullanicilar", 201, { kullaniciAdi: `bekci-${randomUUID().slice(0, 12)}`, adSoyad: "Operatör", rol: "SATICI_OPERATOR", parola: opParola });
    const opId = (op.veri.kullanici as { id: string }).id;
    kullanicilar.push(opId);
    const kullaniciListe = await s("get", "/kullanicilar", "/kullanicilar", 200);
    const listeMetni = JSON.stringify(kullaniciListe.veri);
    kontrol("§2b kullanıcı listesinde parola özeti / şifreli sır YOK", !/parolaOzeti|totpSirSifreli|scrypt\$/.test(listeMetni));
    await prisma.portalKullanici.update({ where: { id: opId }, data: { kilitBitis: new Date(Date.now() + 600_000) } });
    await s("post", "/kullanicilar/:id/kilit-ac", `/kullanicilar/${opId}/kilit-ac`, 200, {});
    await s("post", "/kullanicilar/:id/parola", `/kullanicilar/${opId}/parola`, 200, { parola: `yeni-${opParola}`, sebep: "unuttu" });
    await s("post", "/kullanicilar/:id/totp-sifirla", `/kullanicilar/${opId}/totp-sifirla`, 200, { sebep: "telefon değişti" });
    await s("post", "/kullanicilar/:id/pasif", `/kullanicilar/${opId}/pasif`, 200, { sebep: "ayrıldı" });
    await s("post", "/kullanicilar/:id/aktif", `/kullanicilar/${opId}/aktif`, 200, { sebep: "döndü" });

    const denetim = await s("get", "/denetim", `/denetim?varlik=Kurulum&varlikId=${kId}&limit=2`, 200);
    const imlec = denetim.veri.nextCursor as string | null;
    const denetim2 = imlec ? await portalIstek(sunucu.tailnet, `/portal/api/denetim?varlik=Kurulum&varlikId=${kId}&limit=2&imlec=${imlec}`, { cerez }) : null;
    const ilk = (denetim.veri.items as { id: string }[]).map((x) => x.id);
    const ikinci = ((denetim2?.veri.items as { id: string }[] | undefined) ?? []).map((x) => x.id);
    kontrol("§2c denetim imleçli sayfa: 2 + sonraki sayfa, kesişim yok", ilk.length === 2 && ikinci.length > 0 && !ikinci.some((x) => ilk.includes(x)), `${ilk.length}/${ikinci.length}`);
    const anahtarlar = await s("get", "/anahtarlar", "/anahtarlar", 200);
    const anahtarMetni = JSON.stringify(anahtarlar.veri);
    kontrol("§2d anahtar durumu yalnız açık yarı (özel yarı / parola yok)", !anahtarMetni.includes('"d"') && !/privateKey|parola|sifreli/.test(anahtarMetni) && anahtarMetni.includes(f.kok.x));
    // Bildirimler (davranış test_bildirim_* bekçilerinde): deneme giden kutusuna kanal başına satır yazar.
    const bildirimJetonu = randomUUID();
    bildirimJetonlari.push(bildirimJetonu);
    const deneme = await s("post", "/bildirimler/deneme", "/bildirimler/deneme", 201, { clientToken: bildirimJetonu });
    const bListe = await s("get", "/bildirimler", "/bildirimler?olay=DENEME&kanal=TELEGRAM&durum=BEKLIYOR&limit=5", 200);
    const bDurum = await s("get", "/bildirimler/durum", "/bildirimler/durum", 200);
    kontrol(
      "§2e bildirim: deneme kanal başına satır yazar · liste süzülür · kanal durumu iki kanalı taşır",
      deneme.veri.yazilan === 2 && (bListe.veri.items as { kanal: string }[]).every((x) => x.kanal === "TELEGRAM") && (bDurum.veri.kanallar as unknown[]).length === 2,
      `${String(deneme.veri.yazilan)} · ${(bListe.veri.items as unknown[]).length}`,
    );

    console.log("\n§3 bayi alt-portalı okumaları");
    const bayiK = await portalKullaniciAc(ctx, "BAYI", bayiId);
    kullanicilar.push(bayiK.id);
    const bCerez = (await portalGiris(sunucu.genel, "/bayi/api", bayiK)).cerez!;
    const b = async (yontem: "get" | "post", sablon: string, gercek: string, beklenen: number, govde?: object): Promise<PortalYanit> => {
      const y = await portalIstek(sunucu.genel, `/bayi/api${gercek}`, { cerez: bCerez, yontem: yontem.toUpperCase(), ...(govde === undefined ? {} : { govde: { clientToken: randomUUID(), ...govde } }) });
      dealerHit.add(`${yontem.toUpperCase()} ${sablon}`);
      if (y.status !== beklenen) sapmalar.push(`bayi ${yontem.toUpperCase()} ${sablon} → ${y.status} ${y.kod ?? ""} (beklenen ${beklenen}) ${String(y.json.message ?? "")}`);
      return y;
    };
    const ben = await b("get", "/ben", "/ben", 200);
    kontrol("§3a /ben: tavan + kullanım + anahtar bağlı", (ben.veri.tavan as { surum: number }).surum === 2 && ben.veri.kullanim === 0 && ben.veri.anahtarBagli === true);
    const bm = await b("post", "/musteriler", "/musteriler", 201, { ad: "Bayi Müşterisi" });
    await b("get", "/musteriler", "/musteriler", 200);
    await b("get", "/musteriler/:id", `/musteriler/${bm.veri.id as string}`, 200);
    const bt = await b("post", "/tesisler", "/tesisler", 201, { musteriId: bm.veri.id, ad: "Tesis" });
    await b("get", "/tesisler", "/tesisler", 200);
    const bk = await b("post", "/kurulumlar", "/kurulumlar", 201, { tesisId: bt.veri.id, sinif: "URETIM", kanalKodu: "bayi-kanal" });
    await b("get", "/kurulumlar", "/kurulumlar", 200);
    const bh = await b("post", "/kurulumlar/:id/hak", `/kurulumlar/${bk.veri.id as string}/hak`, 201, { kalici: true, bakimBitis: new Date(Date.now() + 365 * DAY_MS).toISOString() });
    await b("post", "/haklar/:id/surum", `/haklar/${bh.veri.id as string}/surum`, 201, { bayiParolasi: "uclar-bayi-parolasi", sebep: "ilk imza" });
    await b("get", "/haklar/:id", `/haklar/${bh.veri.id as string}`, 200);
    const bKod = await b("post", "/kurulumlar/:id/etkinlestirme-kodu", `/kurulumlar/${bk.veri.id as string}/etkinlestirme-kodu`, 201, {});
    const bSaklanan = await prisma.portalIslemi.findMany({ where: { eylem: "BAYI_KOD_URET", createdAt: { gte: akisBaslangici } } });
    const bSaklananMetin = JSON.stringify(bSaklanan.map((r) => r.yanit));
    kontrol(
      "§3c bayinin saklanan kod yanıtı ne kodu ne son 4'ünü taşır",
      bSaklanan.length >= 1 && !bSaklananMetin.includes("kodSonu") && !bSaklananMetin.includes(String(bKod.veri.kod)),
      `${bSaklanan.length} satır`,
    );
    const bAyrinti = await b("get", "/kurulumlar/:id", `/kurulumlar/${bk.veri.id as string}`, 200);
    kontrol("§3b bayi künyesi dar: yaptırım defteri / kiralar / parmak izi YOK", !("yaptirimDefteri" in bAyrinti.veri) && !("kiralar" in bAyrinti.veri) && (bAyrinti.veri.kurulum as Record<string, unknown>).kabulEdilenParmakIzi === undefined);

    console.log("\n§4 oturum");
    const opK = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(opK.id);
    const opCerez = (await portalGiris(sunucu.tailnet, "/portal/api", opK)).cerez!;
    const degis = await portalIstek(sunucu.tailnet, "/portal/api/oturum/parola", { cerez: opCerez, govde: { mevcutParola: opK.parola, yeniParola: `yeni-${opK.parola}`, totp: await totpKodu(opK.sir, 1) } });
    const sonra = await portalIstek(sunucu.tailnet, "/portal/api/oturum", { cerez: opCerez });
    kontrol("§4a kendi parola değişimi (mevcut parola + TOTP) → 200, bu oturum sürer", degis.status === 200 && sonra.status === 200, `${degis.status}/${sonra.status}`);
    const cikis = await portalIstek(sunucu.tailnet, "/portal/api/oturum/kapat", { cerez: opCerez, govde: {} });
    const cikistan = await portalIstek(sunucu.tailnet, "/portal/api/oturum", { cerez: opCerez });
    kontrol("§4b çıkış → 200, çerez temizlenir, oturum 401", cikis.status === 200 && /Max-Age=0/.test(cikis.basliklar.get("set-cookie") ?? "") && cikistan.status === 401);
    const formGovde = await portalIstek(sunucu.tailnet, "/portal/api/musteriler", { cerez, govde: "ad=x", icerikTuru: "application/x-www-form-urlencoded" });
    kontrol("§4c JSON olmayan yazma (form gönderimi) → 400 (CSRF seddi)", formGovde.status === 400, `${formGovde.status}`);

    console.log("\n§5 kapsam");
    kontrol("§5a her çağrı beklenen durumla döndü", sapmalar.length === 0, sapmalar.join(" | "));
    const v = coverageGaps(VENDOR_PORTAL_ROUTES, vendorHit);
    const d = coverageGaps(DEALER_PORTAL_ROUTES, dealerHit);
    kontrol("§5b satıcı rota tablosunun HER rotası koşuldu (hayalet yok)", v.missing.length === 0 && v.ghost.length === 0, `eksik: ${v.missing.join(", ")} · hayalet: ${v.ghost.join(", ")}`);
    kontrol("§5c bayi rota tablosunun HER rotası koşuldu (hayalet yok)", d.missing.length === 0 && d.ghost.length === 0, `eksik: ${d.missing.join(", ")} · hayalet: ${d.ghost.join(", ")}`);
    const sonda = coverageGaps([{ method: "get", path: "/a" }, { method: "post", path: "/b" }], new Set(["GET /a", "PATCH /c"]));
    kontrol("§5d ✓K karşılaştırıcı sentetik kümede ısırır (eksik POST /b · hayalet PATCH /c)", sonda.missing.join() === "POST /b" && sonda.ghost.join() === "PATCH /c");
  } finally {
    await sunucu.kapat();
    await prisma.bildirim.deleteMany({ where: { tekillikAnahtari: { in: bildirimJetonlari.map((j) => `DENEME:${j}`) } } });
    await temizleDagitim({ musteriler, yayinciKidler: [`uclar-${kanal}`] });
    rmSync(dagitimKoku, { recursive: true, force: true });
    await temizleKurulumlar([...kurulumlar, ...(await bayiKurulumlari(bayiler))], ortam.kidler);
    await temizlePortal({ kullanicilar, bayiler, tesisler, musteriler, kanallar: [kanal] });
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
