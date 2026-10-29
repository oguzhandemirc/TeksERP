// =============================================================================
// TeksERP — Gelen belge ONAYI → emanet top girişi (Gülkesim OCR D4)
// =============================================================================
// Karar belgesi TASARIM-KARARI-2026-10-28 §3 adım 6 + §6 D4. Tek defter satırı buradan doğar:
// her satır MEVCUT giriş motoru `InventoryService.createInitialEntry` ile top olur (ikinci motor YOK).
//
// ⚠️ FİŞ BİR KAPTIR, ATOMİK PAKET DEĞİL (`goods-receipt.service` emsali): her top kendi tx'inde
// doğar; düşen satır FAILED + Türkçe sebep, başlık APPROVED (hepsi girdi) ya da PARTIAL. Yeniden
// onay yalnız topsuz (PENDING|FAILED) satırı işler; ENTERED satır bir daha ellenmez.
//
// İdempotency: satırın top token'ı `uuidv5(lineId)` — belirlenimli, denemeler arası sabit. Yarıda
// kalan koşum (ENTERING satır, top doğmuş) ikinci onayda `tokenReplay` boğazından mevcut topu alır,
// yeni top DOĞMAZ (replay dört durumlu: helper başlığı). `duplicateGuard` GEÇİLMEZ: motor onu yalnız
// `opts.duplicateGuard` verildiğinde okur (F221 deseni, inventory.service ~1156) — eşit metrajlı
// meşru satırlar (aynı partiden iki 200 m top) 409'a düşmesin diye BİLEREK verilmiyor.
//
// `forcedStatus: STOCK` ZORUNLU: motorun renk sezgisi (`colorId != null → WAREHOUSE`, ~1130) fason
// gelen renkli kumaşı bitmiş depoya düşürürdü; emanet mal İŞLENMEK üzere gelir → ham stok.
// =============================================================================
import { DeliveryNoteAliasScope, DeliveryNoteLineStatus, DeliveryNoteStatus, Prisma, RollEntrySource, RollStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { v5 as uuidv5 } from "uuid";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { InventoryService } from "./inventory.service";
import { assertEmanetWritableTx } from "./helpers/emanet-owner.helper";
import { getDeliveryNote } from "./gelen-belge-note.service";
import { auditLine } from "./gelen-belge-line.service";
import { resolveDefaultItemForApproval, type DefaultItemSource } from "./gelen-belge-varsayilan.service";
import { readUnreviewedApprovalMode } from "./system-setting.service";
import { assertProcessChoiceValue } from "./helpers/process-choice-catalog.helper";
import { aliasKey } from "./gelen-belge-eslestirme.service";

const NOTE_TABLE = "CUSTOMER_DELIVERY_NOTE";
const LINE_TABLE = "CUSTOMER_DELIVERY_NOTE_LINE";
const ALIAS_TABLE = "DELIVERY_NOTE_ALIAS";
/** Satır → top token uzayı (sabit; değişirse yarıda kalan onaylar ikinci top doğurur). */
const LINE_TOKEN_NS = "6f1c2a0e-5b3d-4c8a-9e21-7d4f0a1b2c3d";
/**
 * Giriş sebebi kodu (`Roll.entryReasonCode`, rapor anahtarı) — SİSTEM yazar, operatör seçmez; bu yüzden
 * `MANUAL_ENTRY_REASONS` kataloğuna GİRMEZ (katalog tablet/Electron seçici zeminidir, mobil ayna bayt-eşit).
 */
export const INCOMING_DOC_REASON_CODE = "GELEN_BELGE";
/** Yarıda kalmış APPROVING (süreç ölümü) bu süreden sonra yeniden claim edilebilir. */
const STALE_APPROVING_MS = 10 * 60 * 1000;
/** Uzun koşumda başlığın `updatedAt`'i bu aralıkla tazelenir (kalp atışı): meşru koşum bayat sayılıp devralınmasın. */
const HEARTBEAT_MS = 60 * 1000;
/** Beyan edilen kg/m ile satır toplamı arasındaki hoşgörü (OCR ondalık kaybı; adet HOŞGÖRÜSÜZ). */
const TOTAL_TOLERANCE = 0.005;

const inventory = new InventoryService();

export interface ApproveInput {
  /** Toplam uyuşmazlığını BİLEREK geçme gerekçesi (başlığa yazılır). */
  varianceReason?: string | null;
  /**
   * Operatörün kabul ettiği/düzelttiği işlem önerileri (H9 gramaj; D4-D1 her çeşit değeri): `lineId` null = başlığın işlem metni. Yalnız PROCESS
   * sözlüğüne öğretilir; topa, iş emrine ya da deftere DEĞER YAZILMAZ.
   */
  processChoices?: ReadonlyArray<{ lineId: string | null; valueId: string }> | null;
}

export interface ApproveResult {
  note: Awaited<ReturnType<typeof getDeliveryNote>>;
  summary: { entered: number; failed: number; skipped: number; replayed: number; rollIds: string[] };
  /** Onayı durdurmayan uyuşmazlıklar (başlık top adedi ↔ satır; gerekçeyle aşılan sayfa kapısı) → `ApiResponse.warnings`. */
  warnings: string[];
}

// OCR beyanı sayıları METİN yazar (motor DeclaredTotals: string); elle girilen sayı olabilir — karşılaştırma Number() ile.
type DeclaredBlock = { blockNo?: number; count?: number | string | null; kg?: number | string | null; m?: number | string | null };
type LineRow = { id: string; lineNo: number; blockNo: number; status: DeliveryNoteLineStatus; meters: Prisma.Decimal; weightKg: Prisma.Decimal | null; widthCm: Prisma.Decimal | null; itemId: string | null; colorId: string | null; itemText: string | null; colorText: string | null; processText: string | null; rollId: string | null; needsReview: boolean };

const PRE_SELECT = {
  id: true, noteNo: true, status: true, ownerCustomerId: true, senderCustomerId: true, senderText: true, processText: true, pageCount: true,
  declaredTopCount: true, totalsDeclared: true, varianceReason: true, updatedAt: true,
  lines: { select: { id: true, lineNo: true, blockNo: true, status: true, meters: true, weightKg: true, widthCm: true, itemId: true, colorId: true, itemText: true, colorText: true, processText: true, rollId: true, needsReview: true }, orderBy: [{ blockNo: "asc" }, { lineNo: "asc" }] },
  scans: { select: { pageNo: true } },
} satisfies Prisma.CustomerDeliveryNoteSelect;

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * TOTAL_TOLERANCE);

