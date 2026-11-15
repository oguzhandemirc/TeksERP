// =============================================================================
// Bildirim S6b — cari terimleri · renk/reçete kancaları · mesai dışı giriş (2026-11-15)
// =============================================================================
//   §F cari.degisti finans terimleri: gerçek `CustomerService.updateFinanceTerms` → tek satır, metinde alan ADLARI
//      (Vade günü · Risk limiti), değer yok; değişiklik yoksa satır yok; kartsız (eski fason) carisi yaymaz.
//   §B BaseService doğuş kancası: tanımlayan serviste INSERT + kanca tek tx, kancasız/`notify:false` yolda tx yok.
//   §R anaveri.renk-olusturuldu: gerçek `colorService.create` → satır; `notify:false` (içe aktarma) → yok; kanca
//      fırlatınca renk de yazılmaz (aynı tx).
//   §T anaveri.recete-degisti: gerçek `productRecipeService.update` → alan adları; aynı özellik kümesi → satır yok
//      (sahte değişim yok); özellik değişimi "Özellikler"; `notify:false` → yok.
//   §M kimlik.mesai-disi-giris: saf karar (vardiya var/yok, gece aşan aralık, eşit uç) + gerçek `noteOffHoursLogin`
//      (web/panel/patron yayar, tablet yaymaz, yükte IP yok).
// NEGATİF SONDA: bölüm başlıklarında.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { CustomerService } from "../src/services/customer.service";
import { ColorService } from "../src/services/color.service";
import type { CreateTxContext } from "../src/services/base.service";
import { colorService } from "../src/routes/color.routes";
import { productRecipeService } from "../src/routes/product-recipe.routes";
import { cariService } from "../src/services/cari.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { isOutsideWorkHours, noteOffHoursLogin, overrideOffHoursShiftFacts } from "../src/services/notification-sources/kimlik";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}
const ek = Date.now().toString(36);
const outbox = (kind: string, subjectId: string) => prisma.notificationOutbox.findMany({ where: { kind, subjectId }, select: { payload: true } });
const yuk = (r: Array<{ payload: unknown }>, i = 0) => (r[i]?.payload ?? {}) as Record<string, unknown>;
class Patlat extends Error {}

// ── §F ──────────────────────────────────────────────────────────────────────
// NEGATİF SONDA (2026-11-15): cariService.update'ten `emitCariTermsChangedTx` silindi → §Fa/§Fc ❌; terim etiketi yerine
//   değer yazıldı (`String(after[k])`) → §Fa/§Fb ❌. İkisi de geri alındı.
async function bolumF(): Promise<void> {
  console.log("\n§F cari.degisti — finans terimleri (gerçek updateFinanceTerms)");
  const svc = new CustomerService({ modelName: "customer", tableName: "CUSTOMER", searchFields: ["name"], uniqueField: "code", nestedCreateFields: ["branches"] });
  const cust = await prisma.customer.create({ data: { code: `TEST-S6B-${ek}`, name: `TEST-S6B Müşteri ${ek}` }, select: { id: true } });
  try {
    await svc.updateFinanceTerms(cust.id, { paymentTermDays: 45, riskLimit: "125000" });
    const r1 = await outbox("cari.degisti", cust.id);
    const p = yuk(r1);
    check("§Fa ⭐ terim yazımı tek cari.degisti satırı, metinde \"Vade günü\" + \"Risk limiti\"", r1.length === 1 && String(p.alanlar).includes("Vade günü") && String(p.alanlar).includes("Risk limiti"), JSON.stringify(p));
    check("§Fb yükte değer/tutar yok (45 · 125000)", !/125000|\b45\b/.test(JSON.stringify(p)));
    await svc.updateFinanceTerms(cust.id, { paymentTermDays: 45, riskLimit: "125000.00" });
    check("§Fc aynı değerler → yeni satır yok", (await outbox("cari.degisti", cust.id)).length === 1);
    const sub = await ensureTestSubcontractor(TEST_KARTELA);
    const kart = await prisma.subcontractor.findUnique({ where: { id: sub.id }, select: { customerId: true } });
    const acc = await prisma.$transaction((tx) => ensureCariAccountTx(tx, kart?.customerId ? { customerId: kart.customerId } : { subcontractorId: sub.id }));
    const once = await prisma.cariAccount.findUnique({ where: { id: acc.id }, select: { paymentTermDays: true } });
    const sayac = () => prisma.notificationOutbox.count({ where: { kind: "cari.degisti", ...(kart?.customerId ? { subjectId: kart.customerId } : {}) } });
    const s0 = await sayac();
    await cariService.update(acc.id, { paymentTermDays: (once?.paymentTermDays ?? 0) + 7 });
    const s1 = await sayac();
    await cariService.update(acc.id, { paymentTermDays: once?.paymentTermDays ?? null });
    check(kart?.customerId ? "§Fd fason profilinin carisi kartına yayar" : "§Fd kartsız (eski fason) carisi yaymaz, hata vermez",
      kart?.customerId ? s1 - s0 === 1 : s1 === s0, `${s0} → ${s1}`);
    if (kart?.customerId) await prisma.notificationOutbox.deleteMany({ where: { kind: "cari.degisti", subjectId: kart.customerId } });
  } finally {
    await prisma.notificationOutbox.deleteMany({ where: { kind: "cari.degisti", subjectId: cust.id } });
    await cleanupTestCustomers([cust.id]);
  }
}

