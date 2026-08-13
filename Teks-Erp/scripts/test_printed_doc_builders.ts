// =============================================================================
// BEKÇİ — Donmuş belge BUILDER'larının Prisma SORGU ŞEKLİ geçerli mi?
// =============================================================================
// NEDEN AYRI DOSYA: 2026-08-13'te `QUALITY_CERTIFICATE` builder'ının canlıda HER
// çağrıda patladığı bulundu — `collectShipmentDerived` şemada olmayan bir alanı
// (`orderLine.currency`; para birimi `Order` başlığındadır) select ediyordu.
// Üç savunma hattının ÜÇÜ de bu hatayı göremedi:
//   1) `tsc` göremez — builder'lara geçen `PrintedDocDb` bir UNION tipidir
//      (`Prisma.TransactionClient | typeof prisma`) ve union üzerinden yapılan
//      çağrı, TypeScript'in fazla-alan (excess property) kontrolünü DÜŞÜRÜR.
//   2) `test_new_documents.ts` göremez — o yalnız `renderSampleHtml` yolunu
//      ölçer; ÖRNEK veriyle çalışır, gerçek sorgu hiç kurulmaz.
//   3) Çalışma zamanı hatası `PrismaClientValidationError`'dır ve **DB'ye hiç
//      gitmeden**, sorgu kurulurken atılır → hata DB durumundan bağımsızdır,
//      yani "veri yoktu, o yüzden görülmedi" mazereti de yoktur.
//
// ÖLÇÜLENLER:
//   A) `PrintedDocType` enum'undaki HER değerin kayıtlı bir builder'ı var mı
//      (yeni belge tipi eklenip `registerPrintedDocBuilder` unutulursa bugün
//      yalnız çalışma anında `internal 500` olarak görünür).
//   B) Her builder'ın HER giriş noktası (`fresh` · `lazyInit` · `buildPreview` ·
//      `resolveProfileId`) var olmayan bir kaynak id'siyle çağrıldığında
//      `PrismaClientValidationError` ATMIYOR (= sorgu şekli şemayla uyumlu).
//   C) BONUS/derin sonda: DB'de gerçek kaynak satırı varsa aynı çağrı GERÇEK
//      id ile de yapılır. Gerekçe: çok sorgulu bir builder ilk sorgudan `null`
//      dönüp erken çıkabilir ve İKİNCİ sorgudaki şekil hatası dummy id ile
//      görünmez. Veri yoksa yalnız bu bonus atlanır — (A)+(B) garantisi durur.
//
// ⚠️ Bu dosyayı silmeden/gevşetmeden önce: yukarıdaki üç körlüğün hâlâ geçerli
// olduğunu unutma. Bu bekçi kaldırılırsa aynı sınıf hata canlıda, resmi belge
// basılırken ortaya çıkar.
// =============================================================================
import { PrintedDocType, Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { getRegisteredDocBuilders } from "../src/services/printed-document.service";
// Builder kayıtları import YAN ETKİSİYLE oluşur — bu dört import silinirse
// registry boş kalır ve bekçi vakumen yeşile döner (körlük zemini onu yakalar).
import "../src/services/shipping.service";
import "../src/services/subcontractor.service";
import "../src/services/kartela.service";
import "../src/services/return.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

/** Var olmayan ama biçimi geçerli UUID — sorgu KURULUR, satır dönmez. */
const DUMMY_ID = "00000000-0000-4000-8000-000000000000";

/** Belge tipi → gerçek bir kaynak id'si (derin sonda için; yoksa null). */
const REAL_SOURCE: Record<PrintedDocType, () => Promise<string | null>> = {
  [PrintedDocType.SHIPMENT_DISPATCH]: async () =>
    (await prisma.shipment.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }))?.id ?? null,
  [PrintedDocType.QUALITY_CERTIFICATE]: async () =>
    (await prisma.shipment.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }))?.id ?? null,
  [PrintedDocType.SUBCONTRACTOR_DISPATCH]: async () =>
    (await prisma.subcontractorDispatch.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }))?.id ?? null,
  [PrintedDocType.SUBCONTRACTOR_RECEIPT]: async () =>
    (await prisma.subcontractorReceipt.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }))?.id ?? null,
  [PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP]: async () =>
    (await prisma.directShipment.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }))?.id ?? null,
  [PrintedDocType.KARTELA_DISPATCH]: async () =>
    (await prisma.kartelaDispatch.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }))?.id ?? null,
  [PrintedDocType.RETURN_DISPATCH]: async () =>
    (await prisma.rollReturn.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }))?.id ?? null,
};