type TotalLine = { blockNo: number; meters: Prisma.Decimal | number; weightKg: Prisma.Decimal | number | null; status: DeliveryNoteLineStatus };

/**
 * Başlık top adedi ↔ canlı satır sayısı — UYARI (tasarım §4: `declaredTopCount` yalnız uyarı; motor onu blok 1'den
 * okur, çok bloklu belgede sert kapı her onayı 409'a düşürürdü). Saf.
 */
export function totalWarnings(note: { declaredTopCount: number | null }, lines: ReadonlyArray<TotalLine>): string[] {
  const live = lines.filter((l) => l.status !== "SKIPPED").length;
  return note.declaredTopCount != null && note.declaredTopCount !== live ? [`Belgede ${note.declaredTopCount} top yazıyor, satır sayısı ${live}.`] : [];
}

/**
 * Toplam kapısı (SERT) — Σ satır ↔ blok başına beyan (T.Adet/kg/m). Uyuşmazlık listesi boşsa geçer.
 * Saf: DB okumaz (bekçi doğrudan sınar).
 */
export function totalMismatches(note: { totalsDeclared: unknown }, lines: ReadonlyArray<TotalLine>): string[] {
  const live = lines.filter((l) => l.status !== "SKIPPED");
  const out: string[] = [];
  const blocks = (note.totalsDeclared as { blocks?: DeclaredBlock[] } | null)?.blocks;
  if (!Array.isArray(blocks)) return out;
  for (const b of blocks) {
    const bl = live.filter((l) => l.blockNo === (b.blockNo ?? 1));
    const m = bl.reduce((s, l) => s + Number(l.meters), 0);
    const kg = bl.reduce((s, l) => s + Number(l.weightKg ?? 0), 0);
    if (b.count != null && b.count !== "" && Number(b.count) !== bl.length) out.push(`Blok ${b.blockNo ?? 1}: beyan ${b.count} top, satır ${bl.length}.`);
    if (b.m != null && !near(m, Number(b.m))) out.push(`Blok ${b.blockNo ?? 1}: beyan ${b.m} m, satır toplamı ${m.toFixed(3)} m.`);
    if (b.kg != null && !near(kg, Number(b.kg))) out.push(`Blok ${b.blockNo ?? 1}: beyan ${b.kg} kg, satır toplamı ${kg.toFixed(3)} kg.`);
  }
  return out;
}

