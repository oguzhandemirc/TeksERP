// =============================================================================
// BEKÇİ — PrismaClientValidationError 400'ü SUÇLU ALANI SÖYLEMELİ
// =============================================================================
// Ölçülmüş arıza (2026-09-01, canlı demo): `POST /api/items` gövdesinde
// `unit: "m"` (doğrusu `MT` — `ItemUnit` enum'u) gönderilince yanıt
//
//     400 { "message": "Geçersiz veri yapısı. Gönderilen alanları ve
//                       tipleri kontrol edin." }
//
// idi. HANGİ alan olduğu ne yanıtta ne de mesajda vardı; kullanıcı da entegratör
// de körlemesine arıyordu. Kapsam tek uç DEĞİL: Zod şeması olmayan her
// `BaseController` ucu gövdeyi doğrudan Prisma'ya verir, yani bu mesaj
// master-data yazan yolların TAMAMININ ortak arıza yüzeyi.
//
// ⚠️ BU BEKÇİ NEDEN GERÇEK PRİSMA HATASI ÜRETİR (kayıtlı metinle test ETMEZ):
// ayrıştırıcı Prisma'nın hata METNİNE bağlıdır. Sabit bir örnek metinle test
// edilseydi, Prisma bir sürümde ifadeyi değiştirdiğinde ayrıştırıcı sessizce
// `null` döner (yani kör mesaja geri döneriz) ve test YEŞİL kalırdı — tam da
// yakalaması gereken regresyonu göremeyen bir bekçi olurdu. Bu yüzden her
// bölüm canlı Prisma client'ından GERÇEK hata alır.
//
// Not: hiçbir bölüm veritabanına YAZMAZ — Prisma doğrulaması sorgu kurulurken,
// SQL'e çıkmadan patlar. Yine de kodlar koşum başına BENZERSİZ (`TEST-…-${TS}`) ve
// `finally` emniyet temizliği var (2026-09-14, sabit adlı fikstür sınıfı — d9 ölçtü):
// Prisma bir gün bu doğrulamalardan birini gevşetirse yazım SQL'e ulaşır; sabit kod
// bir sonraki koşumda P2002 ile asıl hatayı maskelerdi.
// =============================================================================
import prisma from "../src/lib/prisma";
import { extractPrismaValidationField } from "../src/middlewares/error.middleware";

let gecti = 0;
let kaldi = 0;
function check(label: string, ok: boolean, ek = ""): void {
  if (ok) {
    gecti++;
    console.log(`✅ ${label}${ek ? ` — ${ek}` : ""}`);
  } else {
    kaldi++;
    console.log(`❌ ${label}${ek ? ` — ${ek}` : ""}`);
  }
}

/** Verilen çağrıyı koşar, ATTIĞI hatayı döndürür (atmazsa null). */
const TS = Date.now();
const KOD = (n: number): string => `TEST-GUARD-PROBE-${n}-${TS}`;
// §4 "gizli" değer koşum başına benzersiz (nameFold tekil): damga iddiayı bozmaz — iddia "bu metin sızmıyor".
const GIZLI = `COK-GIZLI-DEGER-4711-${TS}`;

async function hataAl(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

async function main(): Promise<void> {
  console.log("=== Prisma doğrulama hatası: suçlu alan yanıtta mı? ===\n");

  // ── §1 GEÇERSİZ ENUM DEĞERİ (ölçülen asıl vaka) ──────────────────────────
  const e1 = await hataAl(() =>
    // @ts-expect-error — bilerek geçersiz enum: bekçinin ölçtüğü şey bu.
    prisma.item.create({ data: { code: KOD(1), name: `Guard Probe ${TS}`, itemType: "FABRIC", unit: "m" } }),
  );
  check("§1a geçersiz enum GERÇEKTEN hata attı", e1 !== null);
  const a1 = extractPrismaValidationField(e1);
  check("§1b suçlu alan çözüldü", a1?.field === "unit", `alan=${a1?.field ?? "YOK"}`);
  check("§1c gerekçe beklenen tipi söylüyor", /ItemUnit/.test(a1?.reasonTr ?? ""), a1?.reasonTr ?? "—");

  // ── §2 BİLİNMEYEN ALAN ────────────────────────────────────────────────────
  // Not: fazladan alan burada tsc'yi DÜŞÜRMEZ (jenerik `data` üzerinden geçtiği
  // için object-literal fazlalık kontrolü tetiklenmiyor) — hatayı runtime'da
  // Prisma üretir. `@ts-expect-error` koymak "kullanılmayan direktif" hatası verir.
  const e2 = await hataAl(() =>
    prisma.item.create({ data: { code: KOD(2), name: `Guard Probe 2 ${TS}`, itemType: "FABRIC", bulunmayanAlan: 1 } }),
  );
  const a2 = extractPrismaValidationField(e2);
  check("§2 bilinmeyen alan adıyla bildirildi", a2?.field === "bulunmayanAlan", `alan=${a2?.field ?? "YOK"}`);

  // ── §3 EKSİK ZORUNLU ALAN ─────────────────────────────────────────────────
  const e3 = await hataAl(() =>
    // @ts-expect-error — `name` zorunlu, bilerek gönderilmiyor.
    prisma.item.create({ data: { code: KOD(3), itemType: "FABRIC" } }),
  );
  const a3 = extractPrismaValidationField(e3);
  check("§3 eksik zorunlu alan adıyla bildirildi", a3?.field === "name", `alan=${a3?.field ?? "YOK"}`);

  // ── §4 HAM METİN SIZMAMALI ────────────────────────────────────────────────
  // Prisma'nın mesajı gönderilen `data` bloğunun TAMAMINI taşır. Ayrıştırıcının
  // dışarı verdiği gerekçe, gövdeden gelen DEĞERLERİ içermemelidir.
  const e4 = await hataAl(() =>
    prisma.item.create({
      // @ts-expect-error — geçersiz enum + gövdede "gizli" bir değer.
      data: { code: KOD(4), name: GIZLI, itemType: "FABRIC", unit: "m" },
    }),
  );
  const a4 = extractPrismaValidationField(e4);
  const sizinti = `${a4?.field ?? ""} ${a4?.reasonTr ?? ""}`;
  check("§4 gövde değeri dışarı sızmıyor", !sizinti.includes(GIZLI), sizinti.slice(0, 60));

  // ── §5 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  // Ayrıştırıcı HER ŞEYE `null` dönerek de "sızıntı yok" diyebilirdi. En az üç
  // bölümün GERÇEK bir alan adı bulmuş olması şart; yoksa yukarıdaki §4 vakumen
  // yeşildir ve bekçi hiçbir şey ölçmüyordur.
  const cozulen = [a1, a2, a3].filter((x) => x?.field).length;
  check("§5 körlük zemini — en az 3 alan çözüldü", cozulen >= 3, `${cozulen}/3`);

  // ── §6 ALAKASIZ HATADA null ───────────────────────────────────────────────
  // Ayrıştırıcı "her hataya bir alan uydurmaz": tanımadığı metinde null döner
  // ve çağıran kör mesaja düşer (yanlış alan adı basmaktansa alan adı basmamak).
  check("§6 alakasız hatada null", extractPrismaValidationField(new Error("bağlantı koptu")) === null);

  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  process.exit(kaldi > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    // Emniyet: doğrulama bir gün gevşer ve yazım SQL'e ulaşırsa artık kalmasın.
    await prisma.item.deleteMany({ where: { code: { in: [1, 2, 3, 4].map(KOD) } } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });
