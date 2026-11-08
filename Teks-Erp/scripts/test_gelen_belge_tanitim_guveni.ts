// =============================================================================
// GELEN BELGE — TANITIM GÜVENİ: `gelenBelge.tanitimGuveni` SOR | SORMA (K30-B, Gülkesim 2026-11-04)
// =============================================================================
// HTTP + gerçek DB + gerçek motor. Okuma anı `buildDraft` → `fillBoundDraftTx` (okuma işinin yazdığı kolonlar), ardından
// `GET /irsaliyeler/:id/okuma-ozeti`. Sınanan:
//   §1 (e) ayar: varsayılan SOR, tanınmayan değer 400, geçerli SORMA yazılır; ham ayar ucuna kapalı
//   §2 (a) SOR + kullanıcı şablonu (u-) = bugünkü: iki parti adayı (DOC + BATCH), parti no seçilmez; `tanitim` TANITILDI
//   §3 (b) ⭐ SORMA + u-: müşteri tek eşleşmede kesin (OWNER_TEXT), parti yalnız parti alanı (kolon da), metre doğrulamasız;
//      ayar sonradan değişince ESKİ belgenin kolonu değişmez; sistem şablonu tutan belge `tanitim: SISTEM` taşır
//   §4 (c) ⭐ SORMA + tanıtılmamış (sentetik GENEL zarfı): form alanı / müşteri / parti adayı YOK (SOR'da hepsi var); TANITILMAMIS
//   §5 (d) ⭐ öneri ucu `benzerSablonlar`: eşik üstü kullanıcı şablonları skor azalan; güncellenen şablon (base) listede yok
//   §6 saf `introStateOf` / `trustModeOf` / `applyTrust`; kaldırılmış yerleşik kod → TANITILMAMIS (2026-11-09)
// Negatif sonda (2026-11-04, ölçüldü): `applyTrust` TRUSTED dalı `return d` → §3 parti/kolon + §6 kırmızı (4);
// `noteFormFields` BLIND dalı silinince → §4 formFields kırmızı (1).
// İnceleme turu (2026-11-04, ölçüldü): TRUSTED `review: false` koşulsuz → §6 çelişki kırmızı (1); `u-` koşulu silinince →
// §6 sistem kırmızı (1); `introStateOf` bölgesiz → TANITILMAMIS yapılınca → §4 eski zarf + §6 kırmızı (2).
// =============================================================================
import { randomUUID, createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { INCOMING_DOC_DEDICATED_SETTING_KEYS } from "../src/services/gelen-belge-ayar.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { engineTemplates } from "../src/services/gelen-belge-ozel-sablon.service";
import { buildDraft, fillBoundDraftTx } from "../src/services/gelen-belge-taslak-doldur.service";
import { introStateOf, trustModeOf } from "../src/services/gelen-belge-tanitim-guveni.service";
import { applyTrust, type BatchAndMeters } from "../src/services/gelen-belge-parti-metre.service";
import { extractDocument, type OcrResult } from "../src/lib/gelen-belge/motor";
import { templateByCode } from "../src/lib/gelen-belge/sablon-bul";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testSablonlariniKaydet } from "./lib/gelen-belge-test-sablonlar";

// Gönderen şablonları pakette yok (2026-11-09): bekçi onları süreç içi dosya şablonu olarak kaydeder.
testSablonlariniKaydet();

const blocked = hedefDbEngeli();
if (blocked) {
  console.error(`⛔ DURDURULDU — ${blocked}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const FIXTURES = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "gercek");
const fixture = (name: string): OcrResult => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as OcrResult;
const OWNER_NAME = "ÖRNEK TEKSTİL A";

const TAG = `TEST-GTG${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], notes: [] as string[], scans: [] as string[], templates: [] as string[] };
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED,
  SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, SETTING_KEYS.GELEN_BELGE_AUTO_SENDER,
];