/**
 * Ön kontrol — DB YAZMAZ; claim'den önce koşar, hata operatöre tek seferde listelenir. Okuduğu anlık görüntü claim
 * WHERE'indeki `updatedAt` eşitliğiyle bağlanır (arada sahip/satır değişirse claim 409 — TOCTOU kapalı). Uyarıları döner.
 */
interface PrecheckResult {
  warnings: string[];
  /** Ürünü seçilmemiş açık satır varsa onların doğacağı ürün: sahibin varsayılanı (E4) ya da fabrika ayarı (E3); yoksa null. */
  defaultItem: { id: string; name: string; source: DefaultItemSource } | null;
}

async function precheck(note: Prisma.CustomerDeliveryNoteGetPayload<{ select: typeof PRE_SELECT }>, input: ApproveInput): Promise<PrecheckResult> {
  if (!note.ownerCustomerId) throw AppError.badRequest("Sahip cari seçilmeden onaylanamaz (emanet top sahipsiz doğamaz).", { code: "DELIVERY_NOTE_OWNER_REQUIRED" });
  // Emanet kapısı + sahip aktifliği TEK yazıcıdan (lisans sorusu + MODULE_DISABLED + pasif/bulunamayan sahip
  // OWNER_CUSTOMER_INVALID aynı helper'da; motor tx içinde yeniden sorar).
  await assertEmanetWritableTx(prisma, note.ownerCustomerId, "gelen belge onayı");
  const open = note.lines.filter((l) => l.status === "PENDING" || l.status === "FAILED" || l.status === "ENTERING");
  if (open.length === 0) throw AppError.conflict(`${note.noteNo} için işlenecek satır yok (hepsi girilmiş ya da atlanmış).`, { code: "DELIVERY_NOTE_NO_OPEN_LINES" });
  const unresolved = open.filter((l) => !l.itemId).map((l) => l.lineNo);
  // Hizmet ekseni (E3/E4): ürünsüz satır sahibin varsayılanıyla, yoksa fabrika ayarıyla girer; ikisi de boşsa bugünkü 400.
  // Varsayılan top doğuramıyorsa (pasif/birleşmiş/silinmiş) sessizce düşmez → 409 GELEN_BELGE_DEFAULT_ITEM_UNUSABLE.
  const defaultItem = unresolved.length ? await resolveDefaultItemForApproval(note.ownerCustomerId) : null;
  if (unresolved.length && !defaultItem) {
    throw AppError.badRequest(`Ürünü çözülmemiş satır var: ${unresolved.join(", ")}. Her satırda ürün eşlenmeden onaylanamaz.`, { code: "DELIVERY_NOTE_LINE_UNRESOLVED", lineNos: unresolved });
  }
  // İnceleme kapısı (E3, D5'ten kalan karar): needsReview açık satır — BLOCK'ta 409, WARN'da (varsayılan) uyarıyla geçer.
  const unreviewed = open.filter((l) => l.needsReview).map((l) => l.lineNo);
  const reviewMode = unreviewed.length ? await readUnreviewedApprovalMode() : "WARN";
  if (unreviewed.length && reviewMode === "BLOCK") {
    throw AppError.conflict(`Gözden geçirilmemiş satır var: ${unreviewed.join(", ")}. Hücreleri gözden geçirip onaylayın (fabrika ayarı: gözden geçirilmemiş hücreyle onay engelli).`, { code: "DELIVERY_NOTE_REVIEW_PENDING", lineNos: unreviewed });
  }
  // Kapılar YALNIZ bu istekteki gerekçeyle açılır: başlıkta kalmış eski gerekçe sonraki onayın yeni uyuşmazlığını örtmez.
  const reason = input.varianceReason?.trim();
  const warnings = totalWarnings(note, note.lines);
  if (unreviewed.length) warnings.push(`Gözden geçirilmemiş satırla onaylandı: ${unreviewed.join(", ")}.`);
  if (defaultItem) warnings.push(`Ürünü seçilmemiş ${unresolved.length} satır varsayılan ürünle (${defaultItem.name}; ${defaultItem.source === "CUSTOMER" ? "müşteri varsayılanı" : "fabrika varsayılanı"}) girildi.`);
  // Sayfa kapısı: "1/2" beyanı varsa her sayfanın taraması olmalı (yalnız taramalı belgede; elle/Excel'de tarama yok). Gerekçeyle aşılır (tasarım §4).
  if (note.pageCount != null && note.scans.length > 0) {
    const have = new Set(note.scans.map((s) => s.pageNo));
    const missing = Array.from({ length: note.pageCount }, (_, i) => i + 1).filter((p) => !have.has(p));
    if (missing.length && !reason) throw AppError.conflict(`Belge ${note.pageCount} sayfa beyan ediyor; eksik sayfa: ${missing.join(", ")}. Eksik sayfayı tarayın ya da gerekçe (varianceReason) verin.`, { code: "DELIVERY_NOTE_PAGES_MISSING", missing });
    if (missing.length) warnings.push(`Eksik sayfa gerekçeyle geçildi: ${missing.join(", ")}.`);
  }
  const mismatches = totalMismatches(note, note.lines);
  if (mismatches.length && !reason) {
    throw AppError.conflict(`Toplam uyuşmuyor: ${mismatches.join(" ")} Geçmek için fark gerekçesi (varianceReason) verin.`, { code: "TOTAL_MISMATCH", mismatches });
  }
  return { warnings, defaultItem };
}