// ── §B + §R ─────────────────────────────────────────────────────────────────
// NEGATİF SONDA (2026-11-15): performInsert'te kanca tx DIŞINDA (commit sonrası) çağrıldı → §Rc ❌ (renk kaldı; ilk
//   sonda ad büyük harfe çevrildiği için sayımı ıskaladı → damga rakama alındı); ColorService'ten `afterCreateTx`
//   silindi → §Ra ❌; `notify:false` dalı kaldırıldı → §Ba/§Rb ❌. Üçü de geri alındı.
class PatlayanRenkServisi extends ColorService {
  protected override async afterCreateTx(tx: Prisma.TransactionClient, c: CreateTxContext): Promise<void> {
    await super.afterCreateTx(tx, c);
    throw new Patlat();
  }
}
async function bolumBR(): Promise<string[]> {
  console.log("\n§B BaseService doğuş kancası · §R anaveri.renk-olusturuldu");
  const base = readFileSync(join(__dirname, "..", "src", "services", "base.service.ts"), "utf8");
  check("§Ba kancasız/`notify:false` yolda tx açılmaz (iki kanca da `hook ? $transaction : delegate`)",
    (base.match(/(hookOpts\?|opts)\.notify === false \? undefined : this\.after(Create|Update)Tx\?\.bind\(this\)/g) ?? []).length === 2
      && /: await insert\(this\.delegate\)/.test(base) && /: await write\(this\.delegate\)/.test(base));
  const ids: string[] = [];
  const r1 = await colorService.create({ name: `TEST S6B ${ek} A` });
  const c1 = (r1.data as { id: string }).id;
  ids.push(c1);
  const p = yuk(await outbox("anaveri.renk-olusturuldu", c1));
  check("§Ra ⭐ renk doğuşu tek satır (ad + kod)", p.renkId === c1 && typeof p.renkAd === "string" && String(p.renkAd).includes("S6B") && typeof p.renkKodu === "string", JSON.stringify(p));
  const r2 = await colorService.create({ name: `TEST S6B ${ek} B` }, undefined, { notify: false });
  ids.push((r2.data as { id: string }).id);
  check("§Rb `notify:false` (toplu içe aktarma) satır yazmaz", (await outbox("anaveri.renk-olusturuldu", ids[1]!)).length === 0);
  const pat = new PatlayanRenkServisi({ modelName: "color", tableName: "COLOR", searchFields: ["name"], uniqueField: "code", autoCode: { series: "color" } });
  // Ad büyük harfe ve rakam-önce biçime çevrilir (normalizeColorName) → sayım yalnız rakam damgasıyla.
  const damga = String(Date.now()).slice(-9);
  const patladi = await pat.create({ name: `TEST S6B ${damga} C` }).then(() => false, (e: unknown) => e instanceof Patlat);
  const kaldi = await prisma.color.count({ where: { name: { contains: damga } } });
  check("§Rc ⭐ kanca fırlatınca renk ve outbox birlikte geri sarılır (aynı tx)", patladi && kaldi === 0, `${patladi}/${kaldi}`);
  return ids;
}

