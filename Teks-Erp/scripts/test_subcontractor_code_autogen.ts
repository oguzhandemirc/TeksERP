// =============================================================================
// FASON FİRMA / KATEGORİ KODU SUNUCUDA ÜRETİLİR (Faz B madde 6, 2026-09-22)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts subcontractor_code_autogen
//
// ⭐ NEDEN VAR: bu iki kod 2026-09-22'ye kadar PANELDE üretiliyordu
//    (`Electron/src/lib/code-generator.ts`, `FSN-YYMMDD-<rastgele>`), yani
//    fabrikanın numara serisi ayarlarından BAĞIMSIZ ikinci bir kod rejimi
//    yan yana yaşıyordu: panelden açılan fason firması eski biçimi, içe
//    aktarmadan gelen her şey yeni biçimi alırdı.
//
//   §1 Kod verilmezse sunucu üretir: `FSN`/`KAT` + GGAAYY + NNNN
//   §2 Ardışık create'te sıra İLERLER (aynı kod iki kez doğmaz)
//   §3 İstemci kod GÖNDERİRSE o kod aynen kullanılır (içe aktarma yolu korunur)
//   §4 Üretilen kod serinin TAM formatına uyar (`matchesSeries`) — biçim
//      ayarı değişirse kod da değişir, çünkü kaynak seri tablosudur
//
// ⭐ NEGATİF SONDA ✓B2 (2026-09-22, ölçüldü): `ensureSubCode` üretmeyi bırakıp
//    boş kodu geçirince ❌10 (create `validateCode`ta reddediyor; `dene()` sarmalı
//    sayesinde ÇÖKME değil KIRMIZI) · `ensureSubCode` eski panel biçimini
//    (`<ÖNEK>-YYMMDD-rastgele`) üretince ❌5. Geri alınca 12/12.
//
// ⚠️ ÖLÇÜLMEYEN EKSEN, BEYANLI: "ön ek FSN'dir" burada ÖLÇÜLMEZ ve ölçülemez —
//    beklenti de üretilen kod da AYNI seri tablosundan gelir (araç gözlenenin
//    içinde). Katalogdaki ön eki değiştiren bir mutasyon bu dosyayı yeşil
//    bırakır ve BU DOĞRUDUR: fabrika ön eki değiştirdiğinde kod da değişmeli.
//    Ön ek ekseni `test_number_series §1`in işidir (ölçüldü: `FSN`→`XYZ` ❌2).
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  SubcontractorCategoryService,
  SubcontractorManagementService,
} from "../src/services/subcontractor-management.service";
import { matchesSeries, resolveSeriesFormat, seriesCodePrefix } from "../src/services/number-series.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const DAMGA = `TEST-${Date.now()}`;
const kategoriServisi = new SubcontractorCategoryService();
const firmaServisi = new SubcontractorManagementService();
const kod = (r: unknown): string => (r as { data: { code: string } }).data.code;
const kimlik = (r: unknown): string => (r as { data: { id: string } }).data.id;

/**
 * Create ÇAĞRISI PATLARSA bekçi ÇÖKMEZ, o iddia ❌ olur.
 *
 * ⚠️ Gerekçe ölçüldü: "kod üretme" davranışını geri alan bir mutasyon
 * (`ensureSubCode` boş kodu geçirsin) `validateCode`u fırlatır; sarmalanmazsa
 * sonda ÇÖKER ve çökme KIRMIZI DEĞİLDİR — sondayı koşan "ısırmadı" diye okur.
 */