type ProcessChoice = { text: string; valueId: string };

/**
 * İşlem seçimlerini claim'den ÖNCE doğrular (fail-closed 400): değer aktif çeşit değeri (kurşun gramajı, brode deseni…), satır bu belgenin,
 * işlem metni dolu (satırda yoksa başlığınki). Dönen metin sunucudaki metindir — istemci metni sözlüğe girmez.
 */
async function resolveProcessChoices(note: { processText: string | null; lines: ReadonlyArray<{ id: string; processText: string | null }> }, choices: ApproveInput["processChoices"]): Promise<ProcessChoice[]> {
  const out: ProcessChoice[] = [];
  const byKey = new Map<string, string>();
  const checked = new Set<string>();
  for (const c of choices ?? []) {
    const line = c.lineId === null ? null : note.lines.find((l) => l.id === c.lineId);
    if (c.lineId !== null && !line) throw AppError.badRequest("İşlem seçimi bu belgenin satırına ait değil.", { code: "PROCESS_CHOICE_LINE_INVALID" });
    const text = (line?.processText?.trim() || note.processText?.trim()) ?? "";
    if (!text) throw AppError.badRequest("İşlem metni boş satıra işlem seçimi öğretilemez.", { code: "PROCESS_CHOICE_TEXT_EMPTY" });
    // Aynı (katlanmış) metne çelişkili iki seçim: sessizce "son gelen kazanır" yerine 400.
    const key = aliasKey("PROCESS", text);
    const prev = byKey.get(key);
    if (prev && prev !== c.valueId) throw AppError.badRequest("Aynı işlem metnine iki farklı değer seçilmiş (metin başına tek seçim hatırlanır).", { code: "PROCESS_CHOICE_CONFLICT" });
    byKey.set(key, c.valueId);
    if (!checked.has(c.valueId)) await assertProcessChoiceValue(prisma, c.valueId);
    checked.add(c.valueId);
    out.push({ text, valueId: c.valueId });
  }
  return out;
}