// ── §T ──────────────────────────────────────────────────────────────────────
// NEGATİF SONDA (2026-11-15): özellik kümesi karşılaştırması kaldırıldı (her kayıtta yeniden yazım) → §Tb ❌;
//   ProductRecipeService'ten `afterUpdateTx` silindi → §Ta/§Tc ❌. İkisi de geri alındı.
async function bolumT(): Promise<void> {
  console.log("\n§T anaveri.recete-degisti — gerçek productRecipeService.update");
  const item = await prisma.item.create({ data: { code: `TEST-S6B-${ek}`, name: `TEST-S6B Kumaş ${ek}`, itemType: "FABRIC" }, select: { id: true } });
  const prop = await prisma.fabricProperty.create({ data: { code: `TS6B-${ek}`.slice(0, 32), name: `TEST-S6B Özellik ${ek}` }, select: { id: true } });
  let recipeId = "";
  try {
    const rr = await productRecipeService.create({ name: `TEST-S6B Reçete ${ek}`, itemId: item.id, properties: [] });
    recipeId = (rr.data as { id: string }).id;
    const say = async () => (await outbox("anaveri.recete-degisti", recipeId)).length;
    await productRecipeService.update(recipeId, { name: `TEST-S6B Reçete ${ek} 2`, properties: [] });
    const r1 = await outbox("anaveri.recete-degisti", recipeId);
    check("§Ta ⭐ ad değişimi tek satır, metinde \"Ad\", özellik (aynı boş küme) yok", r1.length === 1 && String(yuk(r1).alanlar) === "Ad", JSON.stringify(yuk(r1)));
    await productRecipeService.update(recipeId, { name: `TEST-S6B Reçete ${ek} 2`, properties: [] });
    check("§Tb ⭐ form aynı kümeyi yeniden yollayınca satır yok (sahte değişim yok)", (await say()) === 1);
    await productRecipeService.update(recipeId, { properties: [{ propertyId: prop.id }] });
    const r3 = await outbox("anaveri.recete-degisti", recipeId);
    check("§Tc özellik kümesi değişince \"Özellikler\"", r3.length === 2 && r3.some((r) => String((r.payload as Record<string, unknown>).alanlar) === "Özellikler"), JSON.stringify(r3.map((r) => r.payload)));
    await productRecipeService.update(recipeId, { name: `TEST-S6B Reçete ${ek} 3` }, undefined, { notify: false });
    check("§Td `notify:false` (toplu içe aktarma) satır yazmaz", (await say()) === 2);
  } finally {
    if (recipeId) {
      await prisma.notificationOutbox.deleteMany({ where: { kind: "anaveri.recete-degisti", subjectId: recipeId } });
      await prisma.productRecipe.delete({ where: { id: recipeId } });
    }
    await prisma.fabricProperty.delete({ where: { id: prop.id } });
    await prisma.item.delete({ where: { id: item.id } });
  }
}

