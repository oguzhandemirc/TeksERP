// =============================================================================
// BİRLEŞTİRME ÇAKIŞMA POLİTİKALARI (Faz B5)
// =============================================================================
// Her politikaya en az bir vaka. En kritik üçü:
//
//  ① "BOŞ = HEPSİ" ASİMETRİSİ — `item_allowed_colors` satır kümesi bir KÜME
//     değil KISITTIR. Survivor BOŞ (=hepsi serbest) + kaynak 3 satır → naif
//     union survivor'ı HEPSİ'ten 3'e DARALTIR ve o kumaş bir daha 4. renkle
//     sipariş edilemez. Üç alt vaka ölçülüyor.
//  ② `assigned` OR — kaynağa ATANMIŞ renk survivor'da atanmamışsa, düz SKIP o
//     rengi survivor'ın "Müşteri Renkleri"nden düşürür ve picker'da görünmez
//     olur (sessiz özellik kaybı).
//  ③ RENK NULL BÜTÜNLÜĞÜ — birleştirme hiç DELETE yapmadığı için `colorId`
//     NULL'a düşemez; `Roll.colorId IS NULL` bu sistemde "HAM KUMAŞ" demektir.
//     Merge öncesi/sonrası NULL sayısı BİREBİR eşit olmalı.