type Resp = { status: number; code?: string; data?: Record<string, unknown> & { [k: string]: unknown } };
type Candidate = { key: string; kind: string; value: string };
type Summary = {
  status: number; tanitim?: { durum: string; sablonKodu?: string; sablonAdi?: string }; owner: { source?: string; customerId?: string } | null;
  batch: Candidate[]; formFields?: Record<string, unknown>; ourBatchNo: unknown; review: unknown;
};

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function addScan(noteId: string | null, ocrResult: unknown): Promise<string> {
  const content = Buffer.from(`${TAG}-${randomUUID()}`);
  const s = await prisma.documentScan.create({
    data: { noteId, pageNo: 1, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: ocrResult as never },
    select: { id: true },
  });
  made.scans.push(s.id);
  return s.id;
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  for (const k of [SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, SETTING_KEYS.GELEN_BELGE_AUTO_SENDER]) await setSetting(k, null);
  const login = async (username: string, password: string) => {
    const r = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };
  const tk = await login(admin.username, admin.password);
  check("admin login", tk.length > 0);

  // Fikstürün müşteri satırı; aynı adlı canlı cari varsa (önceki koşum/seed) o kullanılır — tek eşleşme şartı ölçülür.
  const same = await prisma.customer.findMany({ where: { name: OWNER_NAME, isActive: true, mergedIntoId: null }, select: { id: true } });
  let ownerId = same[0]?.id ?? "";
  if (same.length === 0) {
    ownerId = (await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: OWNER_NAME }, select: { id: true } })).id;
    made.customers.push(ownerId);
  }
  check("müşteri carisi tek", same.length <= 1, String(same.length));

  /** Boş MANUAL taslak; `read` verilirse taramayı bağlar (okuma işinin yazdığı gibi). */
  const emptyNote = async (): Promise<string> => {
    const r = await call("POST", "/api/gelen-belge/irsaliyeler", tk, { sourceKind: "MANUAL", senderText: `${TAG} GÖNDEREN` });
    const id = (r.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    check(`boş taslak (${made.notes.length})`, r.status === 201 && !!id, `${r.status} ${r.code ?? ""}`);
    return id;
  };
  /** Okuma anı: ayar BU AN okunur (kolonlar kipe göre yazılır). */
  const readNote = async (ocr: OcrResult): Promise<string> => {
    const id = await emptyNote();
    const built = await buildDraft(ocr, admin.id, { bumpHit: false });
    const scanId = await addScan(id, built.envelope);
    await prisma.$transaction((tx) => fillBoundDraftTx(tx, id, { id: scanId, pageNo: 1 }, built));
    return id;
  };
  const summary = async (id: string): Promise<Summary> => {
    const r = await call("GET", `/api/gelen-belge/irsaliyeler/${id}/okuma-ozeti`, tk);
    const d = r.data ?? {};
    return {
      status: r.status, tanitim: d.tanitim as Summary["tanitim"], owner: (d.ownerSuggestion ?? null) as Summary["owner"],
      batch: (d.batchNoCandidates ?? []) as Candidate[], formFields: d.formFields as Record<string, unknown> | undefined,
      ourBatchNo: d.ourBatchNo, review: d.kursunMetersReview,
    };
  };
  const brief = (s: Summary) => JSON.stringify({ st: s.status, t: s.tanitim, o: s.owner, b: s.batch.map((c) => `${c.kind}:${c.value}`), f: s.formFields, p: s.ourBatchNo, r: s.review });
  const column = async (id: string) => prisma.customerDeliveryNote.findUnique({ where: { id }, select: { ourBatchNo: true, kursunMetersReview: true } });

  console.log("§1 ayar");
  const s1 = await call("GET", "/api/gelen-belge/ayarlar", tk);
  check("§1 tanitimGuveni SOR + default SOR (= bugünkü)", s1.data?.tanitimGuveni === "SOR" && s1.data?.defaultTanitimGuveni === "SOR", JSON.stringify({ t: s1.data?.tanitimGuveni, d: s1.data?.defaultTanitimGuveni }));
  check("§1 anahtar ham ayar ucuna kapalı (dedicated)", INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI));
  const bad1 = await call("PUT", "/api/gelen-belge/ayarlar", tk, { tanitimGuveni: "BELKI" });
  check("§1 tanınmayan değer 400", bad1.status === 400, `${bad1.status} ${bad1.code ?? ""}`);
  const ok1 = await call("PUT", "/api/gelen-belge/ayarlar", tk, { tanitimGuveni: "SORMA" });
  const s1b = await call("GET", "/api/gelen-belge/ayarlar", tk);
  check("§1 geçerli SORMA yazılır", ok1.status === 200 && s1b.data?.tanitimGuveni === "SORMA", `${ok1.status} ${ok1.code ?? ""}`);
  await setSetting(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, null);

  console.log("§2 kullanıcı şablonu (u-) tanıt + SOR");
  const ocr = fixture("0245-ceki-listesi-a");
  const lines = ocr.blocks.flatMap((b) => b.lines);
  const rectOf = (t: string) => lines.find((l) => l.text === t)!.rect;
  const elOf = (t: string) => lines.flatMap((l) => l.elements).find((e) => e.text === t)!.rect;
  const tplScan = await addScan(null, { ocr });
  const proposal = (name: string, identifiers: string[], extra: Record<string, unknown> = {}) => call("POST", "/api/gelen-belge/sablonlar/oneri", tk, {
    scanId: tplScan, name, identifiers,
    assignments: [{ field: "musteri", rect: rectOf(OWNER_NAME) }, { field: "partiNo", rect: elOf("P9918733") }, { field: "evrakNo", rect: rectOf("914279") }],
    table: { columns: [{ key: "topNo", header: "Top No" }, { key: "kg", header: "Kilo" }, { key: "m", header: "Metre" }], totalsLabel: "T.Adet" },
    ...extra,
  });
  const save = async (name: string, identifiers: string[]): Promise<string> => {
    const p = await proposal(name, identifiers);
    const c = await call("POST", "/api/gelen-belge/sablonlar/ozel", tk, { name, template: p.data?.template, clientToken: randomUUID() });
    const code = String(c.data?.code ?? "");
    const row = code ? await prisma.senderTemplate.findUnique({ where: { code }, select: { id: true } }) : null;
    if (row) made.templates.push(row.id);
    check(`§2 şablon kaydı ${name}`, p.status === 200 && (p.data?.errors as unknown[])?.length === 0 && c.status === 201 && code.startsWith("u-"), `${p.status} ${c.status} ${c.code ?? ""} ${JSON.stringify(p.data?.errors)}`);
    return code;
  };
  const nameA = `${TAG} çeki A`;
  const codeA = await save(nameA, ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO", "Ham PartiNo", "FAT./IRSALIYE NO", "Sira No", "Ham Giriş"]);
  const engine = await engineTemplates();
  const regionTpl = extractDocument(ocr, engine).regions[0]?.templateId;
  check("§2 motor 0245'i kullanıcı şablonuyla okur (dosya çeki şablonu yerine)", regionTpl === codeA, JSON.stringify({ regionTpl, codeA }));

  const noteA = await readNote(ocr);
  const a = await summary(noteA);
  check("§2 ⭐ SOR = bugünkü: iki parti adayı (DOC + BATCH), parti no seçilmez",
    a.status === 200 && a.batch.some((c) => c.kind === "DOC") && a.batch.some((c) => c.kind === "BATCH" && c.value === "P9918733") && a.ourBatchNo === null, brief(a));
  check("§2 ⭐ tanitim TANITILDI + şablon kodu + adı", a.tanitim?.durum === "TANITILDI" && a.tanitim.sablonKodu === codeA && a.tanitim.sablonAdi === nameA, brief(a));

  console.log("§3 SORMA + tanıtılmış");
  await setSetting(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, "SORMA");
  const noteB = await readNote(ocr);
  const b = await summary(noteB);
  check("§3 ⭐ müşteri tek eşleşmede kesin (OWNER_TEXT)", b.owner?.source === "OWNER_TEXT" && b.owner.customerId === ownerId, brief(b));
  check("§3 ⭐ parti yalnız parti alanı: tek aday P9918733 (BATCH); kolon yazıldı", b.batch.length === 1 && b.batch[0]!.kind === "BATCH" && b.batch[0]!.value === "P9918733" && b.ourBatchNo === "P9918733", brief(b));
  check("§3 ⭐ metre doğrulama beklemez (kursunMetersReview false)", b.review === false, brief(b));
  check("§3 tanitim TANITILDI", b.tanitim?.durum === "TANITILDI" && b.tanitim.sablonKodu === codeA, brief(b));
  const aStill = await summary(noteA);
  check("§3 SORMA'da eski (SOR'da okunmuş) belgenin kolonu değişmez; canlı adaylar tekleşir", (await column(noteA))?.ourBatchNo === null && aStill.batch.length === 1, brief(aStill));
  const sys = await readNote(fixture("0244-kumas-irsaliyesi"));
  const sysS = await summary(sys);
  check("§3 sistem şablonu tutan belge: `tanitim` SISTEM (şablon adıyla), adaylar NORMAL", sysS.status === 200 && sysS.tanitim?.durum === "SISTEM" && typeof sysS.tanitim?.sablonAdi === "string", brief(sysS));
  await setSetting(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, null);
  const bAfter = await column(noteB);
  check("§3 ⭐ ayar SOR'a dönünce SORMA'da yazılan kolon değişmez", bAfter?.ourBatchNo === "P9918733" && (await summary(noteB)).batch.length === 2, JSON.stringify(bAfter));

  console.log("§4 tanıtılmamış (GENEL sözlük tahmini)");
  const genericNote = async (): Promise<string> => {
    const id = await emptyNote();
    // Sentetik zarf: tüm gerçek fikstürler bir sistem şablonu tutar → GENEL bölgesi elle (okuma işinin yazdığı biçim).
    await addScan(id, { ocr: { text: TAG, blocks: [] }, regions: [{ templateId: "genel", fields: { hedefMetraj: "1200", en: "150", partiNo: "PX4471", belgeNo: "B7781" } }] });
    await prisma.customerDeliveryNote.update({ where: { id }, data: { ownerText: OWNER_NAME } });
    return id;
  };
  const c0 = await summary(await genericNote());
  check("§4 SOR = bugünkü: form alanı + müşteri önerisi + iki parti adayı; TANITILMAMIS",
    c0.formFields?.hedefMetraj === 1200 && c0.formFields.en === 150 && c0.owner?.customerId === ownerId && c0.batch.length === 2 && c0.tanitim?.durum === "TANITILMAMIS", brief(c0));
  await setSetting(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, "SORMA");
  const c1 = await summary(await genericNote());
  check("§4 ⭐ SORMA: formFields boş", !!c1.formFields && Object.keys(c1.formFields).length === 0, brief(c1));
  check("§4 ⭐ SORMA: müşteri önerisi yok, parti adayı yok; TANITILMAMIS", c1.owner === null && c1.batch.length === 0 && c1.tanitim?.durum === "TANITILMAMIS", brief(c1));
  // Eski/şema dışı zarf (bölgede `templateId` ANAHTARI yok): jsonpath lax kipi atlar → tanıtım durumu yok → NORMAL (kör değil).
  const legacy = await emptyNote();
  await addScan(legacy, { ocr: { text: TAG, blocks: [] }, regions: [{ fields: { hedefMetraj: "1200", partiNo: "PX4471" } }] });
  await prisma.customerDeliveryNote.update({ where: { id: legacy }, data: { ownerText: OWNER_NAME } });
  const cl = await summary(legacy);
  check("§4 SORMA + templateId'siz eski zarf: `tanitim` yok, müşteri önerisi korunur (BLIND değil)", cl.tanitim === undefined && cl.owner?.customerId === ownerId, brief(cl));
  await setSetting(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, null);

  console.log("§5 benzer şablonlar");
  const nameB = `${TAG} çeki B`;
  const codeB = await save(nameB, ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO", "Sipariş No", "Kalite ZiNCIR"]);
  type Similar = Array<{ kod: string; ad: string; skor: number }>;
  const free = await proposal(`${TAG} yeni`, ["KUMAŞ ÇEKİ LİSTESİ"]);
  const list = (free.data?.benzerSablonlar ?? []) as Similar;
  const sorted = list.every((x, i) => i === 0 || list[i - 1]!.skor >= x.skor);
  check("§5 ⭐ base'siz: iki kullanıcı şablonu da listede, skor azalan, ad şablondan",
    free.status === 200 && list.some((x) => x.kod === codeA && x.ad === nameA) && list.some((x) => x.kod === codeB) && sorted, JSON.stringify(list));
  const based = await proposal(nameA, ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO"], { base: { code: codeA, keep: [] } });
  const list2 = (based.data?.benzerSablonlar ?? []) as Similar;
  check("§5 ⭐ base A güncellemesi: A listede yok, B var", based.status === 200 && !list2.some((x) => x.kod === codeA) && list2.some((x) => x.kod === codeB), `${based.status} ${based.code ?? ""} ${JSON.stringify(list2)}`);
  const ocr44 = fixture("0244-kumas-irsaliyesi");
  const line44 = ocr44.blocks.flatMap((x) => x.lines)[0]!;
  const other = await call("POST", "/api/gelen-belge/sablonlar/oneri", tk, { scanId: await addScan(null, { ocr: ocr44 }), name: `${TAG} başka`, identifiers: [line44.text], assignments: [{ field: "evrakNo", rect: line44.rect }] });
  const list3 = (other.data?.benzerSablonlar ?? []) as Similar;
  check("§5 eşik altı belge: A/B listede yok", other.status === 200 && Array.isArray(other.data?.benzerSablonlar) && !list3.some((x) => x.kod === codeA || x.kod === codeB), `${other.status} ${JSON.stringify(list3)}`);

  console.log("§6 saf yardımcılar");
  check("§6 introStateOf: u- → TANITILDI (ilk u-); genel/null → TANITILMAMIS; sistem şablonu → SISTEM; bölgesiz → null",
    JSON.stringify(introStateOf(["genel", "u-x", "u-y"])) === JSON.stringify({ durum: "TANITILDI", sablonKodu: "u-x" }) && introStateOf(["genel", null])?.durum === "TANITILMAMIS" &&
    JSON.stringify(introStateOf(["ceki-listesi-a"])) === JSON.stringify({ durum: "SISTEM", sablonKodu: "ceki-listesi-a" }) && introStateOf(["genel", "ceki-listesi-a"])?.durum === "SISTEM" && introStateOf([]) === null);
  // Paketten çıkarılmış yerleşik şablonun eski kayıttaki kodu (2026-11-09): motorda yok → TANITILMAMIS (SISTEM değil, çökmez).
  check("§6 kaldırılmış yerleşik kod (motorda yok) → TANITILMAMIS; bilinen dosya şablonuyla birlikteyse SISTEM o şablon",
    JSON.stringify(introStateOf(["kaldirilmis-yerlesik"])) === JSON.stringify({ durum: "TANITILMAMIS" }) &&
    JSON.stringify(introStateOf(["kaldirilmis-yerlesik", "ceki-listesi-a"])) === JSON.stringify({ durum: "SISTEM", sablonKodu: "ceki-listesi-a" }));
  const tan = { durum: "TANITILDI" as const, sablonKodu: "u-x" };
  const un = { durum: "TANITILMAMIS" as const };
  check("§6 trustModeOf: SOR → NORMAL; SORMA + TANITILDI → TRUSTED, + TANITILMAMIS → BLIND, + sistem → NORMAL",
    trustModeOf("SOR", tan) === "NORMAL" && trustModeOf("SOR", un) === "NORMAL" && trustModeOf("SORMA", tan) === "TRUSTED" && trustModeOf("SORMA", un) === "BLIND" && trustModeOf("SORMA", null) === "NORMAL" && trustModeOf("SORMA", { durum: "SISTEM", sablonKodu: "ceki-listesi-a" }) === "NORMAL");
  const input: BatchAndMeters = {
    batchNoCandidates: [{ key: "evrakNo", kind: "DOC", label: "Evrak", value: "914279" }, { key: "partiNo", kind: "BATCH", label: "Parti", value: "P1" }] as BatchAndMeters["batchNoCandidates"],
    kursun: { meters: "100", source: "TOTAL", review: true, candidates: { output: null, total: "100", input: null, lineSum: "100" } },
  };
  const tplA = templateByCode(codeA);
  const tr = applyTrust(input, tplA, "TRUSTED");
  const bl = applyTrust(input, tplA, "BLIND");
  check("§6 applyTrust: NORMAL aynı · TRUSTED yalnız BATCH + review false · BLIND aday/metre yok",
    applyTrust(input, tplA, "NORMAL") === input && tr.batchNoCandidates.length === 1 && tr.batchNoCandidates[0]!.kind === "BATCH" && tr.kursun.review === false &&
    bl.batchNoCandidates.length === 0 && bl.kursun.meters === null, JSON.stringify({ tpl: !!tplA, tr, bl }));
  const lineMeters = applyTrust({ ...input, kursun: { ...input.kursun, source: "LINE_SUM" } }, tplA, "TRUSTED");
  check("§6 applyTrust TRUSTED: satır toplamı metresi doğrulama bekler", lineMeters.kursun.review === true, JSON.stringify(lineMeters));
  const clash = applyTrust({ ...input, kursun: { ...input.kursun, candidates: { ...input.kursun.candidates, lineSum: "90" } } }, tplA, "TRUSTED");
  check("§6 ⭐ applyTrust TRUSTED: toplam Σ satırla çelişirse (100 ↔ 90) doğrulama KORUNUR", clash.kursun.review === true, JSON.stringify(clash.kursun));
  const sysTpl = templateByCode("ceki-listesi-a");
  check("§6 ⭐ applyTrust TRUSTED: türetim şablonu kullanıcı şablonu değilse (sistem/şablonsuz) NORMAL ile aynı",
    !!sysTpl && applyTrust(input, sysTpl, "TRUSTED") === input && applyTrust(input, undefined, "TRUSTED") === input, JSON.stringify({ sys: sysTpl?.id ?? null }));
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { scanId: null } }).catch(swallow);
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
  await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: made.notes } } }).catch(swallow);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await prisma.senderTemplateVersion.deleteMany({ where: { templateId: { in: made.templates } } }).catch(swallow);
  await prisma.senderTemplate.deleteMany({ where: { id: { in: made.templates } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
}

async function main(): Promise<void> {
  console.log("=== Gelen belge tanıtım güveni (K30-B) bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
    stopNotificationJobs();
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!blocked) void main();
else void prisma.$disconnect();
