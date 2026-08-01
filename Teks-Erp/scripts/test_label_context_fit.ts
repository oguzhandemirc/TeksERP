// =============================================================================
// TEST: Şablon ↔ baskı bağlamı uyumu (fail-closed arka kapısı)
// Çalıştır: npx tsx scripts/test_label_context_fit.ts
// =============================================================================
// `buildSackRenderInput` FAIL-CLOSED olmayı amaçlıyordu ama guard'ı yalnız
// "şablon var mı?" diye soruyordu. Üç atama yüzeyi de tür şartı koymadığı için
// ÇUVAL bağlamına ROLL şablonu atanabiliyor, `routing.template` DOLU dönüyor ve
// guard ARKA KAPIDAN geçiliyordu → ya ROLL düzeni basılıyor (varyantsız şablon;
// emitter'da SACK dalı yok) ya da çuval numarası hiç basılmayan yarı boş etiket
// çıkıyordu. Sessiz çöp yerine Türkçe 400.
//
// Ayrıca: `CustomerTemplateRoute(müşteri, SACK)` halkası ÖLÜYDÜ (buildSackRenderInput
// `customerId` geçirmiyordu) → admin müşteriye özel çuval şablonu atıyor, hiç
// kullanılmıyordu. Canlandırıldı; "müşteri TAHMİNİ yasak" kuralı ihlal edilmiyor
// (`Sack.customerId` açık kolon, WO'dan türetme değil).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";
import { LabelTemplateService } from "../src/services/label-template.service";
import { CustomerTemplateRouteService } from "../src/services/customer-template-route.service";
import { shippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";
import { LabelKind, RollStatus } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}
const is400 = (e: unknown) => e instanceof AppError && e.statusCode === 400;
const msgOf = (e: unknown) => (e instanceof AppError ? e.message : String(e));

const TS = Date.now().toString().slice(-6);
const labels = new LabelService();
const templates = new LabelTemplateService();
const custRoutes = new CustomerTemplateRouteService();

let ADMIN = "";
let CUSTOMER = "";
let ITEM = "";
const templateIds: string[] = [];
const rollIds: string[] = [];
const sackIds: string[] = [];
/** SACK bağlam varsayılanını geri koymak için (seed onu kuruyor). */
let prevSackDefault: string | null = null;

/** Kanvas varyantlı şablon — verilen bind'lerle field elemanları + zorunlu barkod. */
async function makeTemplate(name: string, binds: string[], kind: LabelKind = LabelKind.SACK): Promise<string> {
  // NOT: `widthMm`/`heightMm` `LabelTemplateInput`'ta YOK — buraya yazılınca
  // sessizce yok sayılıyordu (ölçü şablonda değil VARYANTTA yaşıyor). Gerçek
  // ölçü aşağıda `labelTemplateVariant` kaydına yazılan 100×60'tır.
  const created = (await templates.create(
    { name: `${name} ${TS}`, kind },
    ADMIN
  )) as unknown as { data: { id: string } };
  const id = created.data.id;
  templateIds.push(id);
  const elements = [
    { id: "bc1", type: "code128", xMm: 4, yMm: 4, wMm: 60, hMm: 12 },
    ...binds.map((b, i) => ({
      id: `f${i}`,
      type: "field",
      bind: b,
      xMm: 4,
      yMm: 20 + i * 6,
      hMm: 4,
    })),
  ];
  const variants = await prisma.labelTemplateVariant.findMany({
    where: { templateId: id },
    select: { id: true },
  });
  if (variants.length === 0) {
    await prisma.labelTemplateVariant.create({
      data: {
        templateId: id,
        name: "Varsayılan",
        widthMm: 100,
        heightMm: 60,
        isPrimary: true,
        elements: { v: 1, elements },
      },
    });
  } else {
    await prisma.labelTemplateVariant.update({
      where: { id: variants[0]!.id },
      data: { elements: { v: 1, elements } },
    });
  }
  return id;
}

/** VARYANTSIZ (legacy akış) şablon — kanvas yok. */
async function makeVariantlessTemplate(name: string): Promise<string> {
  // (Yukarıdakiyle aynı: ölçü alanları `LabelTemplateInput`'ta yok, yok sayılıyordu.)
  const created = (await templates.create(
    { name: `${name} ${TS}`, kind: LabelKind.SACK },
    ADMIN
  )) as unknown as { data: { id: string } };
  const id = created.data.id;
  templateIds.push(id);
  await prisma.labelTemplateVariant.deleteMany({ where: { templateId: id } });
  return id;
}

