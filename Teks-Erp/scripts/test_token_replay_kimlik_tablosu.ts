// =============================================================================
// Bekçi: TOKEN REPLAY KİMLİK TABLOSU — kimlik beyanındaki HER alan tek başına değişince 409 (DB'li)
// Çalıştır: npx tsx scripts/test_token_replay_kimlik_tablosu.ts
// =============================================================================
// NEDEN: gövde kapısından bir alan düşerse aynı token'la düzeltilmiş tekrar eski kaydı "zaten oluşturulmuş" diye
// döndürür ve düzeltme sessizce yutulur (bağımsız denetim: ödemede `amount`, hızlı siparişte `lines`, bordroda
// `bankAccountId` silinince bekçiler yeşil kaldı). Tablo satırları KİMLİK BEYANINDAN türer (`token-replay-beyan.ts`):
// beyandaki her alan için "yalnız bu alan farklı → 409 CLIENT_TOKEN_COLLISION, farkliAlanlar = [alan]"; beyanda olup
// tabloda olmayan (ya da tersi) alan kırmızıdır. Yollar: ödeme · sipariş · hızlı sipariş · depo transferi · fatura
// taslağı · teslim bordrosu · fason kabul. Yapısal kol (her politika beyanla birebir): `test_token_replay_bogaz` §4b.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Dokunulan ayarlar FOTOĞRAFINA döndürülür.
// =============================================================================
import { randomUUID } from "node:crypto";
import { CariKind, ChequeDocType, ChequeKind, ChequeStatus, Currency, Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { KIMLIK_BEYANI } from "./lib/token-replay-beyan";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { paymentService } from "../src/services/payment.service";
import { orderService } from "../src/routes/order.routes";
import { warehouseTransferService } from "../src/services/warehouse-transfer.service";
import { invoiceService } from "../src/services/invoice.service";
import { chequeDeliveryNoteService } from "../src/services/cheque-delivery-note.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const TAG = `TRKT${Date.now().toString(36).toUpperCase()}`;
const S = "src/services/";
const AYARLAR = ["finance.enabled", "finance.chequeNoteMovementEnabled"];
let foto: Array<{ key: string; value: Prisma.JsonValue }> | null = null;
const o = {
  customerIds: [] as string[], itemIds: [] as string[], rollIds: [] as string[], boxIds: [] as string[], bankIds: [] as string[],
  warehouseIds: [] as string[], cariIds: [] as string[], chequeIds: [] as string[], woIds: [] as string[], stepIds: [] as string[],
  branchIds: [] as string[],
};

/** Değişken alanın senaryosu: taze token'la ilk kayıt, ardından yalnız o alanı farklı tekrar (dönen söz). */
type Senaryo = () => Promise<unknown>;
interface Yol {
  ad: string;
  politika: string;
  alanlar: Record<string, Senaryo>;
}

async function sonuc(fn: () => Promise<unknown>): Promise<{ kod: string; farkli: string[] }> {
  try {
    await fn();
    return { kod: "ok", farkli: [] };
  } catch (e) {
    const d = (e as { details?: { code?: string; farkliAlanlar?: string[] } }).details;
    return { kod: String(d?.code ?? (e as Error).message ?? e).slice(0, 80), farkli: d?.farkliAlanlar ?? [] };
  }
}
/** İlk kaydı yapar (başarılı olmalı), sonra yalnız bir alanı farklı tekrarı döndürür. */
const tabanla = (ilk: (t: string) => Promise<unknown>, tekrar: (t: string) => Promise<unknown>): Senaryo => async () => {
  const t = randomUUID();
  await ilk(t);
  return tekrar(t);
};

async function musteri(ek: string): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `${TAG}-${ek}`, name: `${TAG} ${ek}` }, select: { id: true } });
  o.customerIds.push(c.id);
  return c.id;
}
async function kumas(ek: string): Promise<string> {
  const i = await prisma.item.create({ data: { code: `${TAG}-${ek}`, name: `${TAG} kumaş ${ek}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  o.itemIds.push(i.id);
  return i.id;
}
async function kasa(ek: string): Promise<string> {
  const b = await prisma.cashBox.create({ data: { code: `${TAG}-${ek}`.slice(0, 32), name: `${TAG} ${ek}`, currency: "TRY" }, select: { id: true } });
  o.boxIds.push(b.id);
  return b.id;
}
async function banka(ek: string): Promise<string> {
  const b = await prisma.bankAccount.create({ data: { code: `${TAG}-${ek}`.slice(0, 32), name: `${TAG} ${ek}`, currency: Currency.TRY }, select: { id: true } });
  o.bankIds.push(b.id);
  return b.id;
}
async function depo(ek: string): Promise<string> {
  const w = await prisma.warehouse.create({ data: { code: `${TAG}-${ek}`, name: `${TAG} ${ek} deposu` }, select: { id: true } });
  o.warehouseIds.push(w.id);
  return w.id;
}
let seq = 0;
async function top(itemId: string, qty: number, ek: Partial<Prisma.RollUncheckedCreateInput> = {}): Promise<string> {
  seq++;
  const r = await prisma.roll.create({
    data: { barcode: `${TAG}-R${seq}`, itemId, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, width: 150, entrySource: "SUPPLIER_RECEIPT", ...ek },
    select: { id: true },
  });
  o.rollIds.push(r.id);
  return r.id;
}

async function yollar(): Promise<Yol[]> {
  const m1 = await musteri("M1");
  const m2 = await musteri("M2");
  const sube = await prisma.customerBranch.create({ data: { customerId: m1, name: `${TAG} şube`, code: `${TAG}-SB` }, select: { id: true } });
  o.branchIds.push(sube.id);
  const k1 = await kasa("K1");
  const k2 = await kasa("K2");
  const b1 = await banka("B1");
  const b2 = await banka("B2");
  const item = await kumas("K");

  const odeme = (ek: Record<string, unknown>) => (t: string) =>
    paymentService.create({ direction: "IN", method: "CASH", customerId: m1, currency: "TRY", amount: 100, cashBoxId: k1, clientToken: t, ...ek } as Parameters<typeof paymentService.create>[0]);
  const bankaOdeme = (ek: Record<string, unknown>) => odeme({ cashBoxId: null, bankAccountId: b1, method: "BANK_TRANSFER", ...ek });

  const siparis = (ek: Record<string, unknown>) => (t: string) => orderService.create({ customerId: m1, clientToken: t, lines: [{ itemId: item, quantity: 10 }], ...ek });
  const hizli = () => {
    let ilkTop = "";
    return {
      ilk: async (t: string) => {
        ilkTop = await top(item, 70);
        return orderService.quickOrderFromRolls({ customerId: m1, rollIds: [ilkTop], clientToken: t });
      },
      tekrar: (ek: Record<string, unknown> | (() => Promise<Record<string, unknown>>)) => async (t: string) =>
        orderService.quickOrderFromRolls({ customerId: m1, rollIds: [ilkTop], clientToken: t, ...(typeof ek === "function" ? await ek() : ek) }),
    };
  };

  const dA = await depo("A");
  const dB = await depo("B");
  const dC = await depo("C");
  const transfer = () => {
    let r = "";
    return {
      ilk: async (t: string) => {
        r = await top(item, 50, { status: RollStatus.WAREHOUSE, warehouseId: dA });
        return warehouseTransferService.create({ fromWarehouseId: dA, toWarehouseId: dB, rollIds: [r], clientToken: t });
      },
      tekrar: (ek: Record<string, unknown> | (() => Promise<Record<string, unknown>>)) => async (t: string) =>
        warehouseTransferService.create({ fromWarehouseId: dA, toWarehouseId: dB, rollIds: [r], clientToken: t, ...(typeof ek === "function" ? await ek() : ek) }),
    };
  };

  const fatura = (ek: Record<string, unknown>) => (t: string) =>
    invoiceService.createDraft({
      type: "SALES", customerId: m1, currency: "TRY", clientToken: t,
      lines: [{ description: `${TAG} kumaş`, qty: 100, unit: "m", unitPrice: 25, vatRate: 20 }], ...ek,
    } as Parameters<typeof invoiceService.createDraft>[0]);

  // Bordro: belge-only (hareket bayrağı kapalı) — replay kapısı hareketten önce çalışır, çek durumu değişmez.
  const cari1 = (await prisma.cariAccount.create({ data: { kind: CariKind.CUSTOMER, customerId: m1 }, select: { id: true } })).id;
  const cari2 = (await prisma.cariAccount.create({ data: { kind: CariKind.CUSTOMER, customerId: m2 }, select: { id: true } })).id;
  o.cariIds.push(cari1, cari2);
  const gun = 864e5;
  const cek = async () => {
    const c = await prisma.cheque.create({
      data: {
        docNo: `${TAG}-C${++seq}`, kind: ChequeKind.RECEIVED, docType: ChequeDocType.CHEQUE, status: ChequeStatus.PORTFOLIO, cariId: cari1,
        currency: Currency.TRY, exchangeRate: 1, amount: 500, amountTry: 500,
        issueDate: new Date(Date.now() - 3 * gun), postingDate: new Date(Date.now() - 3 * gun), dueDate: new Date(Date.now() + 20 * gun), drawerName: `${TAG} Keşideci`,
      },
      select: { id: true },
    });
    o.chequeIds.push(c.id);
    return c.id;
  };
  const bordro = (hedef: Record<string, unknown>) => () => {
    let c = "";
    return {
      ilk: async (t: string) => {
        c = await cek();
        return chequeDeliveryNoteService.create({ chequeIds: [c], clientToken: t, ...hedef } as Parameters<typeof chequeDeliveryNoteService.create>[0], undefined, { canMoveCheques: true });
      },
      tekrar: (ek: Record<string, unknown> | (() => Promise<Record<string, unknown>>)) => async (t: string) =>
        chequeDeliveryNoteService.create({ chequeIds: [c], clientToken: t, ...hedef, ...(typeof ek === "function" ? await ek() : ek) } as Parameters<typeof chequeDeliveryNoteService.create>[0], undefined, { canMoveCheques: true }),
    };
  };

  // Fason kabul: iş emri (boya fasonu → Kurşun), iki top sevk edilmiş.
  const sub = new SubcontractorService();
  const cards = new TravelerCardService();
  const need = (v: { id: string } | null, ad: string): string => {
    if (!v) throw new Error(`Seed fikstürü eksik: ${ad}`);
    return v.id;
  };
  const patos = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const grade = await roleGrade("FIRST");
  const stBoya = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  const stKursun = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  const boyaci = (await ensureTestDyeHouse()).id;
  const zimparaci = (await ensureTestSander()).id;
  const fabrikaDepo = await fixtureWarehouseId();
  const kur = async () => {
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `${TAG}-FW${++seq}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: 250, targetQuantity: 1000, targetItemId: patos,
        steps: { create: [{ stationId: stBoya, stepSequence: 1, status: "PENDING" }, { stationId: stKursun, stepSequence: 2, status: "PENDING" }] },
      },
      include: { steps: { orderBy: { stepSequence: "asc" } } },
    });
    o.woIds.push(wo.id);
    o.stepIds.push(...wo.steps.map((st) => st.id));
    await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, undefined));
    const toplar: string[] = [];
    for (let i = 0; i < 2; i++) {
      toplar.push(await top(patos, 300, { status: RollStatus.STOCK, warehouseId: fabrikaDepo, qualityGrade: grade.code, qualityGradeId: grade.id, width: 250 }));
    }
    await sub.dispatch({ workOrderId: wo.id, stepId: wo.steps[0]!.id, subcontractorId: boyaci, rollIds: toplar }, undefined);
    return { woId: wo.id, stepId: wo.steps[0]!.id, ikinciAdim: wo.steps[1]!.id, toplar };
  };
  type Kabul = { workOrderId: string; stepId: string; subcontractorId: string; returns: Array<{ rollId: string; receivedQty?: number }>; newRolls: Array<{ qty: number }> };
  const fason = (degis: (k: Awaited<ReturnType<typeof kur>>, g: Kabul) => Promise<Kabul> | Kabul, kismi = false): Senaryo => async () => {
    const k = await kur();
    const t = randomUUID();
    const g: Kabul = { workOrderId: k.woId, stepId: k.stepId, subcontractorId: boyaci, returns: [{ rollId: k.toplar[0]!, ...(kismi ? { receivedQty: 100 } : {}) }], newRolls: [{ qty: 290 }] };
    await sub.receive({ ...g, clientToken: t }, undefined);
    return sub.receive({ ...(await degis(k, g)), clientToken: t }, undefined);
  };

  const h = hizli, tr = transfer;
  return [
    {
      ad: "ödeme", politika: `${S}payment.service.ts::paymentReplay`, alanlar: {
        direction: tabanla(odeme({}), odeme({ direction: "OUT" })),
        method: tabanla(odeme({}), odeme({ method: "CREDIT_CARD" })),
        amount: tabanla(odeme({}), odeme({ amount: 101 })),
        cashBoxId: tabanla(odeme({}), odeme({ cashBoxId: k2 })),
        bankAccountId: tabanla(bankaOdeme({}), bankaOdeme({ bankAccountId: b2 })),
        taraf: tabanla(odeme({}), odeme({ customerId: m2 })),
        currency: tabanla(odeme({}), odeme({ currency: "USD" })),
        exchangeRate: tabanla(odeme({}), odeme({ exchangeRate: 2 })),
        paymentDate: tabanla(odeme({}), odeme({ paymentDate: new Date(Date.now() - 40 * gun) })),
      },
    },
    {
      ad: "sipariş", politika: `${S}order.service.ts::orderReplay`, alanlar: {
        customerId: tabanla(siparis({}), siparis({ customerId: m2 })),
        branchId: tabanla(siparis({}), siparis({ branchId: sube.id })),
        "satırlar": tabanla(siparis({}), siparis({ lines: [{ itemId: item, quantity: 11 }] })),
        orderNumber: tabanla(siparis({}), siparis({ orderNumber: `${TAG}-ON${++seq}` })),
      },
    },
    {
      ad: "hızlı sipariş", politika: `${S}order.service.ts::quickOrderReplay`, alanlar: {
        customerId: (() => { const x = h(); return tabanla(x.ilk, x.tekrar({ customerId: m2 })); })(),
        branchId: (() => { const x = h(); return tabanla(x.ilk, x.tekrar({ branchId: sube.id })); })(),
        lines: (() => { const x = h(); return tabanla(x.ilk, x.tekrar(async () => ({ rollIds: [await top(item, 71)] }))); })(),
      },
    },
    {
      ad: "depo transferi", politika: `${S}warehouse-transfer.service.ts::transferReplay`, alanlar: {
        fromWarehouseId: (() => { const x = tr(); return tabanla(x.ilk, x.tekrar({ fromWarehouseId: dC })); })(),
        toWarehouseId: (() => { const x = tr(); return tabanla(x.ilk, x.tekrar({ toWarehouseId: dC })); })(),
        toplar: (() => { const x = tr(); return tabanla(x.ilk, x.tekrar(async () => ({ rollIds: [await top(item, 50, { status: RollStatus.WAREHOUSE, warehouseId: dA })] }))); })(),
      },
    },
    {
      ad: "fatura taslağı", politika: `${S}invoice.service.ts::invoiceReplay`, alanlar: {
        type: tabanla(fatura({}), fatura({ type: "SALES_RETURN" })),
        taraf: tabanla(fatura({}), fatura({ customerId: m2 })),
        currency: tabanla(fatura({}), fatura({ currency: "USD" })),
        "satırlar": tabanla(fatura({}), fatura({ lines: [{ description: `${TAG} kumaş`, qty: 101, unit: "m", unitPrice: 25, vatRate: 20 }] })),
      },
    },
    {
      ad: "teslim bordrosu", politika: `${S}cheque-delivery-note.service.ts::noteReplay`, alanlar: {
        chequeIds: (() => { const x = bordro({ bankAccountId: b1 })(); return tabanla(x.ilk, x.tekrar(async () => ({ chequeIds: [await cek()] }))); })(),
        bankAccountId: (() => { const x = bordro({ bankAccountId: b1 })(); return tabanla(x.ilk, x.tekrar({ bankAccountId: b2 })); })(),
        cariId: (() => { const x = bordro({ cariId: cari1 })(); return tabanla(x.ilk, x.tekrar({ cariId: cari2 })); })(),
        targetLabel: (() => { const x = bordro({ bankAccountId: b1 })(); return tabanla(x.ilk, x.tekrar({ targetLabel: "Kasa önü" })); })(),
        notes: (() => { const x = bordro({ bankAccountId: b1 })(); return tabanla(x.ilk, x.tekrar({ notes: "başka not" })); })(),
        deliveryDate: (() => { const x = bordro({ bankAccountId: b1 })(); return tabanla(x.ilk, x.tekrar({ deliveryDate: new Date(Date.now() - 2 * gun) })); })(),
      },
    },
    {
      ad: "fason kabul", politika: `${S}subcontractor.service.ts::receiptReplay`, alanlar: {
        workOrderId: fason(async (_k, g) => ({ ...g, workOrderId: (await kur()).woId })),
        stepId: fason((k, g) => ({ ...g, stepId: k.ikinciAdim })),
        subcontractorId: fason((_k, g) => ({ ...g, subcontractorId: zimparaci })),
        toplar: fason((k, g) => ({ ...g, returns: [{ rollId: k.toplar[1]! }] })),
        metrajlar: fason((k, g) => ({ ...g, returns: [{ rollId: k.toplar[0]!, receivedQty: 120 }] }), true),
        yeniToplar: fason((_k, g) => ({ ...g, newRolls: [{ qty: 280 }] })),
      },
    },
  ];
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n❌ ${engel}\n`);
    fail++;
    return;
  }
  console.log("=== Token replay — kimlik tablosu (beyandan türeyen) ===\n");
  foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  await prisma.systemSetting.upsert({ where: { key: "finance.enabled" }, create: { key: "finance.enabled", value: true }, update: { value: true } });
  await prisma.systemSetting.upsert({ where: { key: "finance.chequeNoteMovementEnabled" }, create: { key: "finance.chequeNoteMovementEnabled", value: false }, update: { value: false } });
  const tablo = await yollar();
  check("tablo kör değil (7 yol)", tablo.length === 7, `${tablo.length} yol`);
  for (const y of tablo) {
    console.log(`§ ${y.ad}`);
    const beyan = KIMLIK_BEYANI[y.politika];
    if (!beyan) {
      check(`${y.ad}: kimlik beyanı bulundu`, false, y.politika);
      continue;
    }
    const tabloda = Object.keys(y.alanlar);
    const eksik = beyan.filter((a) => !tabloda.includes(a));
    const fazla = tabloda.filter((a) => !beyan.includes(a));
    check(`${y.ad}: tablo beyanla birebir (her kimlik alanının satırı var)`, eksik.length === 0 && fazla.length === 0, `eksik [${eksik.join(",")}] · fazla [${fazla.join(",")}]`);
    for (const alan of beyan) {
      const sen = y.alanlar[alan];
      if (!sen) continue;
      const r = await sonuc(sen);
      check(`${y.ad} · ${alan}: yalnız bu alan farklı → 409 CLIENT_TOKEN_COLLISION, farkliAlanlar=[${alan}]`,
        r.kod === "CLIENT_TOKEN_COLLISION" && r.farkli.length === 1 && r.farkli[0] === alan, `${r.kod} [${r.farkli.join(",")}]`);
    }
  }
}

async function temizlik(): Promise<void> {
  const adim = async (ad: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      fail++;
      console.error(`  ❌ temizlik "${ad}" düştü: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (foto) {
    for (const key of AYARLAR) {
      const eski = foto.find((f) => f.key === key);
      await adim(`ayar ${key}`, () => (eski ? prisma.systemSetting.update({ where: { key }, data: { value: eski.value as Prisma.InputJsonValue } }) : prisma.systemSetting.deleteMany({ where: { key } })));
    }
  }
  const musteriler = { in: o.customerIds };
  const cariler = [...new Set([...o.cariIds, ...(await prisma.cariAccount.findMany({ where: { customerId: musteriler }, select: { id: true } })).map((c) => c.id)])];
  const odemeler = (await prisma.payment.findMany({ where: { cariId: { in: cariler } }, select: { id: true } })).map((p) => p.id);
  const faturalar = (await prisma.invoice.findMany({ where: { cariId: { in: cariler } }, select: { id: true } })).map((f) => f.id);
  const siparisler = (await prisma.order.findMany({ where: { customerId: musteriler }, select: { id: true } })).map((s) => s.id);
  const transferler = (await prisma.warehouseTransfer.findMany({ where: { OR: [{ fromWarehouseId: { in: o.warehouseIds } }, { toWarehouseId: { in: o.warehouseIds } }] }, select: { id: true } })).map((t) => t.id);
  const notlar = [...new Set((await prisma.chequeDeliveryNoteItem.findMany({ where: { chequeId: { in: o.chequeIds } }, select: { noteId: true } })).map((n) => n.noteId))];
  const wo = { in: o.woIds };
  const kabuller = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: wo }, select: { id: true } })).map((r) => r.id);
  const sevkler = (await prisma.subcontractorDispatch.findMany({ where: { workOrderId: wo }, select: { id: true } })).map((d) => d.id);
  const toplar = [...new Set([...o.rollIds, ...(await prisma.roll.findMany({ where: { OR: [{ parentReceiptId: { in: kabuller } }, { currentStepId: { in: o.stepIds } }, { producedInStepId: { in: o.stepIds } }] }, select: { id: true } })).map((r) => r.id)])];
  await adim("belgeler", () => prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...odemeler, ...faturalar, ...transferler, ...notlar, ...sevkler, ...kabuller] } } }));
  await adim("kasa/banka hareketleri", () => prisma.cashTransaction.deleteMany({ where: { OR: [{ paymentId: { in: odemeler } }, { cashBoxId: { in: o.boxIds } }, { bankAccountId: { in: o.bankIds } }] } }));
  await adim("cari satırları", () => prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariler } } }));
  await adim("ödemeler", () => prisma.payment.deleteMany({ where: { id: { in: odemeler } } }));
  await adim("faturalar", async () => {
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: faturalar } } });
    await prisma.invoice.deleteMany({ where: { id: { in: faturalar } } });
  });
  await adim("bordrolar", async () => {
    await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: o.chequeIds } } });
    await prisma.chequeDeliveryNoteItem.deleteMany({ where: { noteId: { in: notlar } } });
    await prisma.chequeDeliveryNote.deleteMany({ where: { id: { in: notlar } } });
    await prisma.cheque.deleteMany({ where: { id: { in: o.chequeIds } } });
  });
  await adim("fason", async () => {
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: kabuller } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: kabuller } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: sevkler } } });
  });
  await adim("top izleri", async () => {
    await prisma.sackAllocation.deleteMany({ where: { sack: { rolls: { some: { id: { in: toplar } } } } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: toplar } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: toplar } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: toplar } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: toplar } } });
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: toplar } } });
  });
  await adim("sipariş satırları", () => prisma.orderLine.deleteMany({ where: { orderId: { in: siparisler } } }));
  await adim("toplar", () => prisma.roll.deleteMany({ where: { id: { in: toplar } } }));
  await adim("sipariş başlıkları", () => prisma.order.deleteMany({ where: { id: { in: siparisler } } }));
  await adim("transferler", () => prisma.warehouseTransfer.deleteMany({ where: { id: { in: transferler } } }));
  await adim("kabul/sevk", async () => {
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: kabuller } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: sevkler } } });
  });
  await adim("iş emirleri", async () => {
    await prisma.travelerCard.deleteMany({ where: { workOrderId: wo } });
    await prisma.batch.deleteMany({ where: { workOrderId: wo } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: wo } });
    await prisma.workOrder.deleteMany({ where: { id: wo } });
  });
  await adim("cari", async () => {
    await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariler } } });
    await prisma.cariAccount.deleteMany({ where: { id: { in: cariler } } });
  });
  await adim("kasa/banka", async () => {
    await prisma.cashBox.deleteMany({ where: { id: { in: o.boxIds } } });
    await prisma.bankAccount.deleteMany({ where: { id: { in: o.bankIds } } });
  });
  await adim("depolar", () => prisma.warehouse.deleteMany({ where: { id: { in: o.warehouseIds } } }));
  await adim("şube", () => prisma.customerBranch.deleteMany({ where: { id: { in: o.branchIds } } }));
  await adim("kartlar", () => prisma.item.deleteMany({ where: { id: { in: o.itemIds } } }));
  await adim("müşteriler", () => prisma.customer.deleteMany({ where: { id: musteriler } }));
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e instanceof Error ? e.stack : e);
    fail++;
  })
  .finally(async () => {
    await temizlik();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
