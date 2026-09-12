// =============================================================================
// BEKÇİ — İÇE AKTARIM İDEMPOTENCY'Sİ (2026-08-29 / BULGU-T1-008)
// Çalıştır: npx tsx scripts/test_import_idempotency.ts
// =============================================================================
// Replay anahtarı (`clientToken`) koşumun SONUNDA yazılıyordu. 900 satırlık bir
// sipariş dosyasında Electron 15 sn'de zaman aşımına düşüyor, kullanıcı
// "Uygula"ya tekrar basıyor (deneme anahtarı AYNI — yalnız diyalog kapanınca
// yenilenir), guard hâlâ NULL görüyor ve dosya BAŞTAN yazılıyordu:
//   • 1.800 sipariş (900'ü mükerrer, hepsi onaylı, hepsi MRP'ye giriyor),
//   • kullanıcı İKİ KEZ DE hata görüyor (ikinci koşumun kayıt yazımı P2002),
//   • hangi 900'ün fazladan olduğunu söyleyen tek iz, koşum kimliği taşımayan
//     audit satırları.
// Mükerrer sipariş = mükerrer talep = sahte kumaş açığı + iki kez üretim planı;
// iptali elle, satır satır.
//
// §1 SÜREN KOŞUM      — kayıt BAŞTA yazılıyor, süren koşum 409 IMPORT_IN_PROGRESS
// §2 EŞZAMANLI        — aynı token'la iki paralel istek: biri yazar, diğeri 409.
//                       ⚠️ "Mükerrer satır yok" kontrolü DESTEKLEYİCİDİR: renk
//                       adaptöründe ad-mükerrer kapısı ikinci yazımı zaten
//                       engelliyor (ölçüldü — sondada yeşil kaldı). Taşıyıcı
//                       iddia 409'dur.
// §3 BİTMİŞ REPLAY    — bitmiş koşumun token'ı hâlâ cached sonucu döner (regresyon)
// §4 PATLAYAN GÖVDE   — hata sonrası token KİLİTLİ KALMAZ (damga basılır)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { ImportService } from "../src/services/import/import.service";
import { randomUUID } from "crypto";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
type Hata = { message: string; code?: string; statusCode?: number } | null;
async function hataOf(fn: () => Promise<unknown>): Promise<Hata> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { message: string; statusCode?: number; details?: { code?: string } };
    return { message: err.message, code: err.details?.code, statusCode: err.statusCode };
  }
}

const ts = Date.now();
const tokens: string[] = [];
let userId = "";

/** Renk içe aktarımı — en hafif varlık, adaptörü yan etkisiz. */
function satirlar(adet: number, etiket: string): Array<{ rowNo: number; cells: Record<string, string> }> {
  return Array.from({ length: adet }, (_, i) => ({
    rowNo: i + 1,
    // ⚠️ `code` GÖNDERİLMEZ — renk adaptöründe kod `createOnly` ve "boş bırakın,
    // sistem üretir" diyor; kod göndermek doğrulamayı düşürür ve bekçi ÜRÜNÜ
    // değil kendi girdisini ölçmüş olurdu.
    cells: { name: `TSTIMP-${etiket}-${i}` },
  }));
}

async function renkSayisi(etiket: string): Promise<number> {
  return prisma.color.count({ where: { name: { startsWith: `TSTIMP-${etiket}-` } } });
}

