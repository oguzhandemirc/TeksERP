// =============================================================================
// Bekçi: TOKEN REPLAY — ZORLANMIŞ SIRA (D1: levent tüketimi · hızlı sipariş · elle numaralı sipariş)
// Çalıştır: npx tsx scripts/test_token_replay_zorlanmis_sira.ts
// =============================================================================
// Sınıf (`docs/design/TOKEN-REPLAY-KILIDI.md` §1): aynı `clientToken`lı ikinci deneme replay yerine iş
// kuralı 4xx'i alırsa istemci yeni token üretir ve aynı mantıksal denemeden İKİNCİ kayıt çıkar. Bu bekçi
// yarışı yükle değil ZORLANMIŞ SIRAYLA açar (`scripts/lib/zorlanmis-sira.ts`): B token'ı okuyup kuralda
// bekletilir, A koşar. Her durumda önce "sıra gerçekten zorlandı mı" ölçülür (kapı A bitince ya da A PG
// kilidinde beklerken açılmalı), sonra cevabın token'dan geldiği.
//   §1 levent tüketimi (#6, R): aynı token → replay (kalan kuralı da, token P2002'si de) · başka metre → 409
//      CLIENT_TOKEN_COLLISION · geri alınmış → 409 WARP_BEAM_CONSUME_REVOKED · §5-6: FARKLI token'lı iki
//      tüketim kalanı aşamaz (levent satır kilidi).
//   §2 hızlı sipariş (#10, K): aynı token → tek sipariş, ikisi de başarılı · başka müşteri → 409 · §5-7:
//      sipariş yazımı düşerse top claim'i de geri alınır.
//   §3 elle numaralı sipariş (#11, R): sıralı tekrar "numara zaten var" değil replay · aynı token + başka
//      numara → 409 · eşzamanlı aynı token → tek sipariş.
//   §4 Tambur kesimi (#8 depo topu · #9 açık kumaş, R): eşzamanlı aynı token → tek çocuk (kaybeden "top
//      değişti" 409'unu almaz) · başka metre → 409 · iptal edilmiş çocuğun token'ı → 409 ENTRY_CANCELLED.
//   §5 kasa (#18 hareket · #19 virman, R): eşzamanlı açılış → replay ("açılış zaten girilmiş" değil) · iptal
//      edilmiş hareket/virman → 409 CASH_TXN_CANCELLED · virmanda başka tutar → 409 · eksi kasa kapısı açıkken
//      eşzamanlı virman → replay (bakiye 409'u değil).
//   §6 fason kabul (R + gövde kapısı): aynı token + başka top kümesi / başka metraj → 409 (eskiden sessiz başarı).
//   §7 hareketli teslim bordrosu (K, K3 bayrağı açık): eşzamanlı aynı token → tek bordro, çek TEK kez hareket eder
//      (kaybeden 8036'da bekler, geçişleri yeniden koşmaz).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döndürülür.
// =============================================================================
import { randomUUID } from "node:crypto";
import { CariKind, ChequeDocType, ChequeEventType, ChequeKind, ChequeStatus, Currency, Prisma, RollStatus, StationKind, WarpBeamOrigin, WarpKgSource, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SIRA_ZORLANDI, sonucKodu, zorlanmisSira, type ZorlanmisSiraSonucu } from "./lib/zorlanmis-sira";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam, getWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { cancelConsumed, consumeBeam } from "../src/services/warp-beam-consume.service";
import { orderService } from "../src/routes/order.routes";
import { TamburService } from "../src/services/tambur.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { chequeDeliveryNoteService } from "../src/services/cheque-delivery-note.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
async function kodu(fn: () => Promise<unknown>): Promise<string> {
  const [r] = await Promise.allSettled([fn()]);
  return sonucKodu(r);
}
const ozet = (s: ZorlanmisSiraSonucu) => `B | A = ${s.sonuclar.map(sonucKodu).join(" | ")} · kapı: ${s.kapi}`;
const zorlandi = (ad: string, s: ZorlanmisSiraSonucu) => check(`${ad}: sıra zorlandı (B kapıda bekledi)`, SIRA_ZORLANDI.has(s.kapi), s.kapi);

const TAG = `TRZ${Date.now().toString(36).toUpperCase()}`;
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.FINANCE_BLOCK_NEGATIVE_CASH_ENABLED, "finance.enabled", "finance.chequeNoteMovementEnabled"];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });

const olusan = {
  beamIds: [] as string[],
  specId: null as string | null,
  yarnId: null as string | null,
  subId: null as string | null,
  itemId: null as string | null,
  customerIds: [] as string[],
  rollIds: [] as string[],
  cutParentIds: [] as string[],
  colorId: null as string | null,
  bordroCariIds: [] as string[],
  chequeIds: [] as string[],
  woIds: [] as string[],
  stepIds: [] as string[],
  boxIds: [] as string[],
  bankIds: [] as string[],
};
let foto: Array<{ key: string; value: Prisma.JsonValue }> | null = null;