/**
 * Sözlük audit yükü: katlanmış OCR metni (rawKey) audit'e GİRMEZ (ham OCR metni kuralı) — uzunluk + sha256 ilk 12.
 * Aynı anahtarın kayıtları özetten eşlenir; metnin kendisi yalnız tabloda.
 */
export function aliasKeyAudit(rawKey: string): { rawKeyLength: number; rawKeyDigest: string } {
  return { rawKeyLength: rawKey.length, rawKeyDigest: createHash("sha256").update(rawKey).digest("hex").slice(0, 12) };
}

type AliasUpsertRow = { id: string; hitCount: number; inserted: boolean; prevTargetId: string | null };

/** Alias öğrenme — onayda çözülmüş (metin → kimlik) eşlemeler sözlüğe; tekrar görülende `hitCount` artar. Best-effort. */
async function learnAliases(note: { senderCustomerId: string | null; senderText: string | null }, lines: LineRow[], userId: string, processChoices: readonly ProcessChoice[] = []): Promise<void> {
  const seen = new Map<string, { scope: DeliveryNoteAliasScope; senderCustomerId: string | null; rawKey: string; targetId: string }>();
  const add = (scope: DeliveryNoteAliasScope, senderCustomerId: string | null, text: string | null, targetId: string | null) => {
    const rawKey = text ? aliasKey(scope, text) : "";
    if (!rawKey || !targetId) return;
    seen.set(`${scope}|${senderCustomerId ?? ""}|${rawKey}`, { scope, senderCustomerId, rawKey, targetId });
  };
  // Gönderen eşlemesi gönderene bağlı değildir (kendisini çözer) → senderCustomerId NULL.
  add("SENDER", null, note.senderText, note.senderCustomerId);
  for (const l of lines) {
    add("ITEM", note.senderCustomerId, l.itemText, l.itemId);
    add("COLOR", note.senderCustomerId, l.colorText, l.colorId);
  }
  // İşlem metni → gramaj çeşidi (H9): yalnız operatörün kabul ettiği/düzelttiği öneri öğrenilir; kalıp kendisi yazmaz.
  for (const c of processChoices) add("PROCESS", note.senderCustomerId, c.text, c.valueId);
  for (const a of seen.values()) await learnAlias(a, userId);
}

export type AliasLearnInput = { scope: DeliveryNoteAliasScope; senderCustomerId: string | null; rawKey: string; targetId: string };

/**
 * Tek anahtar öğrenme — TEK İFADE (E4): eşzamanlı yazarlar aynı anahtarı yazarsa hepsi sayılır, çift satır doğmaz
 * (tekil indeks NULLS NOT DISTINCT; gönderensiz anahtar da tekil). Polimorfik hedef: SON onay kazanır (PROCESS: yalnız aynı özellik içinde).
 * Dışa açık: test_gelen_belge_onay §16b yarışı belirlenimli ölçer. `rawKey` çağıranca katlanmış olmalı (aliasKey).
 */
