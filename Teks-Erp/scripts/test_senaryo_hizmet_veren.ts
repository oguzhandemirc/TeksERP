// =============================================================================
// SENARYO — HİZMET VEREN UÇTAN UCA (Gülkesim · DALGA2-HIZMET-TASARIM §3, S1)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_senaryo_hizmet_veren.ts
//
// NEDEN: dalga bekçileri her halkayı servis çağrısıyla AYRI ölçer; halkaların
// GERÇEK HTTP uçlarıyla birbirine eklendiği yer (gelen belge satırı → beyan IN →
// sapma → tambur çocuğu → sevk → hizmet bağı → dönem sonu) hiçbir bekçide yoktu.
// Kurulum (ana veri: kalem, istasyon, eşleme) Prisma ile; akışın HER adımı HTTP.
//
// ADIMLAR (her biri sayısal iddiayla):
//   0 Kurulum: `hizmet` profili (modül farkı /api/admin/module-profile → PATCH) + ayar paketi
//   1 Müşteri + gramaj hizmet fiyatı (müşteriye özel) + gramaj/Tambur → hizmet kalemi eşlemesi
//   2 Gelen belge: elle 3 satır (biri "KURŞUN 50 GR"), ürünsüz satır müşteri varsayılanıyla → 3 emanet top
//   3 Kurşun: İE + H9b önerisi → hedef gramaj; OUT elle; eşik dışı sapma OFFICE onayıyla
//   4 Tambur: bir top bölünür → çocuklar sahibi korur; istasyonun AUTO bayrağı çocuğa yazılır,
//     TAMBUR satırı kesilen metreyle (CUT, her çocuk kendi parçası — T1)
//   5 Sevk + hizmet faturası (PER_SHIPMENT): bağ sayısı, billedMeters = OUT, birim fiyat, toplam
//   6 Dönem sonu (PERIOD_END): önizleme + oluşturma; ikinci kez faturalanmaz
//   7 Ters yol: faturalı sevk geri alma 409 SERVICE_ALREADY_BILLED; taslak iptali sonrası 200
// Negatif sondalar: bkz. BEKCI-HARITASI satırı.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Currency, ItemType, Prisma, PriceKind } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { MODULE_FIELD_BY_SETTING_KEY } from "../src/constants/module-profiles";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { factoryYmd } from "../src/constants/time";
import { paketPlani } from "./hizmet-ayar-paketi";
import { ensureTestAdmin } from "./fixture-test-user";
import { roleGrade } from "./fixture-quality-grade";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { testActorId } from "./fixture-test-user";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
let known = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
/** Bilinen bulgu: adım atlanır ama ÇIKTIDA görünür (sessiz geçiş yok). */
function bilinen(label: string, why: string): void { known++; console.log(`⚠️ BİLİNEN: ${label} — ${why}`); }
const T0 = Date.now();
let stepT = Date.now();
function adim(t: string): void {
  const now = Date.now();
  console.log(`\n── ${t} ── (önceki adım ${now - stepT} ms)`);
  stepT = now;
}
const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const eq = (a: Prisma.Decimal.Value | null | undefined, b: Prisma.Decimal.Value, tol = 0.001) => D(a).minus(b).abs().lte(tol);

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-SNHV-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], valueIds: [] as string[], stationIds: [] as string[],
  customerId: null as string | null, kursunCreated: null as string | null, woIds: [] as string[],
  noteIds: [] as string[], shipmentIds: [] as string[],
};
/** Ayar anlık görüntüsü: bütün tablo; finally'de aynen geri yazılır (profil + paket + sapma kipi). */
const priorSettings = new Map<string, unknown>();
// Kapı engel verirse anlık görüntü alınmaz; o zaman geri yükleme/temizlik HİÇ koşmaz (boş Map = her anahtarı silmek).
let snapshotTaken = false;

type Res = { status: number; body: { success?: boolean; data?: unknown; message?: string; error?: { details?: { code?: string } }; details?: { code?: string }; warnings?: string[] } };
let base = "";
let token = "";
async function api(method: string, path: string, body?: unknown): Promise<Res> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: Res["body"] = {};
  try { parsed = (await r.json()) as Res["body"]; } catch { /* boş gövde */ }
  return { status: r.status, body: parsed };
}
const codeOf = (r: Res): string | null => r.body.error?.details?.code ?? r.body.details?.code ?? null;
const short = (r: Res): string => `${r.status} ${codeOf(r) ?? ""} ${r.body.message ?? ""}${r.status >= 400 ? ` ${JSON.stringify(r.body).slice(0, 400)}` : ""}`.trim();
function must<T>(r: Res, label: string, okStatus = [200, 201]): T {
  if (!okStatus.includes(r.status)) throw new Error(`${label}: ${short(r)}`);
  return r.body.data as T;
}

