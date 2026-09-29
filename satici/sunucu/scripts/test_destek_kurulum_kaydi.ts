// =============================================================================
// DESTEK + KURULUM KAYDI (3d-2) — satıcı tarafı.
//   §1 yoklamadaki `kurulumKayitlari` `kurulum_kaydi` DEFTERİNE (kurulum, kayitId) ile idempotent yazılır
//      ve portal kurulum ayrıntısında görünür.
//   §2 `POST /v1/destek` (amaç `destek`, kurulum imzalı): talep doğar (`DST-…`), aynı `talepId` aynı talebi
//      döndürür, ek yalnız beyan edilen görüntü türünde ve ≤1 MB, başka amaçla imzalı istek RED.
//   §3 portal destek kutusu: liste · ayrıntı · ek · yanıtla (zil `destek`) · kapat; yanıt yoklama yanıtında
//      fabrikaya döner; kapalı talebe yanıt/kapanış 409; aynı işlem kimliği ikinci kez koşmaz.
//   §4 `destek_olayi` defteri değişmez (UPDATE/DELETE tetikleyiciyle RED).
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı): N1 `skipDuplicates` kaldırıldı → §1c/§1d/§1f ❌ ·
//   N2 yoklama yanıtına `destek` eklenmedi → §3g/§3j ❌ · N3 yanıt claim'i durumsuz → §3i ❌ · N4 ek imza
//   baytı denetimi kaldırıldı → §2d ❌ · N5 yanıtta zil yok → §3e ❌.
// Koşum: npx tsx scripts/test_destek_kurulum_kaydi.ts   (yalnız *_test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { ENDPOINTS, type SupportTicketUpdate } from "../src/lisans-protokol";
import { kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  ORTAM,
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

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function kayit(kayitId: string, tur: "KURULUM" | "GERI_ALMA" = "KURULUM") {
  return {
    kayitId, tur, tarih: "2026-09-29T21:30:00Z", commit: "1234567", paketOzeti: "b".repeat(64),
    oncekiSurum: "2.11.1", yeniSurum: "2.11.2", migrationSayisi: 365, yeniMigrationSayisi: 16,
    geriDonus: { damga: "20260929_213000", kod: true, veri: true, veriSifreli: false },
  };
}

type Prisma = (typeof import("../src/lib/prisma"))["prisma"];
type Yokla = (ek?: Record<string, unknown>) => Promise<{ status: number; json: Record<string, unknown>; kod?: string }>;

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const sunucu = await portalSunuculariKur(ctx);
  const kurulumlar: string[] = [];
  const kullanicilar: string[] = [];
  const zil = new Client({ connectionString: process.env.DATABASE_URL });
  const ziller: string[] = [];
  try {
    await zil.connect();
    await zil.query("LISTEN satici_zil");
    zil.on("notification", (n) => ziller.push(n.payload ?? ""));
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
    const satirlar = () => prisma.kurulumKaydi.findMany({ where: { kurulumId: k.kurulumDbId, kaynakKayitId: { not: null } }, orderBy: { createdAt: "asc" } });
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
    const g = await portalGiris(sunucu.tailnet, "/portal/api", yonetici);
    const cerez = g.cerez ?? "";
    const det = await portalIstek(sunucu.tailnet, `/portal/api/kurulumlar/${k.kurulumDbId}`, { cerez });
    const kk = (det.veri.kurulumKaydi ?? []) as Array<{ olay: string; kaynakKayitId: string | null }>;
    kontrol("§1f ⭐ portal kurulum ayrıntısı kurulum kayıtlarını taşır", det.status === 200 && kk.filter((r) => r.olay === "BACKEND_KURULDU").length === 2, `${det.status}`);

    await destekBolumu({ prisma, genel: sunucu.genel, tailnet: sunucu.tailnet, k, anahtar, cerez, yokla, ziller });
  } catch (err) {
    kontrol("beklenmeyen hata", false, err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    await zil.end().catch(() => undefined);
    await sunucu.kapat();
    await temizleKurulumlar(kurulumlar);
    await temizlePortal({ kullanicilar });
    await kapat();
  }
  sonuc();
}


interface DestekGirdi {
  readonly prisma: Prisma;
  readonly genel: string;
  readonly tailnet: string;
  readonly k: { kurulumDbId: string; kurulumId: string };
  readonly anahtar: TestAnahtari;
  readonly cerez: string;
  readonly yokla: Yokla;
  readonly ziller: string[];
}

function destekGovdesi(talepId: string, ek: unknown = null, fazla: Record<string, unknown> = {}) {
  const y = yoklamaGovdesi({ sonKiraId: null, parmakIzi: {} as never });
  return { v: 1, talepId, konu: "Tartı ekranı donuyor", aciklama: "Sevkiyat tartısında ekran 2 dk donuyor.", acan: "Depo Sorumlusu", panelSurum: "1.3.2", ek, saglik: y.saglik, ortam: ORTAM, ...fazla };
}

async function destekBolumu(g: DestekGirdi): Promise<void> {
  const { prisma, k, anahtar, cerez } = g;
  const gonderDestek = (govde: unknown, amac: "destek" | "yokla" = "destek") =>
    imzaliPost(g.genel, ENDPOINTS.SUPPORT, { kurulumId: k.kurulumId, amac, anahtar, govde });

  console.log("\n§2 POST /v1/destek");
  const talepId = randomUUID();
  const d1 = await gonderDestek(destekGovdesi(talepId, { tur: "image/png", veri: PNG_1X1 }));
  const no = String(d1.json.talepNo ?? "");
  kontrol("§2a ⭐ talep doğdu: numara materyalize, durum ACIK", d1.status === 200 && /^DST-\d{6}$/.test(no) && d1.json.durum === "ACIK" && d1.json.talepId === talepId, `${d1.status} ${d1.kod ?? ""} ${no}`);
  const d2 = await gonderDestek(destekGovdesi(talepId, { tur: "image/png", veri: PNG_1X1 }));
  const adet = await prisma.destekTalebi.count({ where: { kurulumId: k.kurulumDbId } });
  kontrol("§2b ⭐ aynı talepId (yeni nonce) aynı talebi döndürür, ikinci satır YOK", d2.status === 200 && d2.json.talepNo === no && adet === 1, `${d2.status} ${adet}`);
  const olay = await prisma.destekOlayi.findMany({ where: { talep: { kurulumId: k.kurulumDbId } } });
  kontrol("§2c açılış deftere tek satır (ACILDI, açıklama metni)", olay.length === 1 && olay[0]?.tur === "ACILDI" && (olay[0]?.metin ?? "").includes("tartısında"));
  const sahte = await gonderDestek(destekGovdesi(randomUUID(), { tur: "image/png", veri: Buffer.from("MZ-yurutulebilir").toString("base64") }));
  kontrol("§2d ⭐ ek beyan edilen görüntü türünde değilse 400", sahte.status === 400 && sahte.kod === "GOVDE_GECERSIZ", `${sahte.status} ${sahte.kod ?? ""}`);
  const fazla = await gonderDestek(destekGovdesi(randomUUID(), null, { dosyaYolu: "C:\\x" }));
  kontrol("§2e KATI gövde: tanınmayan anahtar 400", fazla.status === 400 && fazla.kod === "GOVDE_GECERSIZ", `${fazla.status}`);
  const amac = await gonderDestek(destekGovdesi(randomUUID()), "yokla");
  kontrol("§2f ⭐ başka amaçla imzalı istek RED (401)", amac.status === 401, `${amac.status} ${amac.kod ?? ""}`);
  const ekYok = await gonderDestek(destekGovdesi(randomUUID()));
  kontrol("§2g eksiz talep de açılır", ekYok.status === 200);

  console.log("\n§3 portal destek kutusu");
  const talep = await prisma.destekTalebi.findFirstOrThrow({ where: { kurulumId: k.kurulumDbId, talepId } });
  const liste = await portalIstek(g.tailnet, "/portal/api/destek?durum=ACIK", { cerez });
  const items = (liste.veri.items ?? []) as Array<{ id: string; talepNo: string }>;
  kontrol("§3a liste (durum süzmesi sunucuda) talebi taşır", liste.status === 200 && items.some((i) => i.id === talep.id && i.talepNo === no), `${liste.status}`);
  const ayr = await portalIstek(g.tailnet, `/portal/api/destek/${talep.id}`, { cerez });
  kontrol("§3b ayrıntı: sağlık özeti + defter satırları, ek İKİLİSİ ayrıntıda YOK", ayr.status === 200 && ayr.veri.saglik !== undefined && Array.isArray(ayr.veri.olaylar) && !("ek" in ayr.veri));
  const ek = await portalIstek(g.tailnet, `/portal/api/destek/${talep.id}/ek`, { cerez });
  kontrol("§3c ek ayrı uçtan (tür + base64 aynı bayt)", ek.status === 200 && ek.veri.tur === "image/png" && ek.veri.veri === PNG_1X1);

  const token = randomUUID();
  const zilOnce = g.ziller.length;
  const yan = await portalIstek(g.tailnet, `/portal/api/destek/${talep.id}/yanitla`, { cerez, govde: { clientToken: token, metin: "Tartı sürücüsünü 1.3.3 ile güncelleyin." } });
  kontrol("§3d ⭐ yanıt: durum YANITLANDI + defter YANIT", yan.status === 200 && (await prisma.destekTalebi.findUniqueOrThrow({ where: { id: talep.id } })).durum === "YANITLANDI"
    && (await prisma.destekOlayi.count({ where: { talepId: talep.id, tur: "YANIT" } })) === 1, `${yan.status} ${yan.kod ?? ""}`);
  await new Promise((r) => setTimeout(r, 300));
  const zilYeni = g.ziller.slice(zilOnce).map((p) => JSON.parse(p) as { k: string; konu: string });
  kontrol("§3e ⭐ yanıt kuruluma zil `destek` çalar (COMMIT'te)", zilYeni.some((z) => z.k === k.kurulumDbId && z.konu === "destek"), JSON.stringify(zilYeni));
  const tekrar = await portalIstek(g.tailnet, `/portal/api/destek/${talep.id}/yanitla`, { cerez, govde: { clientToken: token, metin: "Tartı sürücüsünü 1.3.3 ile güncelleyin." } });
  kontrol("§3f aynı işlem kimliği: tekrar yanıtı, eylem ikinci kez KOŞMAZ", tekrar.status === 200 && tekrar.basliklar.get("idempotent-replay") === "true"
    && (await prisma.destekOlayi.count({ where: { talepId: talep.id, tur: "YANIT" } })) === 1);

  const py = await g.yokla();
  const destek = (py.json.destek ?? []) as SupportTicketUpdate[];
  const bu = destek.find((d) => d.talepId === talepId);
  kontrol("§3g ⭐ yanıt yoklama YANITINDA fabrikaya döner (talepId · durum · yanıt metni)", py.status === 200 && bu?.durum === "YANITLANDI" && bu.yanitlar.some((x) => x.metin.includes("1.3.3")), `${py.status} ${destek.length}`);

  const kap = await portalIstek(g.tailnet, `/portal/api/destek/${talep.id}/kapat`, { cerez, govde: { clientToken: randomUUID(), not: "Sürücü güncellendi, kapatıldı." } });
  kontrol("§3h kapanış: KAPANDI + defter KAPATILDI", kap.status === 200 && (await prisma.destekTalebi.findUniqueOrThrow({ where: { id: talep.id } })).durum === "KAPANDI"
    && (await prisma.destekOlayi.count({ where: { talepId: talep.id, tur: "KAPATILDI" } })) === 1);
  const gec = await portalIstek(g.tailnet, `/portal/api/destek/${talep.id}/yanitla`, { cerez, govde: { clientToken: randomUUID(), metin: "geç yanıt" } });
  const ikinci = await portalIstek(g.tailnet, `/portal/api/destek/${talep.id}/kapat`, { cerez, govde: { clientToken: randomUUID(), not: null } });
  kontrol("§3i ⭐ kapalı talebe yanıt ve ikinci kapanış 409 (atomik claim)", gec.status === 409 && gec.kod === "DURUM_CAKISMASI" && ikinci.status === 409, `${gec.status} ${ikinci.status}`);
  const py2 = await g.yokla();
  const bu2 = ((py2.json.destek ?? []) as SupportTicketUpdate[]).find((d) => d.talepId === talepId);
  kontrol("§3j kapanış notu da fabrikaya döner (durum KAPANDI)", bu2?.durum === "KAPANDI" && bu2.yanitlar.some((x) => x.metin.includes("kapatıldı")));

  console.log("\n§4 defter değişmez");
  let degisti = true;
  try {
    await prisma.$executeRawUnsafe(`UPDATE destek_olayi SET metin = 'x' WHERE "talepId" = '${talep.id}'`);
  } catch {
    degisti = false;
  }
  kontrol("§4a ⭐ destek_olayi UPDATE tetikleyiciyle RED", !degisti);
}

void main();