export async function learnAlias(a: AliasLearnInput, userId: string): Promise<void> {
  // `prevTargetId` yalnız audit içindir (ifadenin anlık görüntüsü; eşzamanlı çakışmada null olabilir — ayak izi, karar değil).
  const [row] = await prisma.$queryRaw<AliasUpsertRow[]>(Prisma.sql`
    WITH prev AS (
      SELECT "targetId" FROM "delivery_note_aliases"
      WHERE "scope" = ${a.scope}::"DeliveryNoteAliasScope" AND "senderCustomerId" IS NOT DISTINCT FROM ${a.senderCustomerId}::uuid AND "rawKey" = ${a.rawKey}
    )
    INSERT INTO "delivery_note_aliases" ("id", "scope", "senderCustomerId", "rawKey", "targetId", "hitCount", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${a.scope}::"DeliveryNoteAliasScope", ${a.senderCustomerId}::uuid, ${a.rawKey}, ${a.targetId}::uuid, 1, now(), now()) -- tz-ok: kolonlar timestamptz; ham INSERT Prisma'nın @default/@updatedAt kancasını atlar
    ON CONFLICT ("scope", "senderCustomerId", "rawKey") DO UPDATE
      SET "targetId" = EXCLUDED."targetId", "hitCount" = "delivery_note_aliases"."hitCount" + 1, "updatedAt" = now() -- tz-ok: kolon timestamptz; ham UPDATE @updatedAt kancasını atlar
      -- PROCESS sözlüğü metin başına tek hedef: başka ÖZELLİĞİN öğrenmesini (ör. düzeltilmiş kurşun gramajı) ezmez, korur.
      WHERE "delivery_note_aliases"."scope" <> 'PROCESS'::"DeliveryNoteAliasScope"
         OR NOT EXISTS (SELECT 1 FROM "fabric_property_values" o WHERE o."id" = "delivery_note_aliases"."targetId")
         OR (SELECT o."propertyId" FROM "fabric_property_values" o WHERE o."id" = "delivery_note_aliases"."targetId")
            = (SELECT n."propertyId" FROM "fabric_property_values" n WHERE n."id" = EXCLUDED."targetId")
    RETURNING "id", "hitCount", (xmax = 0) AS "inserted", (SELECT "targetId" FROM prev) AS "prevTargetId"`);
  if (!row) return; // PROCESS: mevcut öğrenme başka özelliğin → korundu, yazım yok
  const key = aliasKeyAudit(a.rawKey);
  if (row.inserted) {
    await AuditService.log({ userId, action: "CREATE", tableName: ALIAS_TABLE, recordId: row.id, newData: { scope: a.scope, senderCustomerId: a.senderCustomerId, ...key, targetId: a.targetId, hitCount: row.hitCount } });
  } else {
    await AuditService.log({ userId, action: "UPDATE", tableName: ALIAS_TABLE, recordId: row.id, oldData: { targetId: row.prevTargetId, hitCount: row.hitCount - 1 }, newData: { scope: a.scope, ...key, targetId: a.targetId, hitCount: row.hitCount } });
  }
}

/** Başlık claim — ön kontrol görüntüsüne (`snap`) bağlı; count 0 → 409 (CHANGED ya da NOT_APPROVABLE). */
async function claimHeader(id: string, snap: { status: DeliveryNoteStatus; updatedAt: Date }, userId: string, varianceReason: string | undefined): Promise<void> {
  // ── Başlık claim: DRAFT|PARTIAL (ya da bayat APPROVING — süreç ölümü) → APPROVING. count 0 → 409.
  // `updatedAt` eşitliği ön kontrolün anlık görüntüsünü bağlar: başlık PATCH'i ya da satır yazımı (claimDraft başlığı
  // tazeler) arada olduysa claim düşer → sahip/toplam ESKİ görüntüyle top doğurmaz.
  const claim = await prisma.customerDeliveryNote.updateMany({
    where: {
      id,
      updatedAt: snap.updatedAt,
      OR: [
        { status: { in: [DeliveryNoteStatus.DRAFT, DeliveryNoteStatus.PARTIAL] } },
        { status: DeliveryNoteStatus.APPROVING, updatedAt: { lt: new Date(Date.now() - STALE_APPROVING_MS) } },
      ],
    },
    data: { status: DeliveryNoteStatus.APPROVING, updatedById: userId, ...(varianceReason ? { varianceReason } : {}) },
  });
  if (claim.count === 0) {
    const cur = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { status: true, noteNo: true } });
    if (cur && cur.status === snap.status && cur.status !== DeliveryNoteStatus.APPROVING) {
      throw AppError.conflict(`${cur.noteNo} ön kontrolden sonra değişti (başlık ya da satır düzenlendi); yeniden deneyin.`, { code: "DELIVERY_NOTE_CHANGED", status: cur.status });
    }
    throw AppError.conflict(`${cur?.noteNo ?? id} şu an onaylanamaz (${cur?.status ?? "?"}): başka bir onay sürüyor ya da belge kapanmış.`, { code: "DELIVERY_NOTE_NOT_APPROVABLE", status: cur?.status ?? null });
  }
}

