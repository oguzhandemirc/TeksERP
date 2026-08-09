// =============================================================================
// Test: ÇUVAL İÇERİĞİ UYUŞMAZLIK UYARILARI (2026-08-09)
// Çalıştır: npx tsx scripts/test_sack_mismatch.ts
// =============================================================================
// Saha isteği: *"çuvalın müşterisi ile içindeki topların müşterisi aynı değilse
// uyar ama ENGEL OLMA."*
//
// Bu bekçinin kilitlediği ASIL ŞEY, uyarının NE ZAMAN **SUSTUĞU**:
//
//   ⚠️ Düz "basıldığı müşteri ≠ gideceği müşteri" karşılaştırması YAPILMAZ.
//   Kullanıcının kendi ifadesi: *"X için üretilmiş top Y'ye gönderilebilir;
//   müşteriye özel etiketi olmadığı sürece etiket bile değişmeden gönderilir."*
//   O kuralla uyarsaydık neredeyse her çuvalda yanardı → operatör KÖRLEŞİRDİ.
//   (Aynı gerekçe `Sack.labelDirty` şema notunda da yazılı.)
//
// Doğru soru: "etiket hedef müşteri için BUGÜN basılsaydı İÇERİĞİ farklı çıkar
// mıydı?" → şablon rotası · kumaş alias'ı · renk alias'ı · müşteri adı.
//
// §1 SESSİZLİK — ikisi de rotasız/alias'sız → uyarı YOK, yalnız gri bilgi
// §2 ŞABLON farklı → 🔴
// §3 ALIAS farklı → 🔴
// §4 2. kalite → 🔴 (hedef müşteriden bağımsız)
// §5 Müşterisiz çuval → etiket sinyali YOK (karşılaştırılacak hedef yok)
// §6 Aynı müşteri → hiç sinyal yok
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import {
  detectSackMismatches,
  type MismatchSignal,
} from "../src/services/helpers/sack-content-mismatch.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const kinds = (s: MismatchSignal[]): string[] => s.map((x) => x.kind).sort();