async function makeSack(customerId: string | null): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-LCF-R${TS}-${rollIds.length}`,
      itemId: ITEM,
      initialQty: 50,
      currentQty: 50,
      qualityGrade: "1.KALITE",
      width: 150,
      status: RollStatus.WAREHOUSE,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });
  rollIds.push(roll.id);
  const sack = (
    await shippingService.openSack(customerId ? { customerId } : {}, ADMIN)
  ).data as { id: string };
  sackIds.push(sack.id);
  await shippingService.scanIntoSack({ sackId: sack.id, barcode: roll.barcode! }, ADMIN);
  return sack.id;
}

async function run(): Promise<void> {
  ADMIN = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin"
  ).id;
  CUSTOMER = (
    await prisma.customer.create({
      data: { code: `TEST-LCF-C-${TS}`, name: `LCF ASCII MUSTERI ${TS}` },
      select: { id: true },
    })
  ).id;
  ITEM = (
    await prisma.item.create({
      data: { code: `TEST-LCF-I-${TS}`, name: `Bağlam Uyum Ürün ${TS}`, itemType: "FABRIC" },
      select: { id: true },
    })
  ).id;
  prevSackDefault =
    (
      await prisma.labelContextDefault.findUnique({
        where: { kind: LabelKind.SACK },
        select: { templateId: true },
      })
    )?.templateId ?? null;

  // ─────────────────────────────── 1) ATAMA ANI — sackNo'suz şablon reddedilir
  console.log("\n=== 1) ÇUVAL bağlamına `sackNo`'suz şablon ATANAMAZ ===");
  // `kind: ROLL_FINISHED` — gerçekçi senaryo: TOP şablonu ÇUVAL bağlamına atanıyor.
  // (Guard `kind`'a BAKMAZ — deprecated/nullable; bağladığı alanlara bakar. `kind`
  //  burada yalnız `create`'in zorunlu alanı ve senaryonun anlamı için.)
  const rollish = await makeTemplate(
    "TEST-LCF ROLL Şablonu",
    ["itemName", "qualityGrade", "widthCm"],
    LabelKind.ROLL_FINISHED
  );
  let err: unknown;
  try {
    await templates.setContextDefault(LabelKind.SACK, rollish, ADMIN);
  } catch (e) {
    err = e;
  }
  check("setContextDefault(SACK, roll-şablonu) 400", is400(err), msgOf(err).slice(0, 100));
  check('mesaj "Çuval No" alanını adıyla söylüyor', msgOf(err).includes("Çuval No"));
  check("mesaj ne yapılacağını söylüyor (Stüdyo / Atamalar)", /Stüdyo|Atamalar/.test(msgOf(err)));

  // ───────────────────────── 2) ATAMA ANI — varyantsız legacy şablon reddedilir
  console.log("\n=== 2) ÇUVAL bağlamına VARYANTSIZ (tasarımsız) şablon ATANAMAZ ===");
  const variantless = await makeVariantlessTemplate("TEST-LCF Tasarımsız");
  err = undefined;
  try {
    await templates.setContextDefault(LabelKind.SACK, variantless, ADMIN);
  } catch (e) {
    err = e;
  }
  check("setContextDefault(SACK, varyantsız) 400", is400(err), msgOf(err).slice(0, 100));
  check("sebep tasarım/kanvas eksikliği", /tasarım|kanvas/i.test(msgOf(err)));

  // ────────────────────────────────────── 3) UYUMLU şablon sorunsuz atanır+basar
  console.log("\n=== 3) `sackNo` içeren şablon atanır ve BASILIR ===");
  const good = await makeTemplate("TEST-LCF Çuval Şablonu", ["sackNo", "rollCount", "weightKg"]);
  await templates.setContextDefault(LabelKind.SACK, good, ADMIN);
  const sackA = await makeSack(CUSTOMER);
  const html = await labels.getSackLabelHtml(sackA);
  check("getSackLabelHtml başarılı", !!html.data.html && html.data.html.length > 100);
  check("kind SACK", html.data.kind === LabelKind.SACK);

  // ─────────── 4) BASKI ANI fail-closed: bağlam default'u arkadan bozulursa 400
  console.log("\n=== 4) BASKI ANI: bağlam varsayılanı uyumsuz şablona çevrilirse 400 ===");
  // Atama guard'ını ATLA (raw upsert) → "eski ayar / farklı yoldan bozulmuş" hâli
  // simüle edilir; baskı anı guard'ı son savunmadır.
  await prisma.labelContextDefault.upsert({
    where: { kind: LabelKind.SACK },
    create: { kind: LabelKind.SACK, templateId: rollish },
    update: { templateId: rollish },
  });
  err = undefined;
  try {
    await labels.getSackLabelHtml(sackA);
  } catch (e) {
    err = e;
  }
  check("baskı 400 döndü (sessiz çöp etiket YOK)", is400(err), msgOf(err).slice(0, 100));
  check("mesaj şablon adını 『』 ile veriyor", /『.+』/.test(msgOf(err)));
  // Native yol da aynı guard'dan geçer (buildSackRenderInput tek kapı).
  err = undefined;
  try {
    await labels.getSackLabelNative(sackA);
  } catch (e) {
    err = e;
  }
  check("native baskı da 400 (tek kapı: buildSackRenderInput)", is400(err));
  await templates.setContextDefault(LabelKind.SACK, good, ADMIN);

  // ───────────────── 5) MÜŞTERİ ROTASI canlandı — bağlam varsayılanını EZER
  console.log("\n=== 5) CustomerTemplateRoute(müşteri, SACK) artık ÇALIŞIYOR ===");
  const custTpl = await makeTemplate("TEST-LCF Müşteri Çuval", ["sackNo", "customerName"]);
  await custRoutes.set(CUSTOMER, LabelKind.SACK, custTpl, ADMIN);
  const routed = await labels.getSackLabelHtml(sackA);
  // Müşteri rotası şablonu `customerName` bağlıyor, bağlam default'u bağlamıyor →
  // müşteri adının çıktıda görünmesi rotanın SEÇİLDİĞİNİ kanıtlar.
  check(
    "müşteri rotası şablonu seçildi (çıktıda müşteri adı var)",
    routed.data.html.includes(`LCF ASCII MUSTERI ${TS}`),
    routed.data.html.includes(`LCF ASCII MUSTERI ${TS}`) ? "" : "müşteri adı yok → rota çözülmedi"
  );

  // ─────────── 6) MÜŞTERİSİZ çuval: müşteri halkası hiç sorgulanmaz (tahmin YOK)
  console.log("\n=== 6) Müşterisiz depo çuvalı: müşteri rotası ATLANIR ===");
  const sackNoCust = await makeSack(null);
  const plain = await labels.getSackLabelHtml(sackNoCust);
  check(
    "müşterisiz çuval bağlam varsayılanıyla basılır (müşteri adı YOK)",
    !plain.data.html.includes(`LCF ASCII MUSTERI ${TS}`)
  );

  // ─────────── 7) DİĞER bağlamlar ENGELLENMEZ (asimetri bilinçli)
  console.log("\n=== 7) ROLL/SWATCH bağlamında kimlik kontrolü YOK (engel yok) ===");
  err = undefined;
  try {
    // SACK-özgü alanları bağlayan şablon ROLL_FINISHED'a atanabilir: o bağlamda
    // kimlik = zorunlu barkod elemanının kendisi, ayrı bir kimlik alanı yok.
    await templates.setContextDefault(LabelKind.ROLL_FINISHED, good, ADMIN);
  } catch (e) {
    err = e;
  }
  check("setContextDefault(ROLL_FINISHED, sack-şablonu) ENGELLENMEDİ", err === undefined, msgOf(err).slice(0, 80));
}

async function teardown(): Promise<void> {
  // SACK + ROLL_FINISHED bağlam varsayılanlarını eski hâline al.
  try {
    const rf = await prisma.labelTemplate.findFirst({
      where: { kind: LabelKind.ROLL_FINISHED, deletedAt: null, id: { notIn: templateIds } },
      select: { id: true },
    });
    if (rf) await prisma.labelContextDefault.update({ where: { kind: LabelKind.ROLL_FINISHED }, data: { templateId: rf.id } });
    if (prevSackDefault) {
      await prisma.labelContextDefault.update({ where: { kind: LabelKind.SACK }, data: { templateId: prevSackDefault } });
    } else {
      await prisma.labelContextDefault.deleteMany({ where: { kind: LabelKind.SACK } });
    }
  } catch (e) {
    console.error("bağlam varsayılanı geri alınamadı:", e);
  }
  await prisma.customerTemplateRoute.deleteMany({ where: { customerId: CUSTOMER } });
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null } });
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.labelTemplateVariant.deleteMany({ where: { templateId: { in: templateIds } } });
  await prisma.labelTemplate.deleteMany({ where: { id: { in: templateIds } } });
  await prisma.item.deleteMany({ where: { id: ITEM } });
  await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
}

run()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