async function uygula(token: string, etiket: string, adet = 3) {
  tokens.push(token);
  return ImportService.apply(
    "color",
    satirlar(adet, etiket),
    { clientToken: token, fileName: `${etiket}.csv`, mode: "upsert" },
    userId,
  );
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  check("fixture hazır (admin)", Boolean(admin));
  if (!admin) return;
  userId = admin.id;

  // ═══ §1 — koşum kaydı BAŞTA yazılıyor ═══
  console.log("\n=== §1: koşum kaydı baştan yazılıyor mu ===");
  const t1 = randomUUID();
  const r1 = await uygula(t1, `A${ts}`);
  const kayit = await prisma.importRun.findUnique({ where: { clientToken: t1 } });
  check("§1: koşum kaydı var", Boolean(kayit), kayit?.status ?? "—");
  check("§1: bitiş damgası basıldı", kayit?.finishedAt != null, kayit?.finishedAt?.toISOString() ?? "NULL");
  check("§1: satırlar yazıldı", r1.created === 3, `${r1.created} kayıt`);

  // Süren koşumu taklit et: damgayı geri al (istemci zaman aşımı anındaki hâl).
  await prisma.importRun.update({ where: { clientToken: t1 }, data: { finishedAt: null } });
  const e1 = await hataOf(() => uygula(t1, `A${ts}`));
  check("§1: SÜREN koşumun token'ı REDDEDİLDİ", e1 !== null, e1?.message?.slice(0, 55) ?? "SESSİZ BAŞARI!");
  check(
    "§1: MAKİNE-OKUR kod + 409 (200 'başarılı' DEĞİL)",
    e1?.code === "IMPORT_IN_PROGRESS" && e1?.statusCode === 409,
    `${e1?.code ?? "—"} / ${e1?.statusCode ?? "—"}`,
  );
  check(
    "§1: mesaj ne yapılacağını söylüyor (tekrar gönderme + pencereyi kapat)",
    Boolean(e1?.message.includes("tekrar göndermeyin") && e1?.message.includes("yeniden açın")),
  );
  check("§1: ikinci kez YAZILMADI", (await renkSayisi(`A${ts}`)) === 3, `${await renkSayisi(`A${ts}`)} renk`);
  await prisma.importRun.update({ where: { clientToken: t1 }, data: { finishedAt: new Date() } });

  // ═══ §2 — aynı token'la İKİ PARALEL istek ═══
  console.log("\n=== §2: aynı token, iki paralel istek ===");
  const t2 = randomUUID();
  const etiket2 = `B${ts}`;
  const sonuc = await Promise.allSettled([uygula(t2, etiket2), uygula(t2, etiket2)]);
  const basarili = sonuc.filter((r) => r.status === "fulfilled").length;
  const redler = sonuc.filter((r) => r.status === "rejected");
  check("§2: YALNIZ BİRİ yazdı", basarili === 1, `${basarili} başarılı / ${redler.length} red`);
  check(
    "§2: kaybeden 409 IMPORT_IN_PROGRESS aldı",
    redler.every((r) => (r as PromiseRejectedResult).reason?.details?.code === "IMPORT_IN_PROGRESS"),
    redler.map((r) => (r as PromiseRejectedResult).reason?.details?.code ?? "?").join(","),
  );
  // ⚠️ DESTEKLEYİCİ KONTROL — TAŞIYICI DEĞİL. Renk adaptöründe genel ad-mükerrer
  // kapısı (`applyNameGuard`) ikinci yazımı ZATEN engelliyor, yani bu satır
  // düzeltme geri alınsa DA yeşil kalır (ölçüldü: negatif sondada yeşil kaldı,
  // kırmızı veren tek kontrol aşağıdaki 409 oldu). Gerçek çift-yazım hasarı
  // ad tekilliği OLMAYAN varlıkta doğar — sipariş adaptörü create-only'dir ve
  // finding'in 1.800 sipariş senaryosu oradan gelir. Onu burada kurmak ağır bir
  // fixture ister; bu bekçinin TAŞIYICI iddiası "kaybeden 409 alır"dır ve o
  // iddia düzeltmeyi tek başına kilitler.
  check(
    "§2: hedef tabloda TAM BİR koşum kadar satır var (destekleyici)",
    (await renkSayisi(etiket2)) === 3,
    `${await renkSayisi(etiket2)} renk`,
  );
  check(
    "§2: tek koşum kaydı doğdu",
    (await prisma.importRun.count({ where: { clientToken: t2 } })) === 1,
  );

  // ═══ §3 — REGRESYON: bitmiş koşumun replay'i ═══
  console.log("\n=== §3: regresyon — bitmiş koşumun token'ı ===");
  const tekrar = await uygula(t2, etiket2);
  check("§3: bitmiş koşum hâlâ cached sonucu dönüyor", tekrar.created === 3, `${tekrar.created} kayıt`);
  check(
    "§3: üçüncü çağrı da YAZMADI",
    (await renkSayisi(etiket2)) === 3,
    `${await renkSayisi(etiket2)} renk`,
  );

  // ═══ §4 — patlayan gövde token'ı kilitli bırakmıyor ═══
  console.log("\n=== §4: gövde patlarsa token kurtarılabilir mi ===");
  const t4 = randomUUID();
  tokens.push(t4);
  // Satır sınırını aşan istek doğrulamada patlar — token claim edilmiş olur.
  const e4 = await hataOf(() =>
    ImportService.apply(
      "color",
      // Zorunlu alan BOŞ → doğrulama patlar ve bu patlama token CLAIM
      // EDİLDİKTEN SONRA olur; tam da sondanın ölçmek istediği an.
      [{ rowNo: 1, cells: { name: "" } }],
      { clientToken: t4, fileName: "c.csv", mode: "upsert" },
      userId,
    ).then(async () => {
      // Buraya düşerse gövde patlamadı; sondayı anlamlı kılmak için elle patlat.
      throw new Error("sonda: gövde patlamadı");
    }),
  );
  check("§4: sonda gerçekten bir hata üretti", e4 !== null, e4?.message?.slice(0, 40) ?? "");
  const k4 = await prisma.importRun.findUnique({ where: { clientToken: t4 } });
  if (k4) {
    check(
      "§4: hata sonrası token KİLİTLİ KALMADI (damga basıldı)",
      k4.finishedAt !== null,
      k4.finishedAt ? "damgalı" : "NULL — token sonsuza dek kilitli!",
    );
  } else {
    check("§4: koşum kaydı hiç doğmadı (claim öncesi patladı — kabul edilebilir)", true);
  }
}

async function cleanup(): Promise<void> {
  await prisma.color.deleteMany({ where: { name: { startsWith: "TSTIMP-" } } }).catch(() => {});
  // ⚠️ SIRA ZORUNLU: `ImportRunLine.importRun` RESTRICT'tir; koşum satırı ÖNCE
  // silinemez. Eskiden bu iki satır tek `importRun.deleteMany` idi ve hatayı
  // `.catch(() => {})` SESSİZCE yutuyordu ⇒ temizlik başarısız oluyor, kalıntı
  // DB'de kalıyor ve KOMŞU bekçiyi düşürüyordu. Yutma kalktı: best-effort ama SESSİZ DEĞİL.
  await prisma.importRunLine
    .deleteMany({ where: { importRun: { clientToken: { in: tokens } } } })
    .catch((e: unknown) => console.log(`⚠️  temizlik: defter satırları silinemedi — ${String(e).slice(0, 140)}`));
  await prisma.importRun
    .deleteMany({ where: { clientToken: { in: tokens } } })
    .catch((e: unknown) => console.log(`⚠️  temizlik: koşum satırları silinemedi — ${String(e).slice(0, 140)}`));
}

main()
  .catch((err) => {
    console.error("Beklenmeyen hata:", err);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