async function dene<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.log(`   ↳ create hata verdi: ${(e as Error).message}`);
    return null;
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exit(1);
  }

  const kategoriler: string[] = [];
  const firmalar: string[] = [];
  try {
    // ── §1 + §2 Kod verilmezse sunucu üretir, sıra ilerler ─────────────────
    const k1 = await dene(() => kategoriServisi.create({ name: `${DAMGA} Kategori 1` }));
    const k2 = await dene(() => kategoriServisi.create({ name: `${DAMGA} Kategori 2` }));
    if (k1) kategoriler.push(kimlik(k1));
    if (k2) kategoriler.push(kimlik(k2));
    const katOnek = seriesCodePrefix("subcontractorCategory");
    check("§1 ⭐ kategori KODSUZ create'te doğdu (sunucu üretti)", k1 !== null && k2 !== null);
    check("§1 kategori kodu serinin ön ekiyle başlıyor", !!k1 && kod(k1).startsWith(katOnek),
      k1 ? `${kod(k1)} (ön ek ${katOnek})` : "kayıt yok");
    check("§2 ⭐ ardışık kategori kodu İLERLER (aynı kod iki kez doğmaz)",
      !!k1 && !!k2 && kod(k1) !== kod(k2), k1 && k2 ? `${kod(k1)} → ${kod(k2)}` : "kayıt yok");
    check(
      "§4 kategori kodu serinin TAM formatına uyar",
      !!k1 && matchesSeries(resolveSeriesFormat("subcontractorCategory"), kod(k1)),
      k1 ? kod(k1) : "kayıt yok",
    );

    const f1 = await dene(() => firmaServisi.create({ name: `${DAMGA} Firma 1` }));
    const f2 = await dene(() => firmaServisi.create({ name: `${DAMGA} Firma 2` }));
    if (f1) firmalar.push(kimlik(f1));
    if (f2) firmalar.push(kimlik(f2));
    const fsnOnek = seriesCodePrefix("subcontractor");
    check("§1 ⭐ fason firma KODSUZ create'te doğdu (sunucu üretti)", f1 !== null && f2 !== null);
    check("§1 firma kodu serinin ön ekiyle başlıyor", !!f1 && kod(f1).startsWith(fsnOnek),
      f1 ? `${kod(f1)} (ön ek ${fsnOnek})` : "kayıt yok");
    check("§2 ⭐ ardışık firma kodu İLERLER", !!f1 && !!f2 && kod(f1) !== kod(f2),
      f1 && f2 ? `${kod(f1)} → ${kod(f2)}` : "kayıt yok");
    check(
      "§4 firma kodu serinin TAM formatına uyar",
      !!f1 && matchesSeries(resolveSeriesFormat("subcontractor"), kod(f1)),
      f1 ? kod(f1) : "kayıt yok",
    );
    // ⚠️ Bu iddia ön ekten BAĞIMSIZ: eski rejimin imzası rastgele kuyruk ve iki
    // tiredir. Ön eki ölçen iddialar seri tablosundan türediği için ön ek
    // değişimini göremez — o eksen `test_number_series §1`in işidir.
    check(
      "§4 ⭐ eski panel biçimi (<ÖNEK>-YYMMDD-rastgele) ARTIK ÜRETİLMİYOR",
      !!f1 && !/^[A-Z]+-\d{6}-\d{4}$/.test(kod(f1)),
      f1 ? kod(f1) : "kayıt yok",
    );

    // ── §3 İstemcinin gönderdiği kod aynen kullanılır ──────────────────────
    const elleKod = `${DAMGA.slice(0, 10)}K1`;
    const k3 = await dene(() => kategoriServisi.create({ code: elleKod, name: `${DAMGA} Kategori 3` }));
    if (k3) kategoriler.push(kimlik(k3));
    check("§3 kategoride istemci kodu aynen kullanılır (içe aktarma yolu)", !!k3 && kod(k3) === elleKod,
      k3 ? kod(k3) : "kayıt yok");

    const elleFirmaKod = `${DAMGA.slice(0, 10)}F1`;
    const f3 = await dene(() => firmaServisi.create({ code: elleFirmaKod, name: `${DAMGA} Firma 3` }));
    if (f3) firmalar.push(kimlik(f3));
    check("§3 firmada istemci kodu aynen kullanılır", !!f3 && kod(f3) === elleFirmaKod,
      f3 ? kod(f3) : "kayıt yok");

    check("§1 körlük zemini: gerçekten kayıt yaratıldı", kategoriler.length === 3 && firmalar.length === 3,
      `${kategoriler.length} kategori · ${firmalar.length} firma`);
  } finally {
    // Temizlik FK sırasına göre: profil bağı yok (hiç sevk/kabul yapılmadı).
    if (firmalar.length) await prisma.subcontractor.deleteMany({ where: { id: { in: firmalar } } });
    if (kategoriler.length) await prisma.subcontractorCategory.deleteMany({ where: { id: { in: kategoriler } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