type TxFn = (fn: unknown, opts?: unknown) => Promise<unknown>;
/** §5-7 sondası: tx içindeki `order.create` düşürülür — claim ile sipariş aynı tx'teyse toplar geri döner. */
async function siparisInsertiDuserken(fn: () => Promise<unknown>): Promise<string> {
  const kanca = prisma as unknown as { $transaction: TxFn };
  const onceki = kanca.$transaction;
  const asil = onceki.bind(prisma);
  const bagla = (t: object, p: string | symbol) => {
    const v = Reflect.get(t, p) as unknown;
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
  };
  kanca.$transaction = (f, o) => {
    if (typeof f !== "function") return asil(f, o);
    return asil((tx: object) => {
      const order = new Proxy(Reflect.get(tx, "order") as object, {
        get: (d, m) => (m === "create" ? async () => Promise.reject(new Error("SONDA: sipariş insert'i düşürüldü")) : bagla(d, m)),
      });
      return (f as (t: object) => unknown)(new Proxy(tx, { get: (t, p) => (p === "order" ? order : bagla(t, p)) }));
    }, o);
  };
  try {
    return await kodu(fn);
  } finally {
    kanca.$transaction = onceki;
  }
}

async function levent(): Promise<void> {
  console.log("§1 Levent tüketimi (#6) + §5-6 kalan kilidi");
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  olusan.yarnId = yarn.id;
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
  olusan.specId = spec.id;
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  olusan.subId = sub.id;
  const sar = async (m: number) => {
    // Fason köken: iplik defteri devre dışı (iplik modülü KAPALI) — yalnız levent defteri ölçülür.
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: m, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    olusan.beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };
  const kalan = async (id: string) => (await getWarpBeam(id)).data.remainingM;
  const tokenSatiri = (t: string) => prisma.warpBeamEvent.count({ where: { clientToken: t } });
  const tuketim = (id: string) => prisma.warpBeamEvent.count({ where: { beamId: id, kind: "CONSUMED" } });
  const tuket = (id: string, m: number, t: string | null) => () => consumeBeam(id, { lengthM: m, lengthSource: "ESTIMATED", clientToken: t });

  const b0 = await sar(100);
  const t0 = randomUUID();
  await tuket(b0, 30, t0)();
  const tekrar = await consumeBeam(b0, { lengthM: 30, lengthSource: "ESTIMATED", clientToken: t0 });
  check("①a sıralı tekrar → replay, ikinci satır yok", /yeniden gönderim/.test(tekrar.message ?? "") && (await tuketim(b0)) === 1 && (await kalan(b0)) === 70);
  check("①a aynı token + başka metre → 409 CLIENT_TOKEN_COLLISION (eski davranış: sessiz başarı)", (await kodu(tuket(b0, 31, t0))) === "CLIENT_TOKEN_COLLISION" && (await tuketim(b0)) === 1);

  // B token'ı okur (yok), tx'te leventi okurken (`loadBeamTx`) bekler; A tüketip commit eder.
  const durumlar: Array<[string, number, number, number]> = [
    ["kalan kuralı yolu (60+60 > 100)", 60, 60, 40],
    ["token P2002 yolu (30+30 ≤ 100)", 30, 30, 70],
  ];
  for (const [ad, bM, aM, kalanBeklenen] of durumlar) {
    const id = await sar(100);
    const t = randomUUID();
    const s = await zorlanmisSira({ model: "warpBeam", metod: "findUnique" }, tuket(id, bM, t), tuket(id, aM, t));
    zorlandi(`①b ${ad}`, s);
    check(`①b ⭐ ${ad}: aynı token, ikisi de başarılı, TEK tüketim (kaybeden replay alır, iş kuralı 409'u değil)`,
      s.sonuclar.every((r) => r.status === "fulfilled") && (await tokenSatiri(t)) === 1 && (await tuketim(id)) === 1 && (await kalan(id)) === kalanBeklenen, ozet(s));
  }
  {
    const id = await sar(100);
    const t = randomUUID();
    const s = await zorlanmisSira({ model: "warpBeam", metod: "findUnique" }, tuket(id, 30, t), tuket(id, 40, t));
    zorlandi("①c başka metre", s);
    check("①c ⭐ aynı token + başka metre, eşzamanlı: A yazar, B 409 CLIENT_TOKEN_COLLISION (ham P2002 değil)",
      sonucKodu(s.sonuclar[0]) === "CLIENT_TOKEN_COLLISION" && sonucKodu(s.sonuclar[1]) === "ok" && (await tuketim(id)) === 1 && (await kalan(id)) === 60, ozet(s));
  }
  {
    const ev = await prisma.warpBeamEvent.findFirstOrThrow({ where: { clientToken: t0 }, select: { id: true } });
    await cancelConsumed(b0, ev.id, `${TAG} yanlış sayaç`);
    check("①d geri alınmış tüketimin token'ı → 409 WARP_BEAM_CONSUME_REVOKED (4. durum)", (await kodu(tuket(b0, 30, t0))) === "WARP_BEAM_CONSUME_REVOKED" && (await kalan(b0)) === 100);
  }
  {
    // §5-6: B kalanı okuyup claim'de bekler; A FARKLI token'la aynı leventten tüketir.
    const id = await sar(100);
    const s = await zorlanmisSira({ model: "warpBeam", metod: "updateMany" }, tuket(id, 60, randomUUID()), tuket(id, 60, randomUUID()));
    zorlandi("①e farklı token", s);
    const kodlar = s.sonuclar.map(sonucKodu);
    check("①e ⭐ §5-6 farklı token'lı iki 60 m tüketim (kalan 100): biri yazar, öteki 409 WARP_BEAM_REMAINING_EXCEEDED; kalan eksiye düşmez",
      kodlar.filter((k) => k === "ok").length === 1 && kodlar.includes("WARP_BEAM_REMAINING_EXCEEDED") && (await tuketim(id)) === 1 && (await kalan(id)) === 40,
      `${ozet(s)} · kalan=${await kalan(id)}`);
  }
}

