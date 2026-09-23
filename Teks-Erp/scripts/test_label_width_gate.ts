// =============================================================================
// BEKÇİ: ETİKET TAŞMA KAPISI — biçim değişimi barkodu etiketten taşırır mı?
// =============================================================================
// ⚠️ KAPININ DOĞUŞ SEBEBİ ÖLÇÜLDÜ (2026-09-24): emit katmanı taşmayı LİNT ETMEZ
// ve bu bilinçli ("sorumluluk EDİTÖRDE"); editör lint'i ise şablon ELLE
// düzenlenince koşar, SERİ ayarı değişince koşmaz. Aradaki boşlukta fabrika
// haneyi büyütür ve etiket sessizce kırpılır: ne hata, ne log, yalnız okunmayan
// barkod.
//
// ÖLÇÜLEN İDDİALAR
//   §1 Code128 genişliği KODLAYICIDAN gelir, elle formülden değil
//   §2 Kapsam ÖLÇÜLDÜ: etiket barkodu SERİDEN gelen seriler (roll · sack)
//   §3 Taşma 409 verir ve şablonları ADIYLA sayar
//   §4 ÜÇÜNCÜ SONUÇ: kanvas okunamazsa "sığıyor" DEMEZ, uyarır
//   §5 Önizleme ile yazma AYNI yüklemden beslenir (ayrışan yüzey yok)
//
// DB'siz bölümler saf; §2/§3 fikstürlü (kendi şablonunu yaratır, finally siler).
// Koşum: npx tsx scripts/run-all-tests.ts label_width_gate
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import {
  ETIKETE_BASILAN_SERILER,
  assertLabelWidthFits,
  code128Modules,
  labelWidthFindings,
  labelWidthWarnings,
  type LabelWidthFinding,
} from "../src/services/helpers/label-width-gate.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const kod = (e: unknown): string | undefined =>
  (e as { details?: { code?: string } } | null)?.details?.code;

const DAMGA = `TEST-LBLW-${Date.now()}`;