// ── §M ──────────────────────────────────────────────────────────────────────
// NEGATİF SONDA (2026-11-15): kararda vardiya dalı kaldırıldı (hep saat aralığı) → §Ma ❌; kanal sözlüğüne `mobile`
//   eklendi → §Mc ❌. İkisi de geri alındı.
async function bolumM(): Promise<void> {
  console.log("\n§M kimlik.mesai-disi-giris");
  const t = (iso: string) => new Date(iso);
  const k = (at: string, o: Partial<{ shiftDefined: boolean; inShift: boolean; startHour: number; endHour: number }> = {}) =>
    isOutsideWorkHours({ at: t(at), shiftDefined: false, inShift: false, startHour: 7, endHour: 19, ...o }).outside;
  check("§Ma ⭐ vardiya tanımlıysa vardiya esas: süren vardiya var → içeride (gece 03:00 olsa da), yok → dışarıda (öğlen olsa da)",
    !k("2031-01-08T00:00:00Z", { shiftDefined: true, inShift: true }) && k("2031-01-08T09:00:00Z", { shiftDefined: true, inShift: false }));
  check("§Mb vardiya yoksa fabrika saati 07:00–19:00: 08:00 içeride, 20:30 dışarıda, 06:59 dışarıda",
    !k("2031-01-08T05:00:00Z") && k("2031-01-08T17:30:00Z") && k("2031-01-08T03:59:00Z"));
  check("§Mb2 gece aşan aralık (22–6): 02:00 içeride, 20:30 dışarıda; eşit uç = mesai tanımsız → asla",
    !k("2031-01-07T23:00:00Z", { startHour: 22, endHour: 6 }) && k("2031-01-08T17:30:00Z", { startHour: 22, endHour: 6 }) && !k("2031-01-08T23:00:00Z", { startHour: 8, endHour: 8 }));
  const user = await prisma.user.create({ data: { username: `test-s6b-${ek}`, fullName: `TEST S6B Kişi ${ek}`, passwordHash: "x" }, select: { id: true } });
  const geri = overrideOffHoursShiftFacts(async () => ({ shiftDefined: false, currentShift: null }));
  try {
    const gece = t("2031-01-08T23:30:00Z");
    const tablet = await noteOffHoursLogin({ userId: user.id, displayName: "TEST", clientType: "mobile", at: gece });
    const ogle = await noteOffHoursLogin({ userId: user.id, displayName: "TEST", clientType: "web", at: t("2031-01-08T09:00:00Z") });
    const sayi0 = (await outbox("kimlik.mesai-disi-giris", user.id)).length;
    check("§Mc ⭐ tablet girişi ve mesai içi web girişi yaymaz", !tablet && !ogle && sayi0 === 0, `${tablet}/${ogle}/${sayi0}`);
    const yazdi = [await noteOffHoursLogin({ userId: user.id, displayName: "TEST S6B Kişi", clientType: "electron", at: gece }),
      await noteOffHoursLogin({ userId: user.id, displayName: "TEST S6B Kişi", clientType: "patron", at: gece })];
    const r = await outbox("kimlik.mesai-disi-giris", user.id);
    const p = yuk(r);
    check("§Md ⭐ panel + patron gece girişi yayar; yükte ad + kanal + saat + mesai", yazdi.every(Boolean) && r.length === 2 && p.kullanici === "TEST S6B Kişi" && /Yönetim paneli|Patron uygulaması/.test(String(p.kanal)) && String(p.mesai).includes("07:00–19:00"), JSON.stringify(p));
    check("§Me yükte IP/tarayıcı/sır yok", r.every((x) => !/ip|tarayici|token|parola/i.test(Object.keys(x.payload as object).join(","))));
  } finally {
    geri();
    await prisma.notificationOutbox.deleteMany({ where: { kind: "kimlik.mesai-disi-giris", subjectId: user.id } });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  }
}

async function main(): Promise<void> {
  console.log("=== Bildirim S6b ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key } });
  let renkler: string[] = [];
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    await bolumF();
    renkler = await bolumBR();
    await bolumT();
    await bolumM();
  } finally {
    await prisma.notificationOutbox.deleteMany({ where: { kind: "anaveri.renk-olusturuldu", subjectId: { in: renkler } } });
    await prisma.color.deleteMany({ where: { id: { in: renkler } } });
    if (ilk) await prisma.systemSetting.update({ where: { key }, data: { value: (ilk.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