async function hizliSiparis(): Promise<void> {
  console.log("§2 Hızlı sipariş (#10) + §5-7 atomiklik");
  const item = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} ham kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  olusan.itemId = item.id;
  const musteri = async (n: number) => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-M${n}`, name: `${TAG} Müşteri ${n}` }, select: { id: true } });
    olusan.customerIds.push(c.id);
    return c.id;
  };
  const m1 = await musteri(1);
  const m2 = await musteri(2);
  let seq = 0;
  const top = async (qty: number) => {
    seq++;
    const r = await prisma.roll.create({
      data: { barcode: `${TAG}-R${seq}`, itemId: item.id, colorId: null, status: RollStatus.STOCK, currentQty: qty, initialQty: qty, width: 150, entrySource: "SUPPLIER_RECEIPT" },
      select: { id: true },
    });
    olusan.rollIds.push(r.id);
    return r.id;
  };
  const siparisSayisi = (t: string) => prisma.order.count({ where: { clientToken: t } });
  const durum = async (ids: string[]) => new Set((await prisma.roll.findMany({ where: { id: { in: ids } }, select: { status: true } })).map((r) => r.status));
  const ac = (customerId: string, rollIds: string[], t: string) => () => orderService.quickOrderFromRolls({ customerId, rollIds, clientToken: t });
  const siparisId = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" ? (r.value as { data: { order: { id: string } } }).data.order.id : null;

  {
    // B token'ı okur, top claim'inde bekler; A aynı token'la aynı toplardan sipariş açar.
    const toplar = [await top(100), await top(50)];
    const t = randomUUID();
    const s = await zorlanmisSira({ model: "roll", metod: "updateMany" }, ac(m1, toplar, t), ac(m1, toplar, t));
    zorlandi("②a aynı gövde", s);
    const [b, a] = s.sonuclar.map(siparisId);
    check("②a ⭐ aynı token, eşzamanlı: ikisi de başarılı, AYNI sipariş, tek kayıt (kaybeden 'başka akışta tüketildi' 409'u almaz)",
      !!b && b === a && (await siparisSayisi(t)) === 1, ozet(s));
    check("②a toplar WAREHOUSE", (await durum(toplar)).size === 1 && (await durum(toplar)).has(RollStatus.WAREHOUSE));
    const sirali = await kodu(ac(m1, toplar, t));
    check("②b sıralı tekrar (toplar artık WAREHOUSE) → replay, ikinci sipariş yok", sirali === "ok" && (await siparisSayisi(t)) === 1, sirali);
  }
  {
    const toplar = [await top(70)];
    const t = randomUUID();
    const s = await zorlanmisSira({ model: "roll", metod: "updateMany" }, ac(m1, toplar, t), ac(m2, toplar, t));
    zorlandi("②c başka müşteri", s);
    const kodlar = s.sonuclar.map(sonucKodu);
    check("②c ⭐ aynı token + başka müşteri, eşzamanlı: biri açar, öteki 409 CLIENT_TOKEN_COLLISION; tek sipariş",
      kodlar.filter((k) => k === "ok").length === 1 && kodlar.includes("CLIENT_TOKEN_COLLISION") && (await siparisSayisi(t)) === 1, ozet(s));
  }
  {
    const toplar = [await top(40), await top(45)];
    const t = randomUUID();
    const k = await siparisInsertiDuserken(ac(m1, toplar, t));
    const st = await durum(toplar);
    check("②d ⭐ §5-7 sipariş yazımı düşerse top claim'i de geri alınır: toplar STOCK kalır, sipariş yok",
      /SONDA/.test(k) && st.size === 1 && st.has(RollStatus.STOCK) && (await siparisSayisi(t)) === 0, `${k} · durum=${[...st].join(",")}`);
  }
}

async function elleNumara(): Promise<void> {
  console.log("§3 Elle numaralı sipariş (#11)");
  const customerId = olusan.customerIds[0]!;
  const itemId = olusan.itemId!;
  const govde = (orderNumber: string, t: string) => ({ customerId, orderNumber, clientToken: t, lines: [{ itemId, quantity: 10 }] });
  const yarat = (orderNumber: string, t: string) => () => orderService.create(govde(orderNumber, t));
  const sayi = (no: string) => prisma.order.count({ where: { orderNumber: no } });

  const no1 = `${TAG}-S1`;
  const t1 = randomUUID();
  const ilk = await orderService.create(govde(no1, t1));
  const ilkId = (ilk.data as { id: string }).id;
  const [tekrar] = await Promise.allSettled([yarat(no1, t1)()]);
  check("③a ⭐ sıralı tekrar (aynı token + aynı numara) → replay, '… zaten var' 409'u DEĞİL",
    tekrar.status === "fulfilled" && (tekrar.value.data as { id: string }).id === ilkId && (await sayi(no1)) === 1, sonucKodu(tekrar));
  check("③b aynı token + başka numara → 409 CLIENT_TOKEN_COLLISION (eski davranış: eski siparişi 'oluşturuldu' diye döndürürdü)",
    (await kodu(yarat(`${TAG}-S1B`, t1))) === "CLIENT_TOKEN_COLLISION" && (await sayi(`${TAG}-S1B`)) === 0);
  check("③c başka token + dolu numara → iş kuralı 409 sürüyor", /zaten var/.test(await kodu(yarat(no1, randomUUID()))));

  const no2 = `${TAG}-S2`;
  const t2 = randomUUID();
  const s = await zorlanmisSira({ model: "order", metod: "create" }, yarat(no2, t2), yarat(no2, t2));
  zorlandi("③d eşzamanlı", s);
  const ids = s.sonuclar.map((r) => (r.status === "fulfilled" ? (r.value as { data: { id: string } }).data.id : null));
  check("③d ⭐ aynı token + aynı numara, eşzamanlı: ikisi de başarılı, AYNI sipariş, tek kayıt",
    !!ids[0] && ids[0] === ids[1] && (await sayi(no2)) === 1, ozet(s));
}

async function kesim(): Promise<void> {
  console.log("§4 Tambur kesimi (#8 depo topu · #9 açık kumaş)");
  const tambur = new TamburService();
  const need = <T>(v: T | null, ad: string): T => {
    if (v == null) throw new Error(`Seed fikstürü eksik: ${ad}`);
    return v;
  };
  const item = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  const grade = await roleGrade("FIRST");
  const renk = await prisma.color.create({ data: { code: `${TAG}-RK`.slice(0, 32), name: `${TAG} renk` }, select: { id: true } });
  olusan.colorId = renk.id;
  const color = renk.id;
  const stTambur = need(await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR }, select: { id: true } }), "TAMBUR").id;
  let seq = 0;
  const ortak = { itemId: item, colorId: color, width: 150, qualityGrade: grade.code, qualityGradeId: grade.id };
  const depoTopu = async (qty: number) => {
    const r = await prisma.roll.create({ data: { ...ortak, barcode: `${TAG}-K${seq++}`, status: RollStatus.WAREHOUSE, currentQty: qty, initialQty: qty }, select: { id: true } });
    olusan.cutParentIds.push(r.id);
    return r.id;
  };
  const acikKumas = async (qty: number) => {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-WO${seq++}`, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, width: 150, targetItemId: item, steps: { create: [{ stationId: stTambur, stepSequence: 1, status: "ACTIVE" as const }] } },
      include: { steps: true },
    });
    olusan.woIds.push(wo.id);
    const r = await prisma.roll.create({ data: { ...ortak, barcode: null, status: RollStatus.IN_PRODUCTION, currentQty: qty, initialQty: qty, currentStepId: wo.steps[0]!.id, entrySource: "SUBCONTRACTOR_RETURN" }, select: { id: true } });
    olusan.cutParentIds.push(r.id);
    return r.id;
  };
  const cocuk = (t: string) => prisma.roll.count({ where: { clientToken: t } });
  const kalan = async (id: string) => Number((await prisma.roll.findUniqueOrThrow({ where: { id }, select: { currentQty: true } })).currentQty);
  const kes = (id: string, m: number, t: string) => () => tambur.cutWarehouseRoll(id, { cutLength: m, clientToken: t });
  const acKes = (id: string, m: number, t: string) => () => tambur.cutOpenFabric(id, { lengthMeters: m, status: "WAREHOUSE", clientToken: t });

  // B token'ı okur, ebeveyn satır kilidini alıp çocuğu yazarken bekler; A aynı token'la aynı topu keser.
  // 100'den 60: A kilidi alınca kalan 40 < 60 görür — kural yolu (top "değişti"), P2002 yolu değil.
  {
    const w = await depoTopu(100);
    const t = randomUUID();
    const s = await zorlanmisSira({ model: "roll", metod: "create" }, kes(w, 60, t), kes(w, 60, t));
    zorlandi("④a #8 aynı gövde", s);
    check("④a ⭐ #8 aynı token, eşzamanlı: ikisi de başarılı, TEK çocuk, ebeveyn bir kez düştü (kaybeden 'top değişti' 409'unu almaz)",
      s.sonuclar.every((r) => r.status === "fulfilled") && (await cocuk(t)) === 1 && (await kalan(w)) === 40, ozet(s));
  }
  {
    const w = await depoTopu(100);
    const t = randomUUID();
    const s = await zorlanmisSira({ model: "roll", metod: "create" }, kes(w, 60, t), kes(w, 50, t));
    zorlandi("④b #8 başka metre", s);
    check("④b ⭐ #8 aynı token + başka metre, eşzamanlı: biri keser, öteki 409 CLIENT_TOKEN_COLLISION; tek çocuk",
      s.sonuclar.filter((r) => r.status === "fulfilled").length === 1 && s.sonuclar.map(sonucKodu).includes("CLIENT_TOKEN_COLLISION") && (await cocuk(t)) === 1, ozet(s));
  }
  {
    const w = await depoTopu(100);
    const t = randomUUID();
    await kes(w, 20, t)();
    await prisma.roll.updateMany({ where: { clientToken: t }, data: { status: RollStatus.CANCELLED } });
    check("④c #8 iptal edilmiş çocuğun token'ı → 409 ENTRY_CANCELLED (4. durum; eskiden 'kesim zaten kaydedilmiş')", (await kodu(kes(w, 20, t))) === "ENTRY_CANCELLED");
  }
  {
    const o = await acikKumas(100);
    const t = randomUUID();
    const s = await zorlanmisSira({ model: "roll", metod: "create" }, acKes(o, 60, t), acKes(o, 60, t));
    zorlandi("④d #9 aynı gövde", s);
    check("④d ⭐ #9 açık kumaş, aynı token eşzamanlı: ikisi de başarılı, TEK çocuk (kaybeden 'top değişti' 409'unu almaz)",
      s.sonuclar.every((r) => r.status === "fulfilled") && (await cocuk(t)) === 1 && (await kalan(o)) === 40, ozet(s));
  }
}

