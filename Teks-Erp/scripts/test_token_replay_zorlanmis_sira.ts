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
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döndürülür.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, RollStatus, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SIRA_ZORLANDI, sonucKodu, zorlanmisSira, type ZorlanmisSiraSonucu } from "./lib/zorlanmis-sira";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam, getWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { cancelConsumed, consumeBeam } from "../src/services/warp-beam-consume.service";
import { orderService } from "../src/routes/order.routes";

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
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });

const olusan = {
  beamIds: [] as string[],
  specId: null as string | null,
  yarnId: null as string | null,
  subId: null as string | null,
  itemId: null as string | null,
  customerIds: [] as string[],
  rollIds: [] as string[],
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