import prisma, { pool } from "../src/lib/prisma";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TESTCNF${Date.now().toString().slice(-8)}`;
const trash: { items: string[]; colors: string[]; customers: string[] } = {
  items: [],
  colors: [],
  customers: [],
};

async function mkColor(suffix: string): Promise<string> {
  const c = await prisma.color.create({
    data: { code: `${TAG}${suffix}`.slice(0, 32), name: `${TAG} ${suffix}` },
  });
  trash.colors.push(c.id);
  return c.id;
}
async function mkItem(suffix: string): Promise<string> {
  const i = await prisma.item.create({
    data: { code: `${TAG}${suffix}`.slice(0, 32), name: `${TAG} ${suffix}`, itemType: "FABRIC", unit: "MT" },
  });
  trash.items.push(i.id);
  return i.id;
}
async function mkCustomer(suffix: string): Promise<string> {
  const c = await prisma.customer.create({
    data: { code: `${TAG}${suffix}`.slice(0, 32), name: `${TAG} ${suffix}` },
  });
  trash.customers.push(c.id);
  return c.id;
}

async function main(): Promise<void> {
  console.log("=== Birleştirme çakışma politikaları ===\n");

  const red = await mkColor("RED");
  const blue = await mkColor("BLU");

  // ── ① BOŞ = HEPSİ, üç alt vaka ───────────────────────────────────────────
  console.log("── ① 'Boş = hepsi' asimetrisi (item_allowed_colors) ──");

  // 1a) Survivor BOŞ (=hepsi), kaynakta 2 satır → kaynağınkiler ATILIR
  {
    const s = await mkItem("EA-S");
    const k = await mkItem("EA-K");
    await prisma.itemAllowedColor.createMany({
      data: [
        { itemId: k, colorId: red },
        { itemId: k, colorId: blue },
      ],
    });
    await MasterDataMergeService.merge("item", {
      survivorId: s,
      sourceIds: [k],
      reason: "bos hepsi asimetrisi sondasi 1a",
      acknowledgedConflicts: 0,
    });
    const after = await prisma.itemAllowedColor.count({ where: { itemId: s } });
    check(
      "1a) survivor BOŞken kaynağın kısıtları TAŞINMAZ (hepsi serbest kalır)",
      after === 0,
      `${after} satır`,
    );
  }

  // 1b) Survivor DOLU, kaynakta ÇAKIŞMAYAN satır → taşınır (genişler)
  {
    const s = await mkItem("EB-S");
    const k = await mkItem("EB-K");
    await prisma.itemAllowedColor.create({ data: { itemId: s, colorId: red } });
    await prisma.itemAllowedColor.create({ data: { itemId: k, colorId: blue } });
    await MasterDataMergeService.merge("item", {
      survivorId: s,
      sourceIds: [k],
      reason: "bos hepsi asimetrisi sondasi 1b",
      acknowledgedConflicts: 0,
    });
    const after = await prisma.itemAllowedColor.count({ where: { itemId: s } });
    check("1b) survivor DOLUysa çakışmayan kısıt taşınır", after === 2, `${after} satır`);
  }

  // 1c) Survivor DOLU, kaynakta AYNI renk → tek satır kalır (dedupe)
  {
    const s = await mkItem("EC-S");
    const k = await mkItem("EC-K");
    await prisma.itemAllowedColor.create({ data: { itemId: s, colorId: red } });
    await prisma.itemAllowedColor.create({ data: { itemId: k, colorId: red } });
    await MasterDataMergeService.merge("item", {
      survivorId: s,
      sourceIds: [k],
      reason: "bos hepsi asimetrisi sondasi 1c",
      acknowledgedConflicts: 1,
    });
    const after = await prisma.itemAllowedColor.count({ where: { itemId: s } });
    check("1c) çakışan kısıt mükerrer satır bırakmıyor", after === 1, `${after} satır`);
  }

  // ── ② assigned = OR (customer_color_aliases) ─────────────────────────────
  console.log("\n── ② Müşteri renk adı: assigned OR + alias COALESCE ──");
  {
    const s = await mkCustomer("AL-S");
    const k = await mkCustomer("AL-K");
    // Survivor: atanmamış + alias YOK · Kaynak: ATANMIŞ + alias VAR
    await prisma.customerColorAlias.create({
      data: { customerId: s, colorId: red, assigned: false },
    });
    await prisma.customerColorAlias.create({
      data: { customerId: k, colorId: red, assigned: true, alias: "MÜŞTERİ ADI" },
    });
    await MasterDataMergeService.merge("customer", {
      survivorId: s,
      sourceIds: [k],
      reason: "assigned OR sondasi",
      acknowledgedConflicts: 1,
    });
    const row = await prisma.customerColorAlias.findFirst({ where: { customerId: s, colorId: red } });
    check("② atanmışlık KAYBOLMADI (assigned = OR)", row?.assigned === true, String(row?.assigned));
    check("② boş alias kaynağınkiyle dolduruldu (COALESCE)", row?.alias === "MÜŞTERİ ADI", String(row?.alias));
    const left = await prisma.customerColorAlias.count({ where: { customerId: k } });
    check("② kaynağın satırı kalmadı", left === 0, `${left} satır`);
  }

  // Survivor'ın DOLU alias'ı KORUNUR — etikete basılan değeri değiştirmiyoruz.
  {
    const s = await mkCustomer("AK-S");
    const k = await mkCustomer("AK-K");
    await prisma.customerColorAlias.create({
      data: { customerId: s, colorId: blue, assigned: true, alias: "SURVIVOR ADI" },
    });
    await prisma.customerColorAlias.create({
      data: { customerId: k, colorId: blue, assigned: true, alias: "KAYNAK ADI" },
    });
    await MasterDataMergeService.merge("customer", {
      survivorId: s,
      sourceIds: [k],
      reason: "alias korunma sondasi",
      acknowledgedConflicts: 1,
    });
    const row = await prisma.customerColorAlias.findFirst({ where: { customerId: s, colorId: blue } });
    check(
      "② survivor'ın DOLU alias'ı korunuyor (etikete basılan değer değişmez)",
      row?.alias === "SURVIVOR ADI",
      String(row?.alias),
    );
  }

  // ── ③ Renk NULL bütünlüğü ────────────────────────────────────────────────
  console.log("\n── ③ Renk birleştirmesi topların colorId'sini NULL'lamıyor ──");
  {
    const nullsBefore = await prisma.roll.count({ where: { colorId: null } });
    const cs = await mkColor("NS");
    const ck = await mkColor("NK");
    const item = await mkItem("NULLTEST");
    const r = await prisma.roll.create({
      data: {
        barcode: `${TAG}NR`,
        itemId: item,
        colorId: ck,
        status: "STOCK",
        initialQty: 10,
        currentQty: 10,
      },
    });
    await MasterDataMergeService.merge("color", {
      survivorId: cs,
      sourceIds: [ck],
      reason: "renk null butunlugu sondasi",
      acknowledgedConflicts: 0,
    });
    const after = await prisma.roll.findUnique({ where: { id: r.id } });
    check("③ top survivor renge taşındı", after?.colorId === cs, String(after?.colorId));
    const nullsAfter = await prisma.roll.count({ where: { colorId: null } });
    check(
      "③ NULL colorId sayısı BİREBİR aynı (boyalı top hama dönmedi)",
      nullsBefore === nullsAfter,
      `${nullsBefore} → ${nullsAfter}`,
    );
    // ADI kapının okuduğu şeydir: teardown bağlamı fonksiyon adından tanınır (§10b2).
    const temizlikTop = async (): Promise<void> => {
      await prisma.rollMovement.deleteMany({ where: { rollId: r.id } }).catch(() => undefined);
      await prisma.roll.delete({ where: { id: r.id } }).catch(() => undefined);
    };
    await temizlikTop();
  }

  // ── ④ Şube ihracat kodu çakışması BLOK ───────────────────────────────────
  console.log("\n── ④ Şube ihracat kodu çakışması (BLOCK) ──");
  {
    const s = await mkCustomer("BR-S");
    const k = await mkCustomer("BR-K");
    await prisma.customerBranch.create({ data: { customerId: s, name: "Merkez", code: "TR34" } });
    await prisma.customerBranch.create({ data: { customerId: k, name: "Ana", code: "TR34" } });
    const pv = await MasterDataMergeService.preview("customer", s, [k]);
    check(
      "④ aynı ihracat kodlu şube birleştirmeyi ENGELLİYOR",
      !pv.canMerge && pv.blockers.some((b) => b.key.startsWith("CONFLICT_CUSTOMER_BRANCHES")),
      pv.blockers.map((b) => b.key).join(",") || "blokçu YOK",
    );
    let blocked = false;
    try {
      await MasterDataMergeService.merge("customer", {
        survivorId: s,
        sourceIds: [k],
        reason: "sube kodu cakismasi sondasi",
        acknowledgedConflicts: 1,
      });
    } catch {
      blocked = true;
    }
    check("④ uygulama katmanı da engelliyor (çift kapı)", blocked);
  }

  // NULL kodlu şubeler PG'de çakışmaz → serbestçe taşınmalı.
  {
    const s = await mkCustomer("BN-S");
    const k = await mkCustomer("BN-K");
    await prisma.customerBranch.create({ data: { customerId: s, name: "Merkez" } });
    await prisma.customerBranch.create({ data: { customerId: k, name: "Ana" } });
    const pv = await MasterDataMergeService.preview("customer", s, [k]);
    check("④ NULL kodlu şubeler ÇAKIŞMA SAYILMIYOR", pv.canMerge, pv.blockers.map((b) => b.key).join(","));
    await MasterDataMergeService.merge("customer", {
      survivorId: s,
      sourceIds: [k],
      reason: "null kodlu sube tasima sondasi",
      acknowledgedConflicts: 0,
    });
    const n = await prisma.customerBranch.count({ where: { customerId: s } });
    check("④ iki şube de survivor'a taşındı", n === 2, `${n} şube`);
  }

  // ── ⑤ Onay sayısı uyuşmazlığı 409 ────────────────────────────────────────
  console.log("\n── ⑤ Onaylanan çakışma sayısı uyuşmazlığı ──");
  {
    const s = await mkItem("AC-S");
    const k = await mkItem("AC-K");
    await prisma.itemAllowedColor.create({ data: { itemId: s, colorId: red } });
    await prisma.itemAllowedColor.create({ data: { itemId: k, colorId: red } });
    let mismatch = false;
    try {
      await MasterDataMergeService.merge("item", {
        survivorId: s,
        sourceIds: [k],
        reason: "onay sayisi uyusmazligi sondasi",
        acknowledgedConflicts: 0, // gerçekte 1 çakışma var
      });
    } catch {
      mismatch = true;
    }
    check("⑤ 'gördüm' sayısı uyuşmazsa 409 (önizleme bayatladı)", mismatch);
    check(
      "⑤ reddedilen birleştirmede kaynak DOKUNULMADAN kaldı",
      (await prisma.item.findUnique({ where: { id: k } }))?.mergedIntoId === null,
    );
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: trash.items } } }).catch(() => undefined);
    await prisma.itemAllowedColor.deleteMany({ where: { colorId: { in: trash.colors } } }).catch(() => undefined);
    await prisma.customerColorAlias.deleteMany({ where: { customerId: { in: trash.customers } } }).catch(() => undefined);
    await prisma.customerBranch.deleteMany({ where: { customerId: { in: trash.customers } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...trash.items, ...trash.colors, ...trash.customers] } },
    }).catch(() => undefined);
    for (const m of ["item", "color", "customer"] as const) {
      const ids = m === "item" ? trash.items : m === "color" ? trash.colors : trash.customers;
      await (prisma[m] as unknown as { updateMany: (a: unknown) => Promise<unknown> })
        .updateMany({ where: { id: { in: ids } }, data: { mergedIntoId: null } })
        .catch(() => undefined);
      await (prisma[m] as unknown as { deleteMany: (a: unknown) => Promise<unknown> })
        .deleteMany({ where: { id: { in: ids } } })
        .catch(() => undefined);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