async function kasa(): Promise<void> {
  console.log("§5 Kasa (#18 hareket · #19 virman)");
  const kasaAc = async (n: string) => {
    const b = await prisma.cashBox.create({ data: { code: `${TAG}-K${n}`, name: `${TAG} kasa ${n}`, currency: "TRY" }, select: { id: true } });
    olusan.boxIds.push(b.id);
    return b.id;
  };
  const bankaAc = async (n: string) => {
    const b = await prisma.bankAccount.create({ data: { code: `${TAG}-B${n}`, name: `${TAG} banka ${n}`, currency: "TRY" }, select: { id: true } });
    olusan.bankIds.push(b.id);
    return b.id;
  };
  const tokenSatiri = (t: string) => prisma.cashTransaction.count({ where: { clientToken: t } });
  const k1 = await kasaAc("1");
  const b1 = await bankaAc("1");
  await setFlag(SETTING_KEYS.FINANCE_BLOCK_NEGATIVE_CASH_ENABLED, false);
  {
    // B token'ı okur, açılış tekilliği okumasında bekler; A aynı token'la aynı açılışı yazar.
    const t = randomUUID();
    const ac = () => cashTransactionService.create({ kind: "OPENING", cashBoxId: k1, amount: 100, clientToken: t });
    const s = await zorlanmisSira({ model: "cashTransaction", metod: "findFirst" }, ac, ac);
    zorlandi("⑤a #18 açılış", s);
    check("⑤a ⭐ #18 aynı token'lı eşzamanlı açılış: ikisi de başarılı, tek satır ('açılış zaten girilmiş' 409'u değil)",
      s.sonuclar.every((r) => r.status === "fulfilled") && (await tokenSatiri(t)) === 1, ozet(s));
  }
  {
    const t = randomUUID();
    const r = await cashTransactionService.create({ kind: "EXPENSE", cashBoxId: k1, amount: 10, clientToken: t });
    await cashTransactionService.cancel(r.data!.id, `${TAG} iptal`);
    check("⑤b #18 iptal edilmiş hareketin token'ı → 409 CASH_TXN_CANCELLED (§5-4; eskiden 'zaten oluşturulmuş')",
      (await kodu(() => cashTransactionService.create({ kind: "EXPENSE", cashBoxId: k1, amount: 10, clientToken: t }))) === "CASH_TXN_CANCELLED");
  }
  const virman = (amount: number, t: string, from = k1) => () => cashTransactionService.transfer({ fromCashBoxId: from, toBankAccountId: b1, amount, clientToken: t });
  {
    const t = randomUUID();
    await virman(30, t)();
    check("⑤c #19 aynı token + başka tutar → 409 CLIENT_TOKEN_COLLISION (§5-3; eskiden eski virman 'kaydedilmiş' dönerdi)", (await kodu(virman(40, t))) === "CLIENT_TOKEN_COLLISION");
    const tekrar = await kodu(virman(30, t));
    check("⑤c #19 aynı gövde tekrarı → replay, ikinci virman yok", tekrar === "ok" && (await prisma.cashTransaction.count({ where: { cashBoxId: k1, kind: "TRANSFER_OUT", status: { not: "CANCELLED" } } })) === 1, tekrar);
    const out = await prisma.cashTransaction.findFirstOrThrow({ where: { clientToken: t }, select: { id: true } });
    await cashTransactionService.cancel(out.id, `${TAG} iptal`);
    check("⑤d #19 iptal edilmiş virmanın token'ı → 409 CASH_TXN_CANCELLED", (await kodu(virman(30, t))) === "CASH_TXN_CANCELLED");
  }
  {
    // Eksi kasa kapısı AÇIK: B kilitleri tutup satırı yazarken bekler; A aynı token'la aynı virmanı dener.
    const k2 = await kasaAc("2");
    await cashTransactionService.create({ kind: "OPENING", cashBoxId: k2, amount: 100, clientToken: randomUUID() });
    await setFlag(SETTING_KEYS.FINANCE_BLOCK_NEGATIVE_CASH_ENABLED, true);
    const t = randomUUID();
    const s = await zorlanmisSira({ model: "cashTransaction", metod: "create" }, virman(80, t, k2), virman(80, t, k2));
    zorlandi("⑤e #19 eksi kasa", s);
    check("⑤e ⭐ #19 eksi kasa kapısı açıkken aynı token'lı eşzamanlı virman: ikisi de başarılı, tek virman (bakiye 409'u değil)",
      s.sonuclar.every((r) => r.status === "fulfilled") && (await tokenSatiri(t)) === 1, ozet(s));
    await setFlag(SETTING_KEYS.FINANCE_BLOCK_NEGATIVE_CASH_ENABLED, false);
  }
}