async function main(): Promise<void> {
  console.log("=== Senaryo: hizmet veren uçtan uca (gelen belge → kurşun → tambur → sevk → hizmet faturası → dönem sonu) ===");
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) { check("hedef DB test DB'si", false, engel); return; }
  for (const s of await prisma.systemSetting.findMany({ select: { key: true, value: true } })) priorSettings.set(s.key, s.value);
  snapshotTaken = true;
  const server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await scenario();
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }
}

async function scenario(): Promise<void> {
  const cred = await ensureTestAdmin();
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: cred.username, password: cred.password }) });
  const lb = (await login.json()) as { data?: { token?: string } };
  token = lb.data?.token ?? "";
  check("giriş: test yöneticisi token aldı", login.status === 200 && token.length > 0, String(login.status));
  if (!token) return;

  // ── 0 KURULUM ────────────────────────────────────────────────────────────
  adim("0 Kurulum: hizmet profili + ayar paketi");
  const prof = must<{ diffs: Record<string, Array<{ key: string; to: boolean }>> }>(await api("GET", "/api/admin/module-profile"), "profil farkı");
  const patch: Record<string, boolean> = {};
  for (const d of prof.diffs.hizmet ?? []) {
    const field = MODULE_FIELD_BY_SETTING_KEY[d.key];
    if (field) patch[field] = d.to;
  }
  // Modül anahtarını HTTP'den yalnız sistem hesabı yazar (MODULE_FLAG_SUPERADMIN_ONLY); kurulumda
  // panelin göndereceği AYNI gövde servise verilir — fark sunucunun /module-profile yanıtından.
  if (Object.keys(patch).length > 0) await systemSettingService.setFeatureFlags(patch as never, await testActorId());
  const prof2 = must<{ diffs: Record<string, unknown[]>; current: { closest: string } }>(await api("GET", "/api/admin/module-profile"), "profil yeniden");
  check("hizmet profili uygulandı: fark 0, en yakın profil 'hizmet'", (prof2.diffs.hizmet ?? []).length === 0 && prof2.current.closest === "hizmet", `${Object.keys(patch).length} anahtar yazıldı; closest=${prof2.current.closest}`);

  // Ayar paketi KODDAN (`paketPlani`, betiğin kuru koşusuyla aynı plan): kodda olmayan anahtar
  // (ANAHTAR_YOK, ör. H1b) atlanır. Senaryo sapma onayını OFFICE'e çevirir (paket NONE der — onay
  // yolunu ölçmek için) ve PER_SHIPMENT'in önkoşulu otomatik taslağı açar (betik bunu yalnız uyarır).
  const ff0 = must<Record<string, unknown>>(await api("GET", "/api/feature-flags"), "bayrak oku");
  const plan = paketPlani(ff0, new Set<string>(Object.values(SETTING_KEYS)));
  const live = plan.filter((p) => p.durum !== "ANAHTAR_YOK");
  check("ayar paketi planı: ALAN_YOK yok (paket ↔ servis ayrışmamış)", plan.every((p) => p.durum !== "ALAN_YOK"), plan.map((p) => `${p.alan}:${p.durum}`).join(", "));
  console.log(`   ℹ️ paket: ${live.length} satır uygulanır, ${plan.length - live.length} ANAHTAR_YOK (${plan.filter((p) => p.durum === "ANAHTAR_YOK").map((p) => `${p.anahtar}→${p.dilim}`).join(", ")})`);
  const pkg: Record<string, unknown> = Object.fromEntries(live.map((s) => [s.alan, s.hedef]));
  must(await api("PATCH", "/api/feature-flags", { ...pkg, kursunMeterVarianceApproval: "OFFICE", financeAutoDraftFromShipmentEnabled: true, shipmentConfirmationEnabled: false }), "ayar paketi");
  const ff = must<Record<string, unknown>>(await api("GET", "/api/feature-flags"), "bayrak oku");
  const off = live.filter((s) => s.alan !== "kursunMeterVarianceApproval" && ff[s.alan] !== s.hedef);
  check(`ayar paketi: ${live.length - 1} satır hedefte + sapma onayı OFFICE`, off.length === 0 && ff.kursunMeterVarianceApproval === "OFFICE", off.map((s) => `${s.alan}=${String(ff[s.alan])}`).join(", "));

  // ── 1 MÜŞTERİ + FİYAT + EŞLEME ────────────────────────────────────────────
  adim("1 Müşteri, gramaj hizmet fiyatı, hizmet kalemi eşlemesi");
  const cust = must<{ id: string }>(await api("POST", "/api/customers", { code: `${P}-C`.slice(0, 32), name: `TEST SNHV müşteri ${STAMP}` }), "müşteri");
  fx.customerId = cust.id;
  const mkItem = async (suffix: string, itemType: ItemType): Promise<string> => {
    const it = await prisma.item.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST SNHV ${suffix} ${STAMP}`, itemType, unit: "MT" }, select: { id: true } });
    fx.itemIds.push(it.id);
    return it.id;
  };
  const FABRIC = await mkItem("KUM", ItemType.FABRIC);
  const K25 = await mkItem("K25", ItemType.SERVICE);
  const K50 = await mkItem("K50", ItemType.SERVICE);
  const KTB = await mkItem("TMB", ItemType.SERVICE);
  for (const [itemId, customerId, price] of [[K25, null, 6], [K50, null, 10], [K50, cust.id, 7.5], [KTB, null, 2]] as const) {
    must(await api("POST", "/api/item-prices", { itemId, customerId, kind: PriceKind.SALE, currency: Currency.TRY, price }), "fiyat");
  }
  const resolved = must<{ price?: string | number; source?: string } | null>(await api("GET", `/api/item-prices/resolve?itemId=${K50}&kind=SALE&currency=TRY&customerId=${cust.id}`), "fiyat çöz");
  check("H5: 50 gr hizmetinin müşteri fiyatı 7,5 (genel 10'un önünde)", eq(resolved?.price as Prisma.Decimal.Value, 7.5), JSON.stringify(resolved));

  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  const variant = await prisma.fabricProperty.create({ data: { code: `${P}-GR`.slice(0, 32), name: `TEST SNHV gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id }, select: { id: true } });
  fx.propIds.push(variant.id);
  const mkVal = async (gr: number, serviceItemId: string): Promise<{ id: string; code: string }> => {
    const v = await prisma.fabricPropertyValue.create({ data: { propertyId: variant.id, code: `${gr}GR${STAMP}`.slice(0, 32).toUpperCase(), name: `${gr} gr`, sortOrder: gr, serviceItemId }, select: { id: true, code: true } });
    fx.valueIds.push(v.id);
    return v;
  };
  await mkVal(25, K25);
  const V50 = await mkVal(50, K50);
  const tbFlag = await prisma.fabricProperty.create({ data: { code: `${P}-TB`.slice(0, 32), name: `TEST SNHV tambur ${STAMP}`, valueType: "FLAG", serviceItemId: KTB }, select: { id: true } });
  fx.propIds.push(tbFlag.id);
  const mkStation = async (suffix: string, kind: "PROCESS_QC" | "TAMBUR", props: Array<{ propertyId: string; mode: "AUTO" | "OPTIONAL" | "REQUIRED" }>): Promise<string> => {
    const s = await prisma.station.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST SNHV ${suffix} ${STAMP}`, type: "INTERNAL", kind, appliesProperty: true }, select: { id: true } });
    fx.stationIds.push(s.id);
    must(await api("PUT", `/api/station-capabilities/${s.id}`, { properties: props }), `istasyon yeteneği ${suffix}`);
    return s.id;
  };
  // Tambur işinin izi topun bayrağıdır: Tambur istasyonunun AUTO özelliği kesimle doğan
  // çocuğa yazılır (T1) — kurşun istasyonu bu bayrağı vermez, yani tek kaynak Tambur kesimi.
  const ST_K = await mkStation("K", "PROCESS_QC", [{ propertyId: kursun.id, mode: "AUTO" }, { propertyId: variant.id, mode: "REQUIRED" }]);
  const ST_T = await mkStation("T", "TAMBUR", [{ propertyId: tbFlag.id, mode: "AUTO" }]);
  const mapped = await prisma.fabricPropertyValue.count({ where: { propertyId: variant.id, serviceItemId: { not: null } } });
  check("H6: 2 gramaj kademesi + Tambur bayrağı hizmet kalemine eşli", mapped === 2, String(mapped));

  // ── 2 GELEN BELGE ─────────────────────────────────────────────────────────
  adim("2 Gelen belge: elle taslak, 3 satır, varsayılan ürün → onay → 3 emanet top");
  must(await api("PUT", `/api/gelen-belge/varsayilan-urunler/${cust.id}`, { defaultItemId: FABRIC }), "müşteri varsayılan ürünü");
  const DECL = [100, 120, 150] as const;
  const note = must<{ id: string; lines?: Array<{ id: string }> }>(await api("POST", "/api/gelen-belge/irsaliyeler", {
    clientToken: randomUUID(), sourceKind: "MANUAL", ownerCustomerId: cust.id, senderCustomerId: cust.id, senderDocNo: `${STAMP}-1`,
    lines: [
      { senderRollNo: "M-1", meters: DECL[0], processText: "KURŞUN 50 GR" },
      { senderRollNo: "M-2", meters: DECL[1], itemId: FABRIC },
      { senderRollNo: "M-3", meters: DECL[2] },
    ],
  }), "taslak");
  fx.noteIds.push(note.id);
  const appr = await api("POST", `/api/gelen-belge/irsaliyeler/${note.id}/onay`, {});
  check("onay 200 + varsayılan ürün uyarısı (müşteri varsayılanı)", appr.status === 200 && JSON.stringify(appr.body).includes("müşteri varsayılanı"), short(appr));
  const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: note.id }, orderBy: { lineNo: "asc" }, select: { status: true, rollId: true, meters: true } });
  const rollIds = lines.map((l) => l.rollId).filter((v): v is string => v !== null);
  const rolls = await prisma.roll.findMany({ where: { id: { in: rollIds } }, select: { id: true, barcode: true, status: true, ownerCustomerId: true, itemId: true, initialQty: true } });
  const byId = new Map(rolls.map((r) => [r.id, r]));
  check("3 satır ENTERED → 3 top", lines.length === 3 && lines.every((l) => l.status === "ENTERED") && rolls.length === 3, lines.map((l) => l.status).join(","));
  check("3 top emanet: ownerCustomerId = müşteri, STOCK, ürün = kumaş", rolls.every((r) => r.ownerCustomerId === cust.id && r.status === "STOCK" && r.itemId === FABRIC), JSON.stringify(rolls.map((r) => [r.status, r.ownerCustomerId === cust.id])));
  check("top metreleri belge satırıyla aynı (100/120/150)", rollIds.every((id, i) => eq(byId.get(id)!.initialQty, DECL[i]!)));
  const [RA, RB, RC] = rollIds as [string, string, string];

  // ── 3 KURŞUN ──────────────────────────────────────────────────────────────
  adim("3 Kurşun: İE, H9b gramaj önerisi, OUT okuması, eşik dışı sapma OFFICE onayı");
  const wo = must<{ workOrder?: { id: string }; id?: string }>(await api("POST", "/api/work-orders/quick-start", {
    clientToken: randomUUID(), type: "STOCK_PRODUCTION", targetItemId: FABRIC,
    rollBarcodes: rollIds.map((id) => byId.get(id)!.barcode),
    steps: [{ stationId: ST_K }, { stationId: ST_T }],
  }), "hızlı İE");
  const woId = wo.workOrder?.id ?? wo.id!;
  fx.woIds.push(woId);
  const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: woId }, orderBy: { stepSequence: "asc" }, select: { id: true } });
  const [SK, STB] = steps.map((s) => s.id) as [string, string];
  check("İE 2 adım (kurşun → tambur), 3 top bağlı", steps.length === 2 && (await prisma.roll.count({ where: { id: { in: rollIds }, currentStepId: SK } })) === 3);
  const ps = must<{ deliveryNoteGramaj?: { suggested: unknown; coveredRollCount: number; entries: Array<{ valueId: string | null; rollCount: number }> } | null }>(await api("GET", `/api/work-orders/${woId}/process-summary`), "süreç özeti");
  const g = ps.deliveryNoteGramaj;
  const e50 = g?.entries.find((e) => e.valueId === V50.id);
  check("H9b: 3 top kapsanır; '50 gr' önerisi 1 topta, ötekiler metinsiz → tek öneri yok", !!g && g.coveredRollCount === 3 && e50?.rollCount === 1 && g.suggested === null, JSON.stringify(g));
  must(await api("PUT", `/api/work-orders/${woId}/target-values`, { items: [{ propertyId: variant.id, valueId: V50.id }] }), "hedef gramaj");
  const tv = await prisma.workOrderTargetValue.count({ where: { workOrderId: woId, valueId: V50.id } });
  check("hedef gramaj İE'ye yazıldı (öneriden)", tv === 1, String(tv));

  const OUT = new Map<string, number>([[RA, 99.5], [RB, 119.2], [RC, 140]]); // RC: 10 m / %6,7 sapma
  for (const id of rollIds) {
    const r = await api("POST", "/api/kursun-qc/complete-qc2", {
      rollId: id, stepId: SK, properties: [{ propertyId: variant.id, valueCode: V50.code }],
      meterOut: { meters: OUT.get(id), source: "OPERATOR", clientToken: randomUUID() },
    });
    check(`KK2 + OUT ${OUT.get(id)} m (beyan ${byId.get(id)!.initialQty.toString()})`, r.status === 201, short(r));
  }
  const reads = await prisma.rollMeterReading.findMany({ where: { rollId: { in: rollIds }, workOrderStepId: SK, phase: "OUT", revokedAt: null }, select: { rollId: true, meters: true, source: true } });
  check("3 aktif OUT okuması, hiçbiri SIMULATED, değerler girilenle aynı", reads.length === 3 && reads.every((x) => x.source !== "SIMULATED" && eq(x.meters, OUT.get(x.rollId)!)), JSON.stringify(reads.map((x) => x.meters.toString())));
  const fin1 = await api("POST", "/api/kursun-qc/finish-step", { stepId: SK });
  check("eşik dışı sapma onaysızken adım kapanmaz (409)", fin1.status === 409, short(fin1));
  const devItems = must<Array<{ readingId: string; rollId: string }>>(await api("GET", `/api/kursun-qc/meter-deviations?filter[status]=PENDING&filter[customerId]=${cust.id}`), "sapma listesi");
  const mine = devItems.filter((d) => rollIds.includes(d.rollId));
  check("ofis listesinde (müşteri süzgeci sunucuda) YALNIZ eşik dışı top bekliyor (RC)", devItems.length === 1 && mine.length === 1 && mine[0]!.rollId === RC, JSON.stringify(devItems.map((d) => d.rollId === RC)));
  if (mine[0]) {
    const ack = await api("POST", `/api/kursun-qc/meter-readings/${mine[0].readingId}/office-ack`, { reasonText: "Müşteri metresi fazla yazmış, ölçüm doğru" });
    check("ofis onayı 201 (RollMeterAck)", ack.status === 201, short(ack));
  }
  const fin2 = await api("POST", "/api/kursun-qc/finish-step", { stepId: SK });
  check("onaydan sonra kurşun adımı kapanır; 3 top tambura geçer", fin2.status === 200 && (await prisma.roll.count({ where: { id: { in: rollIds }, currentStepId: STB } })) === 3, short(fin2));
  const gramOps = await prisma.rollOperation.count({ where: { rollId: { in: rollIds }, operationType: "KURSUN_APPLIED", propertyValueId: V50.id, revokedAt: null } });
  check("3 topta KURSUN_APPLIED = 50 gr", gramOps === 3, String(gramOps));

  // ── 4 TAMBUR ──────────────────────────────────────────────────────────────
  adim("4 Tambur: RA bölünür (60 + kalan), RB/RC tek parça; çocuklar sahibi korur");
  const grade = await roleGrade("FIRST");
  const finalize = (rollId: string, cuts: number[]) => api("POST", "/api/tambur/finalize", { rollId, decisions: [], cuts: cuts.map((length) => ({ length, qualityGrade: grade.code, relatedErrorIds: [] })) });
  const fA = await finalize(RA, [60]);
  const fB = await finalize(RB, [120]);
  const fC = await finalize(RC, [150]);
  check("3 tambur kararı 200", [fA, fB, fC].every((r) => r.status === 200), [fA, fB, fC].map(short).join(" | "));
  const kids = await prisma.roll.findMany({ where: { parentRollId: { in: rollIds } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, parentRollId: true, ownerCustomerId: true, currentQty: true, status: true } });
  const kidsA = kids.filter((k) => k.parentRollId === RA);
  check("RA → 2 çocuk (60 + 40), RB/RC → birer çocuk", kidsA.length === 2 && kids.length === 4 && kidsA.some((k) => eq(k.currentQty, 60)) && kidsA.some((k) => eq(k.currentQty, 40)), kids.map((k) => k.currentQty.toString()).join(","));
  check("H10: 4 çocuğun hepsi müşterinin emaneti (ownerCustomerId kalıttı)", kids.length === 4 && kids.every((k) => k.ownerCustomerId === cust.id), JSON.stringify(kids.map((k) => k.ownerCustomerId === cust.id)));
  check("çocuklar depoda (WAREHOUSE)", kids.every((k) => k.status === "WAREHOUSE"), kids.map((k) => k.status).join(","));
  const tbOnKids = await prisma.rollProperty.count({ where: { rollId: { in: kids.map((k) => k.id) }, propertyId: tbFlag.id, revokedAt: null } });
  const tbOnParents = await prisma.rollProperty.count({ where: { rollId: { in: rollIds }, propertyId: tbFlag.id, revokedAt: null } });
  check("T1: Tambur istasyonunun AUTO bayrağı 4 çocuğa yazıldı; atalarda yok (iş çocukta)", tbOnKids === 4 && tbOnParents === 0, `çocuk ${tbOnKids}, ata ${tbOnParents}`);

  // ── 5 SEVK + HİZMET FATURASI (PER_SHIPMENT) ───────────────────────────────
  adim("5 Sevk (brüt) → hizmet fatura taslağı: RA'nın iki çocuğu + RB'nin çocuğu");
  const shipKids = kids.filter((k) => k.parentRollId === RA || k.parentRollId === RB);
  const sh1 = must<{ id: string; dispatched?: boolean }>(await api("POST", "/api/shipping/shipments/from-rolls", { rollIds: shipKids.map((k) => k.id), customerId: cust.id, orderless: true, clientToken: randomUUID() }), "sevk 1");
  fx.shipmentIds.push(sh1.id);
  const sh1Row = await prisma.shipment.findUniqueOrThrow({ where: { id: sh1.id }, select: { status: true } });
  check("sevk DISPATCHED (onay kapalı)", sh1Row.status === "DISPATCHED", sh1Row.status);
  const inv1 = await prisma.invoice.findFirst({ where: { shipmentId: sh1.id }, select: { id: true, status: true, grandTotal: true, lines: { select: { itemId: true, qty: true, unitPrice: true, lineTotal: true } } } });
  check("tek hizmet fatura taslağı (DRAFT)", inv1?.status === "DRAFT", inv1?.status ?? "yok");
  const links1 = inv1 ? await prisma.serviceBillingLink.findMany({ where: { invoiceId: inv1.id, revokedAt: null }, select: { rollId: true, serviceItemId: true, billedMeters: true, meterBasis: true, unitPrice: true, workOrderStepId: true } }) : [];
  const kL = links1.filter((l) => l.serviceItemId === K50);
  const tL = links1.filter((l) => l.serviceItemId === KTB);
  check("kurşun bağı 2 (RA, RB atası; çocuk sayısından bağımsız tek kez) + Tambur bağı 3 (her çocuk kendi parçası)", kL.length === 2 && tL.length === 3, `kurşun ${kL.length}, tambur ${tL.length}`);
  check("kurşun billedMeters = OUT okuması (99,5 + 119,2), taban OUT", eq(kL.reduce((a, l) => a.plus(l.billedMeters), D(0)), 99.5 + 119.2) && kL.every((l) => l.meterBasis === "OUT"), JSON.stringify(kL.map((l) => [l.billedMeters.toString(), l.meterBasis])));
  check("kurşun unitPrice = müşterinin 50 gr fiyatı 7,5", kL.every((l) => eq(l.unitPrice, 7.5)), kL.map((l) => l.unitPrice.toString()).join(","));
  check("Tambur bağı = kesilen metre (60 + 40 + 120), taban CUT, adım = Tambur adımı", eq(tL.reduce((a, l) => a.plus(l.billedMeters), D(0)), 220) && tL.every((l) => l.meterBasis === "CUT" && l.workOrderStepId === STB), JSON.stringify(tL.map((l) => [l.billedMeters.toString(), l.meterBasis])));
  const lk = inv1?.lines.find((l) => l.itemId === K50);
  const lt = inv1?.lines.find((l) => l.itemId === KTB);
  check("kurşun satırı: miktar 218,7 × 7,5 = 1640,25", !!lk && eq(lk.qty, 218.7) && eq(lk.unitPrice, 7.5) && eq(D(lk.qty).times(lk.unitPrice), 1640.25), JSON.stringify(lk));
  check("Tambur satırı: 220 × 2 = 440; emanet kumaş satırı yok; toplam 2 satır", !!lt && eq(lt.qty, 220) && eq(lt.unitPrice, 2) && eq(lt.lineTotal, 440) && inv1!.lines.length === 2 && inv1!.lines.every((l) => l.itemId !== FABRIC), JSON.stringify(inv1?.lines));

  // ── 6 DÖNEM SONU (H8) ─────────────────────────────────────────────────────
  adim("6 Dönem sonu: PERIOD_END'de RC'nin çocuğu sevk → önizleme + oluşturma, çift faturalama yok");
  must(await api("PATCH", "/api/feature-flags", { financeServiceBillingTrigger: "PERIOD_END" }), "tetik PERIOD_END");
  const kidC = kids.find((k) => k.parentRollId === RC)!;
  const sh2 = must<{ id: string }>(await api("POST", "/api/shipping/shipments/from-rolls", { rollIds: [kidC.id], customerId: cust.id, orderless: true, clientToken: randomUUID() }), "sevk 2");
  fx.shipmentIds.push(sh2.id);
  const sh2Links = await prisma.serviceBillingLink.count({ where: { rollId: { in: [kidC.id, RC] }, revokedAt: null } });
  check("PERIOD_END: sevk kancası hizmet bağı kurmaz (0)", sh2Links === 0, String(sh2Links));
  const cari = await prisma.cariAccount.findFirst({ where: { customerId: cust.id }, select: { id: true } });
  const period = factoryYmd(new Date()).slice(0, 7);
  const pv = await api("GET", `/api/finance/invoices/service-period-draft/preview?cariId=${cari?.id}&period=${period}`);
  const pvData = pv.body.data as { lines?: Array<{ itemId: string; qty: string | number; unitPrice: string | number }>; links?: unknown[] } | undefined;
  const pk = pvData?.lines?.find((l) => l.itemId === K50);
  check("önizleme: yalnız RC işi — kurşun 140 m × 7,5; RA/RB işi yeniden gelmez", pv.status === 200 && !!pk && eq(pk.qty, 140) && eq(pk.unitPrice, 7.5), `${short(pv)} ${JSON.stringify(pvData?.lines)}`);
  const tok = randomUUID();
  const c1 = await api("POST", "/api/finance/invoices/service-period-draft", { cariId: cari?.id, period, clientToken: tok });
  const pInvId = (c1.body.data as { id?: string } | undefined)?.id;
  check("dönem taslağı oluştu (201)", c1.status === 201 && !!pInvId, short(c1));
  const pLinks = pInvId ? await prisma.serviceBillingLink.findMany({ where: { invoiceId: pInvId, revokedAt: null }, select: { serviceItemId: true, billedMeters: true } }) : [];
  check("dönem taslağı: 1 kurşun (RC OUT 140) + 1 Tambur (RC çocuğu CUT 150) bağı", pLinks.length === 2 && pLinks.some((l) => l.serviceItemId === K50 && eq(l.billedMeters, 140)) && pLinks.some((l) => l.serviceItemId === KTB && eq(l.billedMeters, 150)), JSON.stringify(pLinks));
  const c2 = await api("POST", "/api/finance/invoices/service-period-draft", { cariId: cari?.id, period, clientToken: randomUUID() });
  const allRollLinks = await prisma.serviceBillingLink.count({ where: { rollId: { in: [...rollIds, ...kids.map((k) => k.id)] }, revokedAt: null } });
  check("ikinci dönem taslağı 409 SERVICE_ALREADY_BILLED, aktif bağ toplamı 7 kalır (çift bağ yok)", c2.status === 409 && codeOf(c2) === "SERVICE_ALREADY_BILLED" && allRollLinks === 7, `${short(c2)}; bağ ${allRollLinks}`);
  must(await api("PATCH", "/api/feature-flags", { financeServiceBillingTrigger: "PER_SHIPMENT" }), "tetik geri");

  // ── 7 TERS YOL ────────────────────────────────────────────────────────────
  adim("7 Ters yol: faturalı sevk geri alınamaz; taslak iptalinden sonra alınır");
  const u1 = await api("POST", `/api/shipping/shipments/${sh1.id}/undo-dispatch`, { reason: "senaryo ters yol denemesi" });
  check("faturalı sevk geri alma 409 SERVICE_ALREADY_BILLED", u1.status === 409 && codeOf(u1) === "SERVICE_ALREADY_BILLED", short(u1));
  const upv = must<{ canUndo: boolean; serviceBilledInvoices?: string[] }>(await api("GET", `/api/shipping/shipments/${sh1.id}/undo-dispatch-preview`), "geri alma önizleme");
  check("önizleme: geri alınamaz + faturayı listeler", upv.canUndo === false && (upv.serviceBilledInvoices ?? []).length === 1, JSON.stringify(upv.serviceBilledInvoices));
  if (inv1) {
    const cn = await api("POST", `/api/finance/invoices/${inv1.id}/cancel`, { reason: "senaryo: sevk geri alınacak" });
    check("taslak iptal 200; 5 bağ damgalı (silinmez)", cn.status === 200 && (await prisma.serviceBillingLink.count({ where: { invoiceId: inv1.id, revokedAt: { not: null } } })) === 5, short(cn));
  }
  const u2 = await api("POST", `/api/shipping/shipments/${sh1.id}/undo-dispatch`, { reason: "senaryo ters yol denemesi" });
  const backRows = await prisma.roll.findMany({ where: { id: { in: shipKids.map((k) => k.id) } }, select: { status: true, shipmentId: true } });
  // releaseSacks verilmedi: toplar çuvalıyla depoya döner (çuval/sevk bağı bilinçli korunur).
  const backKids = backRows.filter((r) => r.status === "WAREHOUSE").length;
  if (backKids !== 3) console.log(`   ℹ️ geri alma sonrası: ${JSON.stringify(backRows)}`);
  check("iptal sonrası geri alma 200; 3 çocuk depoya döndü", u2.status === 200 && backKids === 3, `${short(u2)}; depoda ${backKids}`);
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n").slice(-1)[0]}`); }
  };
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: fx.noteIds } }, select: { rollId: true } })).map((l) => l.rollId).filter((v): v is string => v !== null);
  const kidIds = (await prisma.roll.findMany({ where: { parentRollId: { in: rollIds } }, select: { id: true } })).map((r) => r.id);
  const ids = [...kidIds, ...rollIds];
  const custIds = fx.customerId ? [fx.customerId] : [];
  const invIds = (await prisma.invoice.findMany({ where: { OR: [{ shipmentId: { in: fx.shipmentIds } }, { cari: { customerId: { in: custIds } } }] }, select: { id: true } })).map((i) => i.id);
  await del("link", () => prisma.serviceBillingLink.deleteMany({ where: { OR: [{ invoiceId: { in: invIds } }, { rollId: { in: ids } }] } }));
  await del("cariTx", () => prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invIds } } }));
  await del("invoiceLine", () => prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invIds } } }));
  await del("printedDoc", () => prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...invIds, ...fx.shipmentIds] } } }));
  await del("invoice", () => prisma.invoice.deleteMany({ where: { id: { in: invIds } } }));
  if (custIds.length > 0) {
    const cari = (await prisma.cariAccount.findMany({ where: { customerId: { in: custIds } }, select: { id: true } })).map((c) => c.id);
    await del("cariPeriodClose", () => prisma.cariPeriodClose.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cariBalance", () => prisma.cariBalance.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cariTx2", () => prisma.cariTransaction.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: cari } } }));
  }
  await del("sackAlloc", () => prisma.sackAllocation.deleteMany({ where: { sack: { shipmentId: { in: fx.shipmentIds } } } }));
  await del("meterAck", () => prisma.rollMeterAck.deleteMany({ where: { reading: { rollId: { in: ids } } } }));
  await del("meterReading", () => prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll unlink", () => prisma.roll.updateMany({ where: { id: { in: ids } }, data: { sackId: null, shipmentId: null, parentRollId: null } }));
  await del("noteLine unlink", () => prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: fx.noteIds } }, data: { rollId: null } }));
  for (const [ad, model] of [["whMove", "warehouseMovement"], ["rollOperation", "rollOperation"], ["rollMovement", "rollMovement"], ["rollVariance", "rollVariance"], ["rollProperty", "rollProperty"], ["rollError", "rollError"], ["stockLedger", "stockLedgerEntry"]] as const) {
    const m = (prisma as unknown as Record<string, { deleteMany?: (a: unknown) => Promise<unknown> }>)[model];
    if (m?.deleteMany) await del(ad, () => m.deleteMany!({ where: { rollId: { in: ids } } }));
  }
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("noteLine", () => prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: fx.noteIds } } }));
  await del("note", () => prisma.customerDeliveryNote.deleteMany({ where: { id: { in: fx.noteIds } } }));
  await del("shipmentEvent", () => prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: fx.shipmentIds } } }));
  await del("shipment", () => prisma.shipment.deleteMany({ where: { id: { in: fx.shipmentIds } } }));
  await del("sack", () => prisma.sack.deleteMany({ where: { customerId: { in: custIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("targetValue", () => prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("batch", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { id: { in: fx.valueIds } } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("defaultItem", () => prisma.deliveryNoteCustomerDefault.deleteMany({ where: { customerId: { in: custIds } } }));
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: custIds } } }));
  const left = await prisma.roll.count({ where: { id: { in: ids } } });
  check("temizlik: senaryo topu kalmadı", left === 0, String(left));
}

/** Ayar geri alma: senaryo öncesi tablo aynen (yeni doğan anahtar silinir). `finally` içinden çağrılır. */
async function restoreSettings(): Promise<void> {
  const now = await prisma.systemSetting.findMany({ select: { key: true } });
  for (const { key } of now) {
    if (!priorSettings.has(key)) await prisma.systemSetting.deleteMany({ where: { key } });
  }
  for (const [key, value] of priorSettings) {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
  }
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    if (snapshotTaken) {
      await restoreSettings().catch((e) => { fail++; console.error("❌ ayar geri alma:", e); });
      await cleanup().catch((e) => { fail++; console.error(e); });
    }
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız, ${known} bilinen — süre ${((Date.now() - T0) / 1000).toFixed(1)} sn ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