/**
 * ONAY — `POST /api/gelen-belge/irsaliyeler/:id/onay` (`gelen-belge:approve`).
 * Sıra: ön kontrol (yazmaz) → başlık claim DRAFT|PARTIAL → APPROVING → satır claim PENDING|FAILED → ENTERING →
 * satır satır `createInitialEntry` → satır ENTERED/FAILED → başlık APPROVED|PARTIAL → alias öğrenme → audit.
 */
export async function approveDeliveryNote(id: string, input: ApproveInput, userId: string): Promise<ApproveResult> {
  const note = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: PRE_SELECT });
  if (!note) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  const { warnings, defaultItem } = await precheck(note, input);
  const processChoices = await resolveProcessChoices(note, input.processChoices);
  const varianceReason = input.varianceReason?.trim() || undefined;

  await claimHeader(id, note, userId, varianceReason);
  await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: id, oldData: { status: note.status }, newData: { status: "APPROVING", noteNo: note.noteNo, ...(varianceReason ? { varianceReason } : {}) } });

  // ── Satır claim: yalnız topsuz satır (PENDING|FAILED; bayat ENTERING de alınır — token replay korur).
  await prisma.customerDeliveryNoteLine.updateMany({
    where: { noteId: id, rollId: null, status: { in: [DeliveryNoteLineStatus.PENDING, DeliveryNoteLineStatus.FAILED, DeliveryNoteLineStatus.ENTERING] } },
    data: { status: DeliveryNoteLineStatus.ENTERING, failReason: null },
  });
  const lines: LineRow[] = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: id, status: DeliveryNoteLineStatus.ENTERING, rollId: null }, select: PRE_SELECT.lines.select, orderBy: [{ blockNo: "asc" }, { lineNo: "asc" }] });

  const summary: ApproveResult["summary"] = { entered: 0, failed: 0, skipped: 0, replayed: 0, rollIds: [] };
  const entered: LineRow[] = [];
  let lastBeat = Date.now();
  for (const line of lines) {
    if (Date.now() - lastBeat > HEARTBEAT_MS) {
      // Kalp atışı: `updatedAt` tazelenir → uzun meşru koşum 10 dk bayatlık eşiğinde ikinci onaya devredilmez.
      await prisma.customerDeliveryNote.updateMany({ where: { id, status: DeliveryNoteStatus.APPROVING }, data: { updatedById: userId } });
      lastBeat = Date.now();
    }
    try {
      const res = await inventory.createInitialEntry(
        {
          // Satırın kendi ürünü önce; yoksa ön kontrolün çözdüğü varsayılan (ürünsüz top DOĞMAZ — ikisi de yoksa ön kontrol 400 verdi).
          // Satırın itemId'si BOŞ kalır: operatör ürün seçmedi; alias da öğrenilmez (learnAliases itemId null'u atlar).
          itemId: (line.itemId ?? defaultItem?.id)!,
          colorId: line.colorId,
          initialQty: Number(line.meters),
          weightKg: line.weightKg == null ? undefined : Number(line.weightKg),
          width: line.widthCm == null ? null : Number(line.widthCm),
          clientToken: uuidv5(line.id, LINE_TOKEN_NS),
        },
        userId,
        null,
        false,
        {
          forcedEntrySource: RollEntrySource.SEMI_FINISHED,
          forcedStatus: RollStatus.STOCK,
          ownerCustomerId: note.ownerCustomerId,
          entryReasonCode: INCOMING_DOC_REASON_CODE,
          entryReason: `${note.noteNo} satır ${line.lineNo}`,
          // Kg belgeden gelir; KK1 istasyon politikası (`kk1.weightEntryEnabled`) burada uygulanmaz (mal kabul emsali A1).
          skipKk1WeightPolicy: true,
        },
      );
      const rollId = (res.data as { id: string }).id;
      const bound = await prisma.customerDeliveryNoteLine.updateMany({ where: { id: line.id, status: DeliveryNoteLineStatus.ENTERING }, data: { status: DeliveryNoteLineStatus.ENTERED, rollId, failReason: null } });
      // Bağlamayı başka koşum yaptıysa (bayat devralma yarışı) ayak izi ikinci kez yazılmaz.
      if (bound.count === 1) {
        if (res.idempotent) summary.replayed++;
        else summary.entered++;
        summary.rollIds.push(rollId);
        entered.push(line);
        await AuditService.log({ userId, action: "UPDATE", tableName: LINE_TABLE, recordId: line.id, oldData: { status: line.status }, newData: { status: "ENTERED", rollId, lineNo: line.lineNo, noteNo: note.noteNo, ...(res.idempotent ? { replayed: true } : {}), ...(!line.itemId && defaultItem ? { defaultItemId: defaultItem.id, defaultItemSource: defaultItem.source } : {}) } });
      }
    } catch (err) {
      const failReason = (err instanceof Error ? err.message : "Bilinmeyen hata").slice(0, 500);
      await prisma.customerDeliveryNoteLine.updateMany({ where: { id: line.id, status: DeliveryNoteLineStatus.ENTERING }, data: { status: DeliveryNoteLineStatus.FAILED, failReason } });
      summary.failed++;
      await AuditService.log({ userId, action: "UPDATE", tableName: LINE_TABLE, recordId: line.id, oldData: { status: line.status }, newData: { status: "FAILED", failReason, lineNo: line.lineNo, noteNo: note.noteNo } });
    }
  }

  // ── Başlık kapanışı: topsuz canlı satır kaldıysa PARTIAL, yoksa APPROVED (yalnız APPROVING'den).
  const remaining = await prisma.customerDeliveryNoteLine.count({ where: { noteId: id, rollId: null, status: { not: DeliveryNoteLineStatus.SKIPPED } } });
  summary.skipped = await prisma.customerDeliveryNoteLine.count({ where: { noteId: id, status: DeliveryNoteLineStatus.SKIPPED } });
  const finalStatus = remaining === 0 ? DeliveryNoteStatus.APPROVED : DeliveryNoteStatus.PARTIAL;
  await prisma.customerDeliveryNote.updateMany({
    where: { id, status: DeliveryNoteStatus.APPROVING },
    data: { status: finalStatus, updatedById: userId, ...(finalStatus === "APPROVED" ? { approvedAt: new Date(), approvedById: userId } : {}) },
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: id, oldData: { status: "APPROVING" }, newData: { status: finalStatus, noteNo: note.noteNo, entered: summary.entered, failed: summary.failed, replayed: summary.replayed, ...(defaultItem ? { defaultItemId: defaultItem.id, defaultItemSource: defaultItem.source } : {}) } });
  // Alias öğrenme tx DIŞINDA ve best-effort: sözlük istatistiktir, top doğumunu geciktirmez/geri sarmaz.
  if (entered.length) await learnAliases(note, entered, userId, processChoices).catch(() => undefined);

  return { note: await getDeliveryNote(id), summary, warnings };
}

/** Bekçi/okuyucu için: satırın top token'ı (belirlenimli). */
export const lineRollToken = (lineId: string): string => uuidv5(lineId, LINE_TOKEN_NS);