/** Çağrıyı koşar; YALNIZ şema/sorgu-şekli hatasında `false` döner.
 *  "Kayıt yok / iş kuralı reddi" gibi hatalar bu bekçinin konusu DEĞİLDİR. */
async function callIsShapeValid(fn: () => Promise<unknown>): Promise<{ ok: boolean; detail?: string }> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientValidationError) {
      const first = e.message.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("Unknown") || l.includes("Available options"))[0];
      return { ok: false, detail: first ?? e.message.slice(0, 160) };
    }
    return { ok: true }; // başka hata sınıfı = sorgu şekli geçerliydi
  }
}

async function main(): Promise<void> {
  console.log("=== Donmuş belge builder'ları: sorgu şekli bekçisi ===\n");

  const registry = getRegisteredDocBuilders();
  const allTypes = Object.values(PrintedDocType);

  // ── A) Kayıt tamlığı + körlük zemini ────────────────────────────────────
  check(
    "Körlük zemini: enum en az 7 belge tipi taşıyor",
    allTypes.length >= 7,
    `${allTypes.length} tip`,
  );
  check(
    "Körlük zemini: registry dolu (import yan etkileri koştu)",
    registry.size >= 7,
    `${registry.size} builder kayıtlı`,
  );
  const missing = allTypes.filter((t) => !registry.has(t));
  check(
    "Her PrintedDocType'ın kayıtlı builder'ı var",
    missing.length === 0,
    missing.length ? `EKSİK: ${missing.join(", ")}` : `${allTypes.length}/${allTypes.length}`,
  );

  // ── B) Sorgu şekli — var olmayan id (DB verisinden BAĞIMSIZ garanti) ─────
  let entryPoints = 0;
  for (const docType of allTypes) {
    const entry = registry.get(docType);
    if (!entry) continue;

    const targets: Array<[string, () => Promise<unknown>]> = [
      ["fresh", () => entry.fresh(prisma, DUMMY_ID)],
    ];
    if (entry.lazyInit) targets.push(["lazyInit", () => entry.lazyInit!(prisma, DUMMY_ID)]);
    if (entry.buildPreview) targets.push(["buildPreview", () => entry.buildPreview!(prisma, DUMMY_ID)]);
    if (entry.resolveProfileId) targets.push(["resolveProfileId", () => entry.resolveProfileId!(prisma, DUMMY_ID)]);

    for (const [name, fn] of targets) {
      entryPoints++;
      const r = await callIsShapeValid(fn);
      check(`${docType}.${name} — sorgu şekli şemayla uyumlu`, r.ok, r.detail);
    }
  }
  check("Körlük zemini: en az 10 giriş noktası denendi", entryPoints >= 10, `${entryPoints} çağrı`);

  // ── C) Derin sonda — gerçek kaynak id'siyle (veri varsa) ─────────────────
  let deep = 0;
  for (const docType of allTypes) {
    const entry = registry.get(docType);
    if (!entry) continue;
    let realId: string | null = null;
    try {
      realId = await REAL_SOURCE[docType]();
    } catch {
      realId = null;
    }
    if (!realId) continue;
    deep++;
    const r = await callIsShapeValid(() => entry.fresh(prisma, realId));
    check(`${docType}.fresh — GERÇEK kaynakla sorgu şekli uyumlu`, r.ok, r.detail);
  }
  console.log(
    deep > 0
      ? `\nℹ️ Derin sonda: ${deep}/${allTypes.length} belge tipi gerçek kaynakla denendi (veri olan tipler).`
      : "\nℹ️ Derin sonda ATLANDI: DB'de hiç kaynak satırı yok (A+B garantisi yine de koştu).",
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(() => {
    process.exit(fail > 0 ? 1 : 0);
  });