async function fasonKabul(): Promise<void> {
  console.log("§6 Fason kabul (gövde kapısı)");
  const sub = new SubcontractorService();
  const cards = new TravelerCardService();
  const need = (v: { id: string } | null, ad: string): string => {
    if (!v) throw new Error(`Seed fikstürü eksik: ${ad}`);
    return v.id;
  };
  const item = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const grade = await roleGrade("FIRST");
  const stBoya = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  const stKursun = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  const boyaci = (await ensureTestDyeHouse()).id;
  const depo = await fixtureWarehouseId();
  let seq = 0;
  const kur = async () => {
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `${TAG}-FW${seq++}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: 250, targetQuantity: 1000, targetItemId: item,
        steps: { create: [{ stationId: stBoya, stepSequence: 1, status: "PENDING" }, { stationId: stKursun, stepSequence: 2, status: "PENDING" }] },
      },
      include: { steps: { orderBy: { stepSequence: "asc" } } },
    });
    olusan.woIds.push(wo.id);
    olusan.stepIds.push(...wo.steps.map((st) => st.id));
    await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, undefined));
    const toplar: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await prisma.roll.create({ data: { barcode: `${TAG}-F${seq++}`, itemId: item, initialQty: 300, currentQty: 300, status: RollStatus.STOCK, warehouseId: depo, qualityGrade: grade.code, qualityGradeId: grade.id, width: 250 }, select: { id: true } });
      olusan.rollIds.push(r.id);
      toplar.push(r.id);
    }
    await sub.dispatch({ workOrderId: wo.id, stepId: wo.steps[0]!.id, subcontractorId: boyaci, rollIds: toplar }, undefined);
    return { woId: wo.id, stepId: wo.steps[0]!.id, toplar };
  };
  const kabul = (k: { woId: string; stepId: string }, returns: Array<{ rollId: string; receivedQty?: number }>, t: string) => () =>
    sub.receive({ workOrderId: k.woId, stepId: k.stepId, subcontractorId: boyaci, returns, newRolls: [{ qty: 290 }], clientToken: t }, undefined);
  {
    const k = await kur();
    const t = randomUUID();
    await kabul(k, [{ rollId: k.toplar[0]! }], t)();
    const tekrar = await kodu(kabul(k, [{ rollId: k.toplar[0]! }], t));
    check("⑥a aynı token + aynı gövde → replay", tekrar === "ok" && (await prisma.subcontractorReceipt.count({ where: { clientToken: t } })) === 1, tekrar);
    check("⑥b ⭐ aynı token + BAŞKA top → 409 CLIENT_TOKEN_COLLISION (eskiden eski makbuz 'kabul zaten yapılmış' dönerdi)",
      (await kodu(kabul(k, [{ rollId: k.toplar[1]! }], t))) === "CLIENT_TOKEN_COLLISION");
  }
  {
    const k = await kur();
    const t = randomUUID();
    await kabul(k, [{ rollId: k.toplar[0]!, receivedQty: 100 }], t)();
    check("⑥c aynı token + BAŞKA metraj (kısmi 100 → 120) → 409 CLIENT_TOKEN_COLLISION",
      (await kodu(kabul(k, [{ rollId: k.toplar[0]!, receivedQty: 120 }], t))) === "CLIENT_TOKEN_COLLISION");
  }
}

async function hareketliBordro(): Promise<void> {
  console.log("§7 Hareketli teslim bordrosu (K3 bayrağı açık)");
  for (const key of ["finance.enabled", "finance.chequeNoteMovementEnabled"]) {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
  }
  const musteri = await prisma.customer.create({ data: { code: `${TAG}-BM`, name: `${TAG} bordro müşteri` }, select: { id: true } });
  olusan.customerIds.push(musteri.id);
  const cari = await prisma.cariAccount.create({ data: { kind: CariKind.CUSTOMER, customerId: musteri.id }, select: { id: true } });
  olusan.bordroCariIds.push(cari.id);
  const banka = await prisma.bankAccount.create({ data: { code: `${TAG}-BB`, name: `${TAG} bordro banka`, currency: Currency.TRY }, select: { id: true } });
  olusan.bankIds.push(banka.id);
  const gun = 864e5;
  const cek = await prisma.cheque.create({
    data: {
      docNo: `${TAG}-C1`, kind: ChequeKind.RECEIVED, docType: ChequeDocType.CHEQUE, status: ChequeStatus.PORTFOLIO, cariId: cari.id,
      currency: Currency.TRY, exchangeRate: 1, amount: 500, amountTry: 500,
      issueDate: new Date(Date.now() - 3 * gun), postingDate: new Date(Date.now() - 3 * gun), dueDate: new Date(Date.now() + 20 * gun), drawerName: `${TAG} Keşideci`,
    },
    select: { id: true },
  });
  olusan.chequeIds.push(cek.id);
  const t = randomUUID();
  const kes = () => chequeDeliveryNoteService.create({ chequeIds: [cek.id], bankAccountId: banka.id, clientToken: t }, undefined, { canMoveCheques: true });
  // B token kilidini alıp seçim okumasında bekler; A aynı token'la aynı bordroyu keser.
  const s = await zorlanmisSira({ model: "cheque", metod: "findMany" }, kes, kes);
  zorlandi("⑦a hareketli bordro", s);
  const ids = s.sonuclar.map((r) => (r.status === "fulfilled" ? (r.value as { data: { id: string } }).data.id : null));
  const depozit = await prisma.chequeEvent.count({ where: { chequeId: cek.id, type: ChequeEventType.DEPOSIT } });
  check("⑦a ⭐ hareketli bordro, aynı token eşzamanlı: ikisi de başarılı, AYNI bordro, çek TEK kez hareket etti (replay geçişi yeniden koşmaz)",
    !!ids[0] && ids[0] === ids[1] && (await prisma.chequeDeliveryNote.count({ where: { clientToken: t } })) === 1 && depozit === 1, `${ozet(s)} · DEPOSIT=${depozit}`);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n❌ ${engel}\n`);
    fail++;
    return;
  }
  console.log("=== Token replay — zorlanmış sıra (D1) ===\n");
  foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
  await setFlag(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);
  await setFlag(SETTING_KEYS.IPLIK_ENABLED, false);
  await setFlag(SETTING_KEYS.DOKUMA_ENABLED, false);
  await levent();
  await hizliSiparis();
  await elleNumara();
  await kesim();
  await kasa();
  await fasonKabul();
  await hareketliBordro();
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
  if (olusan.cutParentIds.length) {
    await adim("kesim çocukları", async () => {
      await prisma.rollVariance.deleteMany({ where: { roll: { parentRollId: { in: olusan.cutParentIds } } } });
      await prisma.rollOperation.deleteMany({ where: { roll: { parentRollId: { in: olusan.cutParentIds } } } });
      await prisma.roll.deleteMany({ where: { parentRollId: { in: olusan.cutParentIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: olusan.cutParentIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: olusan.cutParentIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: olusan.cutParentIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: olusan.cutParentIds } } });
    });
  }
  if (olusan.colorId) await adim("renk", () => prisma.color.deleteMany({ where: { id: olusan.colorId! } }));
  if (olusan.woIds.length) {
    const wo = { in: olusan.woIds };
    const receipts = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: wo }, select: { id: true } })).map((r) => r.id);
    const dispatches = (await prisma.subcontractorDispatch.findMany({ where: { workOrderId: wo }, select: { id: true } })).map((d) => d.id);
    const woRolls = (await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: olusan.stepIds } }, { producedInStepId: { in: olusan.stepIds } }, { parentReceipt: { workOrderId: wo } }, { id: { in: olusan.rollIds } }] }, select: { id: true } })).map((r) => r.id);
    await adim("kabul kalemleri", () => prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receipts } } }));
    await adim("kabul özellikleri", () => prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receipts } } }));
    await adim("sevk kalemleri", () => prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatches } } }));
    await adim("fason top izleri", async () => {
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: woRolls } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: woRolls } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: woRolls } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: woRolls } } });
    });
    await adim("fason toplar", () => prisma.roll.deleteMany({ where: { id: { in: woRolls } } }));
    await adim("kabuller", () => prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receipts } } }));
    await adim("sevkler", () => prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatches } } }));
    await adim("refakat kartları", () => prisma.travelerCard.deleteMany({ where: { workOrderId: wo } }));
    await adim("partiler", () => prisma.batch.deleteMany({ where: { workOrderId: wo } }));
    await adim("adımlar", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: wo } }));
    await adim("iş emirleri", () => prisma.workOrder.deleteMany({ where: { id: wo } }));
  }
  if (olusan.chequeIds.length) {
    const notlar = [...new Set((await prisma.chequeDeliveryNoteItem.findMany({ where: { chequeId: { in: olusan.chequeIds } }, select: { noteId: true } })).map((n) => n.noteId))];
    await adim("çek olayları", () => prisma.chequeEvent.deleteMany({ where: { chequeId: { in: olusan.chequeIds } } }));
    await adim("çek cari satırları", async () => {
      await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: olusan.chequeIds }, reversesTxnId: { not: null } } });
      await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: olusan.chequeIds } } });
    });
    await adim("bordro kalemleri", () => prisma.chequeDeliveryNoteItem.deleteMany({ where: { noteId: { in: notlar } } }));
    await adim("bordrolar", () => prisma.chequeDeliveryNote.deleteMany({ where: { id: { in: notlar } } }));
    await adim("bordro belgeleri", () => prisma.printedDocument.deleteMany({ where: { sourceId: { in: notlar } } }));
    await adim("çekler", () => prisma.cheque.deleteMany({ where: { id: { in: olusan.chequeIds } } }));
  }
  if (olusan.bordroCariIds.length) {
    await adim("bordro cari bakiye", () => prisma.cariBalance.deleteMany({ where: { cariId: { in: olusan.bordroCariIds } } }));
    await adim("bordro cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: olusan.bordroCariIds } } }));
  }
  if (olusan.boxIds.length || olusan.bankIds.length) {
    await adim("kasa hareketleri", () => prisma.cashTransaction.deleteMany({ where: { OR: [{ cashBoxId: { in: olusan.boxIds } }, { bankAccountId: { in: olusan.bankIds } }] } }));
    await adim("kasalar", () => prisma.cashBox.deleteMany({ where: { id: { in: olusan.boxIds } } }));
    await adim("bankalar", () => prisma.bankAccount.deleteMany({ where: { id: { in: olusan.bankIds } } }));
  }
  if (olusan.customerIds.length) {
    const orders = (await prisma.order.findMany({ where: { customerId: { in: olusan.customerIds } }, select: { id: true } })).map((o) => o.id);
    await adim("sipariş satırları", () => prisma.orderLine.deleteMany({ where: { orderId: { in: orders } } }));
    await adim("siparişler", () => prisma.order.deleteMany({ where: { id: { in: orders } } }));
  }
  if (olusan.rollIds.length) await adim("toplar", () => prisma.roll.deleteMany({ where: { id: { in: olusan.rollIds } } }));
  if (olusan.beamIds.length) {
    await adim("iplik hareketleri", () => prisma.yarnMovement.deleteMany({ where: { warpBeamId: { in: olusan.beamIds } } }));
    await adim("levent olayları", () => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: olusan.beamIds } } }));
    await adim("leventler", () => prisma.warpBeam.deleteMany({ where: { id: { in: olusan.beamIds } } }));
  }
  if (olusan.specId) await adim("çözgü kartı", () => prisma.warpSpec.deleteMany({ where: { id: olusan.specId! } }));
  if (olusan.subId) await adim("fasoncu", () => prisma.subcontractor.deleteMany({ where: { id: olusan.subId! } }));
  const itemIds = [olusan.yarnId, olusan.itemId].filter((x): x is string => !!x);
  if (itemIds.length) await adim("kartlar", () => prisma.item.deleteMany({ where: { id: { in: itemIds } } }));
  if (olusan.customerIds.length) await adim("müşteriler", () => prisma.customer.deleteMany({ where: { id: { in: olusan.customerIds } } }));
  if (foto) {
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      await adim(`bayrak ${key}`, () =>
        eski
          ? prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } })
          : prisma.systemSetting.deleteMany({ where: { key } }),
      );
    }
  }
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