async function main(): Promise<void> {
  // ── §1 GENİŞLİK KODLAYICIDAN ───────────────────────────────────────────────
  console.log("\n── §1 Code128 genişliği ──");
  const m12 = await code128Modules("T230926H0001");
  const m13 = await code128Modules("T230926H00001");
  check("§1 körlük zemini: kodlayıcı gerçekten ölçüyor (modül sayısı makul)", m12 > 100 && m12 < 300, String(m12));
  check("§1 ⭐ bir karakter UZAMAK genişliği ARTIRIYOR", m13 > m12, `${m12} → ${m13}`);
  // ⚠️ ELLE FORMÜLLE AYNI DEĞİL ve bu KASITLI: emitter'daki `(11·len+35)·mw`
  // karakter başına 11 modül varsayıyor, Code128 ise rakam çiftlerini subset C
  // ile İKİŞER paketliyor. Formül %15 ŞİŞİK ⇒ sığan yerleşimi 409'la reddeder.
  const elleFormul = (len: number) => 11 * len + 35;
  check(
    "§1 ⭐ elle formül ŞİŞİK — kapı onu kullansa SIĞAN yerleşimi reddederdi",
    elleFormul(12) > m12,
    `elle=${elleFormul(12)} · gerçek=${m12}`,
  );

  // ── §2 KAPSAM ÖLÇÜLDÜ ──────────────────────────────────────────────────────
  console.log("\n── §2 Kapsam ──");
  check("§2 ⭐ kapsam roll + sack (etiket barkodu SERİDEN gelenler)",
    ETIKETE_BASILAN_SERILER.has("roll") && ETIKETE_BASILAN_SERILER.has("sack"), [...ETIKETE_BASILAN_SERILER].join(", "));
  // ⚠️ `swatch` KAPSAM DIŞI ve gerekçesi ölçüldü: etiketin barkodu `Swatch.barcode`
  // (`SW-YYMM-XXXXXX-C`, kendi şeması), `swatch` SERİSİ ise `cardNumber` (KRT…)
  // üretiyor ve o etikette barkod olarak basılmıyor.
  check("§2 ⭐ `swatch` kapsam DIŞI (etiket barkodu o seriden gelmiyor)",
    !ETIKETE_BASILAN_SERILER.has("swatch"));
  check("§2 kapsam dışı seri için ölçüm HİÇ koşmaz (boş döner)",
    (await labelWidthFindings("swatch", "KRT2309260001")).length === 0);

  // ⚠️ §2c BEYANI ÖLÇÜLEBİLİR KILAR (1e'nin sorusu: belge/kart numarayı barkod
  // olarak basıyor mu?). Ölçüldü: refakat kartı da belge katmanı da yalnız
  // KAREKOD üretir; karekod SVG'si kendi kutusuna `width:100%` ile sığar, yani
  // sabit genişlikli ÇİZGİSEL bir barkod alanı YOKTUR ve bu kapı oraya uzanmaz.
  // Bu bir yorum olarak kalsaydı, biri belgeye Code128 eklediği gün kapsam
  // SESSİZCE yalan olurdu — burada kırmızıya döner ve kapsam yeniden sorulur.
  const belgeKaynaklari = [
    "src/services/printed-document.service.ts",
    "src/services/document-render/traveler-card.html.ts",
    "src/services/traveler-card.service.ts",
  ];
  const cizgiselBasanlar = belgeKaynaklari.filter((yol) => {
    const metin = readFileSync(join(__dirname, "..", yol), "utf-8");
    return /bcid:\s*["'](?!qrcode|datamatrix)/.test(metin);
  });
  check(
    "§2c ⭐ belge ve refakat kartı katmanı ÇİZGİSEL barkod basmaz (yalnız karekod) — kapsam dışılığın gerekçesi",
    cizgiselBasanlar.length === 0,
    cizgiselBasanlar.length ? `çizgisel basan: ${cizgiselBasanlar.join(", ")}` : "3 kaynak tarandı, hepsi qrcode",
  );

  // ── §3/§4 FİKSTÜRLÜ: taşan ve okunamayan şablon ───────────────────────────
  console.log("\n── §3/§4 Şablon fikstürü ──");
  const tasan = await prisma.labelTemplate.create({
    data: {
      name: `${DAMGA} dar`,
      fields: {},
      variants: {
        create: {
          name: "dar-varyant",
          widthMm: 40,
          heightMm: 30,
          // Barkod etiketin SAĞ kenarına yakın: 12 karakterlik kod bile taşar.
          elements: { v: 1, elements: [{ id: "bc", type: "code128", x: 30, y: 5, mw: 3 }] },
        },
      },
    },
    select: { id: true },
  });
  // ⚠️ BU FİKSTÜR BİR SONDA SESSİZLİĞİNİN ÜRÜNÜDÜR (2026-09-24): `x` terimini
  // hesaptan çıkaran sonda 13/0 verdi, çünkü "dar" fikstüründe barkod ZATEN tek
  // başına taşıyordu ve konumun katkısı hiç ölçülmüyordu. Bu şablonda barkod
  // kendi başına RAHAT sığar (mw=1 ⇒ ~18 mm, etiket 100 mm) ve YALNIZ konumu
  // yüzünden taşar ⇒ `x` terimi artık ölçülüyor.
  const konumdanTasan = await prisma.labelTemplate.create({
    data: {
      name: `${DAMGA} konum`,
      fields: {},
      variants: {
        create: {
          name: "konum-varyant",
          widthMm: 100,
          heightMm: 58,
          elements: { v: 1, elements: [{ id: "bc", type: "code128", x: 90, y: 5, mw: 1 }] },
        },
      },
    },
    select: { id: true },
  });
  const okunamaz = await prisma.labelTemplate.create({
    data: {
      name: `${DAMGA} bozuk`,
      fields: {},
      variants: { create: { name: "bozuk-varyant", widthMm: 100, heightMm: 58, elements: { bozuk: true } } },
    },
    select: { id: true },
  });
  try {
    const bulgular = await labelWidthFindings("roll", "T230926H0001");
    const benim = bulgular.filter((b) => b.templateName.startsWith(DAMGA));
    const tasanBulgu = benim.filter((b) => b.overflowMm !== null);
    const olculemeyen = benim.filter((b) => b.overflowMm === null);

    check("§3 körlük zemini: fikstür şablonları ölçüme GİRDİ", benim.length >= 3, `${benim.length} bulgu`);
    check("§3 ⭐ DAR etikette taşma YAKALANIYOR", tasanBulgu.some((b) => b.variantName === "dar-varyant"),
      tasanBulgu.map((b) => b.variantName).join(", "));
    // ⭐ KONUM TERİMİ AYRI ÖLÇÜLÜR: bu varyantta barkod kendi başına sığıyor
    // (~18 mm / 100 mm); taşmanın TEK sebebi `x: 90`.
    check("§3 ⭐ SIĞAN barkod YALNIZ KONUMU yüzünden taşıyorsa da yakalanıyor (x terimi ölçüldü)",
      tasanBulgu.some((b) => b.variantName === "konum-varyant"),
      tasanBulgu.map((b) => b.variantName).join(", "));
    check("§4 ⭐ ÜÇÜNCÜ SONUÇ: kanvası okunamayan şablon 'sığıyor' DEMEZ, uyarır",
      olculemeyen.length === 1 && labelWidthWarnings(benim).length === 1,
      labelWidthWarnings(benim)[0] ?? "(uyarı yok)");

    let hata: unknown = null;
    try {
      assertLabelWidthFits("roll", benim);
    } catch (e) {
      hata = e;
    }
    check("§3 ⭐ taşma 409 `NUMBER_SERIES_LABEL_OVERFLOW` veriyor",
      kod(hata) === "NUMBER_SERIES_LABEL_OVERFLOW", String(kod(hata)));
    check("§3 ⭐ mesaj şablonu ADIYLA sayıyor (soyut sayı yetmez)",
      String((hata as Error)?.message ?? "").includes(`${DAMGA} dar`),
      String((hata as Error)?.message ?? "").slice(0, 90));
    check("§3 ⭐ YALNIZ ölçülemeyen varsa kapı GEÇİRİR (uyarı engel değildir)",
      (() => {
        try {
          assertLabelWidthFits("roll", olculemeyen);
          return true;
        } catch {
          return false;
        }
      })());

    // ── §5 ÖNİZLEME ↔ YAZMA AYNI YÜKLEM ──────────────────────────────────────
    // İki uç da `labelWidthFindings`i çağırıyor; ikinci bir hesap olsaydı ekran
    // "sığıyor" derken kaydet 409 verebilirdi.
    const rotaMetni = readFileSync(join(__dirname, "..", "src", "routes", "number-series.routes.ts"), "utf-8");
    const cagri = (rotaMetni.match(/labelWidthFindings\(/g) ?? []).length;
    check("§5 ⭐ önizleme ve yazma AYNI yüklemi çağırıyor (iki çağrı, tek kaynak)",
      cagri === 2 && rotaMetni.includes("assertLabelWidthFits("), `${cagri} çağrı`);
  } finally {
    await prisma.labelTemplate.deleteMany({ where: { id: { in: [tasan.id, konumdanTasan.id, okunamaz.id] } } });
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await pool.end();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