async function main(): Promise<void> {
  const ts = Date.now();
  const cleanup: {
    customers: string[]; items: string[]; colors: string[]; rolls: string[];
    templates: string[]; labelTemplates: string[];
  } = {
    customers: [], items: [], colors: [], rolls: [], templates: [], labelTemplates: [],
  };

  try {
    const [custA, custB, custC] = await Promise.all([
      prisma.customer.create({ data: { code: `TEST-MMA-${ts}`, name: `TEST A ${ts}` }, select: { id: true } }),
      prisma.customer.create({ data: { code: `TEST-MMB-${ts}`, name: `TEST B ${ts}` }, select: { id: true } }),
      prisma.customer.create({ data: { code: `TEST-MMC-${ts}`, name: `TEST C ${ts}` }, select: { id: true } }),
    ]);
    cleanup.customers.push(custA.id, custB.id, custC.id);

    const item = await prisma.item.create({
      data: { code: `TEST-MM-${ts}`, name: `TEST Kumaş ${ts}`, itemType: "FABRIC" },
      select: { id: true },
    });
    cleanup.items.push(item.id);
    const color = await prisma.color.create({
      data: { code: `TMM${String(ts).slice(-4)}`, name: `TEST Renk ${ts}` },
      select: { id: true },
    });
    cleanup.colors.push(color.id);

    const mkRoll = async (
      tag: string,
      labelCustomerId: string | null,
      opts: { status?: RollStatus; quality?: string } = {},
    ) => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-MM-${tag}-${ts}`,
          itemId: item.id,
          colorId: color.id,
          status: opts.status ?? RollStatus.WAREHOUSE,
          initialQty: 50, currentQty: 50,
          qualityGrade: opts.quality ?? "1.KALITE",
          entrySource: "TAMBUR_SPLIT",
          labelCustomerId,
        },
        select: {
          id: true, barcode: true, status: true, qualityGrade: true,
          itemId: true, colorId: true, labelCustomerId: true, lastLabelSnapshot: true,
        },
      });
      cleanup.rolls.push(r.id);
      return r;
    };

    // ── §1 SESSİZLİK — asıl kural ───────────────────────────────────────────
    console.log("\n── §1 ⭐ İkisi de standart → KIRMIZI YOK ──");
    const plain = await mkRoll("PLAIN", custA.id);
    const s1 = await detectSackMismatches([plain], custB.id);
    check(
      "⭐ farklı müşteri ama etiket AYNI çıkardı → kırmızı uyarı YOK",
      !s1.some((x) => x.severity === "warning"),
      "düz müşteri karşılaştırması yapılsaydı burada yanardı",
    );
    check(
      "yalnız gri BİLGİ verilir (etiket geçerli)",
      kinds(s1).join(",") === "OTHER_CUSTOMER" && s1[0]?.severity === "info",
      kinds(s1).join(","),
    );

    // ── §2 ŞABLON farkı ─────────────────────────────────────────────────────
    console.log("\n── §2 Müşteriye özel ŞABLON ──");
    const tpl = await prisma.labelTemplate.findFirst({ select: { id: true } });
    if (tpl) {
      const route = await prisma.customerTemplateRoute.create({
        data: { customerId: custB.id, kind: "ROLL_FINISHED", templateId: tpl.id },
        select: { id: true },
      });
      cleanup.templates.push(route.id);
      const s2 = await detectSackMismatches([plain], custB.id);
      check(
        "hedef müşterinin ÖZEL şablonu var → 🔴 uyarı",
        s2.some((x) => x.kind === "LABEL_DIFFERS" && x.severity === "warning"),
        s2.find((x) => x.kind === "LABEL_DIFFERS")?.message ?? "-",
      );
      check(
        "sebep somut söyleniyor (şablon)",
        /şablon/.test(s2.find((x) => x.kind === "LABEL_DIFFERS")?.message ?? ""),
      );
      // Ters yön: özel şablonlu müşteri için basılmış top STANDART müşteriye gidiyor
      const special = await mkRoll("SPECIAL", custB.id);
      const s2b = await detectSackMismatches([special], custA.id);
      check(
        "TERS YÖN de yakalanır (özel etiketli top standart müşteriye)",
        s2b.some((x) => x.kind === "LABEL_DIFFERS"),
      );
      await prisma.customerTemplateRoute.deleteMany({ where: { id: route.id } });
      cleanup.templates = [];
    } else {
      console.log("ℹ️  LabelTemplate yok — §2 atlandı");
    }

    // ── §3 ALIAS farkı ──────────────────────────────────────────────────────
    console.log("\n── §3 Müşteriye özel KUMAŞ ADI ──");
    await prisma.customerItemAlias.create({
      data: { customerId: custC.id, itemId: item.id, alias: "MÜŞTERİDE BAŞKA AD" },
    });
    const s3 = await detectSackMismatches([plain], custC.id);
    check(
      "hedef müşterinin kumaş alias'ı var → 🔴 uyarı",
      s3.some((x) => x.kind === "LABEL_DIFFERS"),
    );
    check(
      "sebep somut söyleniyor (kumaş adı)",
      /kumaş adı/.test(s3.find((x) => x.kind === "LABEL_DIFFERS")?.message ?? ""),
    );

    // ── §4 2. KALİTE ────────────────────────────────────────────────────────
    console.log("\n── §4 2. kalite (A1) ──");
    const a1 = await mkRoll("A1", custA.id, { status: RollStatus.A1_STOCK, quality: "A1" });
    const s4 = await detectSackMismatches([a1], custA.id);
    check(
      "A1 top müşteri çuvalında → 🔴 uyarı",
      s4.some((x) => x.kind === "SECOND_QUALITY" && x.severity === "warning"),
    );
    const s4b = await detectSackMismatches([a1], null);
    check(
      "2. kalite uyarısı MÜŞTERİSİZ çuvalda da çıkar (hedeften bağımsız)",
      s4b.some((x) => x.kind === "SECOND_QUALITY"),
    );

    // ── §5 MÜŞTERİSİZ çuval ─────────────────────────────────────────────────
    console.log("\n── §5 Müşterisiz çuval ──");
    const s5 = await detectSackMismatches([plain], null);
    check(
      "müşterisiz çuvalda ETİKET sinyali YOK (karşılaştırılacak hedef yok)",
      !s5.some((x) => x.kind === "LABEL_DIFFERS" || x.kind === "OTHER_CUSTOMER"),
      "müşterisiz çuval meşrudur — uyarı üretmek gürültü olurdu",
    );

    // ── §7 AD GÖRÜNÜRLÜĞÜ ŞABLON BAZINDA (2026-08-09 kod incelemesi) ────────
    // Bulunan hata: görünürlük GLOBAL bir bayraktı ("kümedeki HERHANGİ bir rota
    // şablonu müşteri adı basıyor mu"). Karışık bir çuvalda C müşterisinin özel
    // şablonu bayrağı açıyor, sonra STANDART şablon kullanan iki müşteri
    // arasındaki karşılaştırma da "müşteri adı farklı" diye KIRMIZI yanıyordu —
    // oysa o iki etiket birebir aynı çıkar. Yani motorun var olma sebebi olan
    // körleşme, motorun kendi içinden geri geliyordu.
    console.log("\n── §7 ⭐ Ad görünürlüğü ŞABLON bazında (global değil) ──");
    // ⚠️ ŞABLON FIXTURE'I TEST TARAFINDAN ÜRETİLİR, ortamdan ÇÖZÜLMEZ.
    // İlk yazımda `labelTemplate.findFirst()` kullanılmıştı ve bölüm **yanlış
    // sebeple yeşildi**: rastgele bulunan şablon `customerName` basmıyordu, yani
    // eski GLOBAL bayrak da yeni ŞABLON BAZINDA mantık da aynı sonucu veriyordu
    // (negatif sonda kırmızı vermedi — ölçüldü). Ad basan bir şablon olmadan bu
    // bölüm hiçbir şey kanıtlamaz.
    const tpl7 = await prisma.labelTemplate.create({
      data: {
        name: `TEST MM Ad Basan ${ts}`,
        // Legacy akış-modeli alanı (zorunlu) — kanvas varyantı kullanıldığı için
        // içeriği önemsiz; `collectBoundKeys` yalnız varyant `elements`'ına bakar.
        fields: [],
        variants: {
          create: {
            name: "100x148",
            widthMm: 100,
            heightMm: 148,
            elements: {
              v: 1,
              elements: [{ type: "field", bind: "customerName", x: 5, y: 5, w: 60, h: 8 }],
            },
          },
        },
      },
      select: { id: true },
    });
    cleanup.labelTemplates.push(tpl7.id);
    {
      // custC'ye ad basan bir rota ver; custA ↔ custB hâlâ STANDART.
      const route7 = await prisma.customerTemplateRoute.create({
        data: { customerId: custC.id, kind: "ROLL_FINISHED", templateId: tpl7.id },
        select: { id: true },
      });
      cleanup.templates.push(route7.id);

      // Aynı çuvalda: biri custC için basılmış (rota var), biri custA için
      // (standart). Hedef custB (standart). custA→custB karşılaştırması
      // AD yüzünden kırmızı YANMAMALI.
      const rc = await mkRoll("NV-C", custC.id);
      const ra = await mkRoll("NV-A", custA.id);
      const s7 = await detectSackMismatches([rc, ra], custB.id);
      const aSignals = s7.filter((x) => x.rollId === ra.id);
      check(
        "⭐ standart↔standart topta AD farkı kırmızı YAKMAZ (rota başka topta olsa bile)",
        !aSignals.some((x) => x.severity === "warning"),
        aSignals.map((x) => `${x.kind}:${x.severity}`).join(",") || "sinyal yok",
      );
      // Körlük zemini: motor bu kurulumda gerçekten sinyal üretebiliyor olmalı —
      // yoksa yukarıdaki kontrol "hiçbir şey çalışmadı" hâlinde de yeşil kalır.
      check(
        "zemin: ROTALI topta kırmızı ÇIKIYOR (motor bu kurulumda çalışıyor)",
        s7.some((x) => x.rollId === rc.id && x.severity === "warning"),
        s7.filter((x) => x.rollId === rc.id).map((x) => x.kind).join(",") || "sinyal yok",
      );
      await prisma.customerTemplateRoute.deleteMany({ where: { id: route7.id } });
    }

    // ── §6 AYNI müşteri ─────────────────────────────────────────────────────
    console.log("\n── §6 Aynı müşteri ──");
    const s6 = await detectSackMismatches([plain], custA.id);
    check("aynı müşteri → hiç sinyal yok", s6.length === 0, `${s6.length} sinyal`);

    // Körlük zemini: motor gerçekten çalışıyor mu (hep boş dönen bir fonksiyon
    // yukarıdaki "yok" kontrollerinin HEPSİNİ vakumen geçerdi).
    check("körlük zemini: motor sinyal üretebiliyor", s3.length > 0 && s4.length > 0);
  } finally {
    await prisma.customerTemplateRoute.deleteMany({ where: { customerId: { in: cleanup.customers } } });
    await prisma.customerItemAlias.deleteMany({ where: { customerId: { in: cleanup.customers } } });
    await prisma.customerColorAlias.deleteMany({ where: { customerId: { in: cleanup.customers } } });
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: cleanup.rolls } } });
    await prisma.roll.deleteMany({ where: { id: { in: cleanup.rolls } } });
    await prisma.item.deleteMany({ where: { id: { in: cleanup.items } } });
    await prisma.color.deleteMany({ where: { id: { in: cleanup.colors } } });
    await prisma.customer.deleteMany({ where: { id: { in: cleanup.customers } } });
    // Varyantlar CASCADE ile düşer (schema.prisma onDelete: Cascade).
    await prisma.labelTemplate.deleteMany({ where: { id: { in: cleanup.labelTemplates } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().then(
  () => process.exit(fail > 0 ? 1 : 0),
  (e) => { console.error(e); process.exit(1); },
);
