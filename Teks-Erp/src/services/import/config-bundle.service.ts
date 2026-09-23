// =============================================================================
// YAPILANDIRMA PAKETİ — kurulumlar arası tanım taşıma (JSON)
// =============================================================================
// Tasarım: docs/design/IMPORT-EXPORT-TASARIM.md §3c
//
// Amaç: "bu fabrikada kurduğum etiket/kart/belge/rol düzenini demoya (ya da
// ikinci bir kuruluma) taşı". Ana veri (kumaş/müşteri) içe aktarımından AYRI
// bir iştir: burada taşınan şey KAYIT değil YAPILANDIRMA'dır.
//
// ⚠️ KİMLİK: pakette hiçbir UUID taşınmaz — her nesne kendi İŞ ANAHTARIYLA
// (ad/kod) tanınır. UUID taşımak, hedef kurulumda var olmayan bir id'ye bağlı
// "yarım" nesneler üretirdi.
//
// ⚠️ YETKİ ANAHTAR-KAPSAMLIDIR (feature-flags guard'ının birebir dersi):
// pakette hangi tür varsa YALNIZ onun izni aranır; düz bir OR (ya da tek bir
// admin izni) "belge şablonu taşıyorum" diyen birine rol şablonlarını da
// yazdırırdı. FAIL-CLOSED: tanınmayan tür → 400.
//
// ⚠️ İÇE AKTARIMDA DA SANITIZE: şablon HTML'leri kayıt yolunda temizlenir
// (`sanitizeTemplateHtml`) — dosya elle düzenlenip script sızdırılamasın.

import type { NumberSeries } from "@prisma/client";

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { travelerTemplateService } from "../traveler-template.service";
import { documentProfileService } from "../document-profile.service";
import { freeDocumentService } from "../free-document.service";
import { LabelTemplateService } from "../label-template.service";
import { PermissionManagementService } from "../permission-management.service";
import { upperTr } from "../../utils/tr-case";
import { NUMBER_SERIES_CATALOG } from "../../constants/number-series-catalog";
import { previewSeriesCode, resolveSeriesFormat } from "../number-series.service";
import {
  assertSeriesFormatAllowed,
  assertSeriesFormatWritable,
  updateSeriesFormat,
  updateSeriesNumberSource,
} from "../helpers/series-write.helper";

/** Paketin taşıyabileceği tür anahtarları. */
export const BUNDLE_KINDS = [
  "LABEL_TEMPLATE",
  "TRAVELER_TEMPLATE",
  "DOCUMENT_PROFILE",
  "FREE_DOCUMENT",
  "PERMISSION_TEMPLATE",
  "NUMBER_SERIES",
] as const;

export type BundleKind = (typeof BUNDLE_KINDS)[number];

/** Tür → gereken izin. Anahtar-kapsamlı guard bunu okur. */
export const BUNDLE_PERMISSIONS: Record<BundleKind, { read: string; write: string }> = {
  LABEL_TEMPLATE: { read: "label-template:read", write: "label-template:write" },
  TRAVELER_TEMPLATE: { read: "document-template:read", write: "document-template:write" },
  DOCUMENT_PROFILE: { read: "document-template:read", write: "document-template:write" },
  FREE_DOCUMENT: { read: "document-template:read", write: "document-template:write" },
  // Rol şablonu bir YETKİ nesnesidir — belge tasarımıyla aynı kapıdan geçmemeli.
  PERMISSION_TEMPLATE: { read: "admin:users", write: "admin:users" },
  // Numara biçimi bir AYAR nesnesidir; belge tasarımıyla aynı kapıdan geçmez.
  // ⚠️ Yazma ayrıca AYAR ŞİFRESİ ister — kapı `config-bundle.routes.ts`te ve
  // İÇERİĞE BAĞLIDIR (paket bu türü taşımıyorsa şifre sorulmaz).
  NUMBER_SERIES: { read: "settings:numbering", write: "settings:numbering" },
};

export const BUNDLE_LABELS: Record<BundleKind, string> = {
  LABEL_TEMPLATE: "Etiket şablonları",
  TRAVELER_TEMPLATE: "Refakat kartı şablonları",
  DOCUMENT_PROFILE: "Belge profilleri",
  FREE_DOCUMENT: "Serbest belgeler",
  PERMISSION_TEMPLATE: "Yetki şablonları (roller)",
  NUMBER_SERIES: "Numara serileri",
};

export type ConflictStrategy = "rename" | "overwrite" | "skip";

export interface BundleEnvelope {
  /** Biçim sürümü — ileride alan eklenirse eski paket yine okunabilsin. */
  schemaVersion: 1;
  app: "TeksERP";
  exportedAt: string;
  /** Kaynak kurulumun adı (bilgi amaçlı; içe aktarımda kullanılmaz). */
  source?: string;
  items: BundleItem[];
  /**
   * PAKETİN TAŞIMADIKLARI — beyanlı (D6).
   *
   * ⚠️ "Yok" ile "bilerek dışarıda" aynı şey değildir. Hedefteki bir yönetici
   * paketi uygulayıp sayacın değişmediğini görünce, bunun bir EKSİKLİK mi yoksa
   * bir KARAR mı olduğunu pakete bakarak anlayabilmeli. Alan OPSİYONEL: eski
   * paketler bunu taşımaz ve okunmaya devam eder.
   */
  excluded?: string[];
}

export interface BundleItem {
  kind: BundleKind;
  /** İş anahtarı — ad (ya da kod). Hedefte eşleşme bununla kurulur. */
  key: string;
  payload: Record<string, unknown>;
}

export interface BundlePlanRow {
  kind: BundleKind;
  key: string;
  action: "CREATE" | "OVERWRITE" | "RENAME" | "SKIP" | "ERROR";
  /** RENAME'de hedefte kullanılacak yeni ad. */
  newKey?: string;
  message?: string;
}

export interface BundlePlan {
  rows: BundlePlanRow[];
  summary: Record<string, number>;
  kinds: BundleKind[];
}

const labelTemplateService = new LabelTemplateService();

function assertKind(k: string): BundleKind {
  if (!(BUNDLE_KINDS as readonly string[]).includes(k)) {
    throw AppError.badRequest(`Bilinmeyen yapılandırma türü: '${k}'`);
  }
  return k as BundleKind;
}

// =============================================================================
// DIŞA AKTARIM
/**
 * Numara serisi paketinin TAŞIMADIKLARI — beyanlı ve gerekçeli.
 *
 * ⚠️ "Yok" ile "bilerek dışarıda" aynı şey değildir: hedefteki yönetici paketi
 * uygulayıp sayacın değişmediğini görünce, bunun bir EKSİKLİK mi yoksa bir
 * KARAR mı olduğunu pakete bakarak anlayabilmeli.
 */
const NUMBER_SERIES_EXCLUSIONS = [
  "Sayaç ayarları (başlangıç · adım · üst sınır): hedefteki MEVCUT kodların " +
    "maksimumuna göre anlam taşır; kaynak kurulumun başlangıç değeri hedefte " +
    "ya mükerrer kod ya da boşluk üretirdi.",
  "İleri tarihli biçim geçişleri: bir tarihe bağlı karar hedef kurulumun KENDİ planıdır.",
  "Emekli biçimler: hedefin geçmişi kendi zaman çizgisinde yaşar, kaynağınki oraya taşınmaz.",
];

/** Katalogdaki her serinin BUGÜNKÜ biçimi + numara kaynağı (sayaç HARİÇ). */
function numberSeriesItems(): BundleItem[] {
  return NUMBER_SERIES_CATALOG.map((e) => {
    const fmt = resolveSeriesFormat(e.key);
    return {
      kind: "NUMBER_SERIES" as const,
      key: e.key,
      payload: {
        label: e.label,
        prefix: fmt.prefix,
        dateSegment: fmt.dateSegment,
        digits: fmt.digits,
        separator: fmt.separator,
        separator2: fmt.separator2 ?? null,
        // İŞ SÜRECİ kararıdır (elle numara girilebilir mi) — taşınır.
        numberSource: fmt.numberSource ?? "FREE",
      },
    };
  });
}

// =============================================================================

export async function exportBundle(kinds: BundleKind[]): Promise<BundleEnvelope> {
  const items: BundleItem[] = [];

  if (kinds.includes("LABEL_TEMPLATE")) {
    const rows = await prisma.labelTemplate.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    for (const r of rows) {
      const env = await labelTemplateService.exportTemplate(r.id);
      items.push({ kind: "LABEL_TEMPLATE", key: r.name, payload: env.data as unknown as Record<string, unknown> });
    }
  }

  if (kinds.includes("TRAVELER_TEMPLATE")) {
    const rows = await prisma.travelerCardTemplate.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { name: true, mode: true, config: true, html: true, isActive: true, isDefault: true },
    });
    for (const r of rows) items.push({ kind: "TRAVELER_TEMPLATE", key: r.name, payload: { ...r } });
  }

  if (kinds.includes("DOCUMENT_PROFILE")) {
    const rows = await prisma.documentProfile.findMany({
      orderBy: { name: "asc" },
      select: { name: true, description: true, config: true, isActive: true },
    });
    for (const r of rows) items.push({ kind: "DOCUMENT_PROFILE", key: r.name, payload: { ...r } });
  }

  if (kinds.includes("FREE_DOCUMENT")) {
    const rows = await prisma.freeDocument.findMany({
      orderBy: { title: "asc" },
      select: { title: true, recipient: true, body: true, config: true, isActive: true },
    });
    for (const r of rows) items.push({ kind: "FREE_DOCUMENT", key: r.title, payload: { ...r } });
  }

  if (kinds.includes("PERMISSION_TEMPLATE")) {
    const rows = await prisma.permissionTemplate.findMany({
      orderBy: { name: "asc" },
      include: { permissions: { include: { permission: { select: { code: true } } } } },
    });
    for (const r of rows) {
      items.push({
        kind: "PERMISSION_TEMPLATE",
        key: r.name,
        payload: {
          name: r.name,
          code: r.code,
          description: r.description,
          isActive: r.isActive,
          // ⚠️ İZİN KODLARI taşınır, id'ler DEĞİL: hedef kurulumda aynı iznin
          // id'si farklıdır. Katalogda olmayan kod içe aktarımda HATA verir.
          permissionCodes: r.permissions.map((p) => p.permission.code).sort(),
        },
      });
    }
  }

  const excluded = kinds.includes("NUMBER_SERIES") ? NUMBER_SERIES_EXCLUSIONS : [];
  if (kinds.includes("NUMBER_SERIES")) items.push(...numberSeriesItems());

  return {
    schemaVersion: 1,
    app: "TeksERP",
    exportedAt: new Date().toISOString(),
    items,
    ...(excluded.length > 0 ? { excluded } : {}),
  };
}

// =============================================================================
// ÖNİZLEME + UYGULAMA
// =============================================================================

/** Paketin taşıdığı türler (yetki guard'ı bunu okur). */
export function kindsInBundle(envelope: BundleEnvelope): BundleKind[] {
  const set = new Set<BundleKind>();
  for (const it of envelope.items ?? []) set.add(assertKind(it.kind));
  return [...set];
}

export function validateEnvelope(raw: unknown): BundleEnvelope {
  const env = raw as BundleEnvelope;
  if (!env || typeof env !== "object") throw AppError.badRequest("Geçersiz paket dosyası.");
  if (env.app !== "TeksERP") throw AppError.badRequest("Bu dosya bir TeksERP yapılandırma paketi değil.");
  if (env.schemaVersion !== 1) {
    throw AppError.badRequest(
      `Paket sürümü desteklenmiyor (${String(env.schemaVersion)}). Bu sürüm yalnız 1 numaralı paketi okur.`,
    );
  }
  if (!Array.isArray(env.items)) throw AppError.badRequest("Paket içeriği (items) yok.");
  for (const it of env.items) {
    assertKind(it.kind);
    if (!it.key || typeof it.key !== "string") throw AppError.badRequest("Paket öğesinde anahtar (key) yok.");
  }
  return env;
}

/** Hedefteki mevcut anahtarlar (tür bazlı). */
async function existingKeys(kind: BundleKind): Promise<Set<string>> {
  const norm = (s: string): string => upperTr(s.trim());
  switch (kind) {
    case "LABEL_TEMPLATE": {
      const rows = await prisma.labelTemplate.findMany({ where: { deletedAt: null }, select: { name: true } });
      return new Set(rows.map((r) => norm(r.name)));
    }
    case "TRAVELER_TEMPLATE": {
      const rows = await prisma.travelerCardTemplate.findMany({ where: { deletedAt: null }, select: { name: true } });
      return new Set(rows.map((r) => norm(r.name)));
    }
    case "DOCUMENT_PROFILE": {
      const rows = await prisma.documentProfile.findMany({ select: { name: true } });
      return new Set(rows.map((r) => norm(r.name)));
    }
    case "FREE_DOCUMENT": {
      const rows = await prisma.freeDocument.findMany({ select: { title: true } });
      return new Set(rows.map((r) => norm(r.title)));
    }
    case "PERMISSION_TEMPLATE": {
      const rows = await prisma.permissionTemplate.findMany({ select: { name: true } });
      return new Set(rows.map((r) => norm(r.name)));
    }
    case "NUMBER_SERIES":
      // ⚠️ Bu tür GENEL plan yoluna hiç girmez (`planNumberSeries` onu önce
      // alır) ama switch TAM kalmak zorunda: derleyici yeni bir tür eklendiğinde
      // burayı göstersin diye. Yine de doğru cevabı döndürüyoruz — seri kimliği
      // KATALOGDADIR, DB'de değil; "hedefte var mı" sorusunun cevabı budur.
      return new Set(NUMBER_SERIES_CATALOG.map((e) => norm(e.key)));
  }
}

/** "X (2)", "X (3)" … — hedefte boş olan ilk adı bulur. */
function nextFreeName(base: string, taken: Set<string>): string {
  const norm = (s: string): string => upperTr(s.trim());
  for (let i = 2; i < 100; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(norm(candidate))) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/** Numara kaynağının ekran adı — önizleme cümlesi buradan kurulur. */
const NUMBER_SOURCE_LABELS: Record<string, string> = {
  FREE: "Serbest",
  SYSTEM: "Yalnız sistem üretir",
  MANUAL: "Yalnız elle girilir",
};

/** Paketteki numara serisi kaleminin hedefteki karşılığı — tek yerde okunur. */
function numberSeriesPayload(item: BundleItem): {
  prefix: string;
  dateSegment: NumberSeries["dateSegment"];
  digits: number;
  separator: string;
  separator2: string | null;
  numberSource: "FREE" | "SYSTEM" | "MANUAL";
} {
  const p = item.payload;
  return {
    prefix: String(p.prefix ?? ""),
    dateSegment: p.dateSegment as NumberSeries["dateSegment"],
    digits: Number(p.digits ?? 4),
    separator: String(p.separator ?? ""),
    separator2: p.separator2 == null ? null : String(p.separator2),
    numberSource: (p.numberSource as "FREE" | "SYSTEM" | "MANUAL" | undefined) ?? "FREE",
  };
}

/**
 * Paketteki kalem ile HEDEFİN bugünkü hâlinin FARKI — tek yüklem, iki çağıran.
 *
 * ⚠️ Önizleme ile yazma bu soruyu AYRI AYRI cevaplasaydı ("biçim değişti mi")
 * bir gün ayrışırlardı: önizleme "değişecek" der, yazma dokunmaz (ya da tersi).
 * Aynı sınıf `assertSeriesFormatWritable`ın ayrılma gerekçesiyle özdeş.
 */
function numberSeriesDiff(item: BundleItem): {
  next: ReturnType<typeof numberSeriesPayload>;
  current: ReturnType<typeof resolveSeriesFormat>;
  formatSame: boolean;
  sourceSame: boolean;
} {
  const next = numberSeriesPayload(item);
  const current = resolveSeriesFormat(item.key);
  return {
    next,
    current,
    formatSame:
      current.prefix === next.prefix &&
      current.dateSegment === next.dateSegment &&
      current.digits === next.digits &&
      current.separator === next.separator &&
      (current.separator2 ?? null) === next.separator2,
    sourceSame: (current.numberSource ?? "FREE") === next.numberSource,
  };
}

/** Önizleme cümlesi — ÖNCESİ → SONRASI, satır satır. */
function numberSeriesMessage(label: string, d: ReturnType<typeof numberSeriesDiff>): string {
  const parts: string[] = [];
  if (!d.formatSame) {
    parts.push(
      `${previewSeriesCode(d.current)} → ` +
        `${previewSeriesCode({ ...d.current, ...d.next, separator2: d.next.separator2 })}`,
    );
  }
  if (!d.sourceSame) {
    parts.push(
      `numara girişi: ${NUMBER_SOURCE_LABELS[d.current.numberSource ?? "FREE"]} → ` +
        `${NUMBER_SOURCE_LABELS[d.next.numberSource]}`,
    );
  }
  return `${label}: ${parts.join(" · ")}`;
}

/**
 * ⚠️ HAM DB YAZIMI YOK — panelin çağırdığı YAZARIN TA KENDİSİ çağrılır.
 *
 * Biçim değişimi hedefte CANLI numaralandırmayı değiştirir ve yapısal kilit ·
 * sayaç kapsamı · eski istemci (C0b) · kolon kapasitesi · ön ek çakışması ·
 * ZAMAN ÇİZGİSİNE SATIR YAZMA hepsi orada yaşar. Kapıları atlayan bir "içe
 * aktarım modu" yazılmadı ve yazılmamalı: tam olarak bu kapılar, sahadaki
 * barkodun okunamaz hâle gelmesini engelliyor.
 */
async function writeNumberSeries(item: BundleItem, userId?: string): Promise<void> {
  const d = numberSeriesDiff(item);
  if (!d.formatSame) {
    await updateSeriesFormat(
      item.key,
      {
        prefix: d.next.prefix,
        dateSegment: d.next.dateSegment,
        digits: d.next.digits,
        separator: d.next.separator,
        separator2: d.next.separator2,
      },
      userId,
    );
  }
  if (!d.sourceSame) {
    await updateSeriesNumberSource(item.key, d.next.numberSource, userId);
  }
}

/**
 * NUMARA SERİSİ PLANI — genel (ad eşleşmeli) yoldan AYRI, çünkü kimlik farklı.
 *
 * ⚠️ `rename` BU TÜRDE ANLAMSIZDIR: seri kimliği katalog `key`idir (`sack`,
 * `shipment`…), hedefte zaten VARDIR ve "sack (2)" diye bir seri yaratılamaz.
 * `LABEL_TEMPLATE`ın ters yöndeki emsaliyle aynı dürüstlük: desteklenmeyen
 * strateji SESSİZCE başka bir şey yapmaz, ne yaptığını SÖYLER.
 *
 * ⚠️ KAPILAR BURADA KURU KOŞULUR: yazma yolunun çağırdığı ile BİREBİR aynı iki
 * yüklem (`assertSeriesFormatWritable` + `assertSeriesFormatAllowed`). Önizleme
 * kendi kontrol listesini tutsaydı "uygulanacak" deyip 400 alan bir paket
 * üretirdi — ya da tersi, ki daha kötü: kullanıcı engeli görmeden onaylar.
 */
function planNumberSeries(item: BundleItem, onConflict: ConflictStrategy): BundlePlanRow {
  const base = { kind: "NUMBER_SERIES" as const, key: item.key };
  const entry = NUMBER_SERIES_CATALOG.find((e) => e.key === item.key);
  if (!entry) {
    return { ...base, action: "SKIP", message: "Bu kurulumda böyle bir numara serisi yok — atlandı." };
  }
  if (onConflict === "rename") {
    return {
      ...base,
      action: "SKIP",
      message: "Numara serisi yeniden adlandırılamaz (kimlik katalogdadır); atlandı.",
    };
  }

  const d = numberSeriesDiff(item);
  if (d.formatSame && d.sourceSame) {
    return { ...base, action: "SKIP", message: `${entry.label}: hedefteki ayar zaten aynı.` };
  }
  if (onConflict === "skip") {
    return { ...base, action: "SKIP", message: `${entry.label}: hedefte farklı bir ayar var — atlandı.` };
  }

  // KURU KOŞUM — yazma yolunun kapıları, yazmadan.
  try {
    if (!d.formatSame) {
      assertSeriesFormatWritable(item.key);
      const retired =
        d.current.prefix === d.next.prefix
          ? d.current.retiredPrefixes
          : [...new Set([...d.current.retiredPrefixes, d.current.prefix])];
      assertSeriesFormatAllowed(item.key, { ...d.next, retiredPrefixes: retired });
    }
  } catch (e) {
    return { ...base, action: "ERROR", message: e instanceof Error ? e.message : "Uygulanamaz." };
  }

  // ⚠️ ÖNCESİ → SONRASI, SATIR SATIR: kullanıcı neyi değiştirdiğini GÖREREK
  // onaylar. Soyut bir "3 seri güncellenecek" cümlesi, bu depoda yıkıcı
  // işlemlerde açıkça yasaklanmış olan şeydir.
  return { ...base, action: "OVERWRITE", message: numberSeriesMessage(entry.label, d) };
}

export async function planBundle(
  envelope: BundleEnvelope,
  onConflict: ConflictStrategy,
): Promise<BundlePlan> {
  const kinds = kindsInBundle(envelope);
  const taken = new Map<BundleKind, Set<string>>();
  for (const k of kinds) taken.set(k, await existingKeys(k));

  const rows: BundlePlanRow[] = [];
  for (const item of envelope.items) {
    const kind = assertKind(item.kind);
    // Kimliği KATALOGDA olan tür, ad eşleşmeli genel yoldan geçmez.
    if (kind === "NUMBER_SERIES") {
      rows.push(planNumberSeries(item, onConflict));
      continue;
    }
    const set = taken.get(kind)!;
    const exists = set.has(upperTr(item.key.trim()));

    if (!exists) {
      rows.push({ kind, key: item.key, action: "CREATE" });
      set.add(upperTr(item.key.trim()));
      continue;
    }
    if (onConflict === "skip") {
      rows.push({ kind, key: item.key, action: "SKIP", message: "Hedefte aynı adlı kayıt var — atlanacak." });
      continue;
    }
    if (onConflict === "overwrite") {
      rows.push({
        kind,
        key: item.key,
        action: "OVERWRITE",
        message: "Hedefteki aynı adlı kaydın İÇERİĞİ değişecek.",
      });
      continue;
    }
    const newKey = nextFreeName(item.key, set);
    set.add(upperTr(newKey.trim()));
    rows.push({ kind, key: item.key, action: "RENAME", newKey, message: `Yeni ad: ${newKey}` });
  }

  const summary: Record<string, number> = {};
  for (const r of rows) summary[r.action] = (summary[r.action] ?? 0) + 1;
  return { rows, summary, kinds };
}

export async function applyBundle(
  envelope: BundleEnvelope,
  onConflict: ConflictStrategy,
  userId?: string,
): Promise<BundlePlan & { applied: number; failed: number }> {
  // Plan SIFIRDAN yeniden hesaplanır — istemcinin gönderdiği plana güvenilmez
  // (ana veri içe aktarımıyla aynı kural).
  const plan = await planBundle(envelope, onConflict);
  let applied = 0;
  let failed = 0;

  for (let i = 0; i < envelope.items.length; i++) {
    const item = envelope.items[i]!;
    const row = plan.rows[i]!;
    if (row.action === "SKIP" || row.action === "ERROR") continue;
    try {
      await writeItem(item, row, userId);
      applied++;
    } catch (e) {
      failed++;
      row.action = "ERROR";
      row.message = e instanceof Error ? e.message : "Yazılamadı.";
    }
  }

  await AuditService.logEvent({
    category: "SYSTEM",
    action: "CONFIG_BUNDLE_IMPORT",
    userId: userId ?? null,
    payload: { kinds: plan.kinds, applied, failed, onConflict, total: envelope.items.length },
  });

  return { ...plan, applied, failed };
}

async function writeItem(item: BundleItem, row: BundlePlanRow, userId?: string): Promise<void> {
  const name = row.newKey ?? item.key;
  const p = item.payload;

  switch (assertKind(item.kind)) {
    case "NUMBER_SERIES":
      await writeNumberSeries(item, userId);
      return;
    case "LABEL_TEMPLATE": {
      // Mevcut importTemplate zarfı ad çakışmasını KENDİ dedup'lar; overwrite
      // istendiğinde önce eskisini pasifleştirmek yerine aynı adı koruyup
      // içeriği yazmak gerekir — bugünkü servis bunu desteklemediği için
      // OVERWRITE burada RENAME gibi davranır ve mesajda söylenir.
      const env = { ...(p as Record<string, unknown>) };
      const tpl = env.template as Record<string, unknown> | undefined;
      if (tpl) tpl.name = name;
      await labelTemplateService.importTemplate(env as never, userId);
      if (row.action === "OVERWRITE") {
        row.message = "Etiket şablonunda üzerine yazma desteklenmiyor — yeni ad ile eklendi.";
      }
      return;
    }
    case "TRAVELER_TEMPLATE": {
      const existing = await prisma.travelerCardTemplate.findFirst({
        where: { name, deletedAt: null },
        select: { id: true },
      });
      const input = {
        name,
        mode: p.mode as never,
        config: p.config,
        html: (p.html as string | null) ?? null,
        isActive: p.isActive !== false,
        // ⚠️ `isDefault` TAŞINMAZ: hedef kurulumun varsayılanını sessizce
        // değiştirmek, oradaki tüm kartların görünümünü değiştirmek demektir.
        isDefault: false,
      };
      if (existing && row.action === "OVERWRITE") {
        await travelerTemplateService.update(existing.id, input, userId);
      } else {
        await travelerTemplateService.create(input, userId);
      }
      return;
    }
    case "DOCUMENT_PROFILE": {
      const existing = await prisma.documentProfile.findFirst({ where: { name }, select: { id: true } });
      const input = {
        name,
        description: (p.description as string | null) ?? null,
        config: p.config,
        isActive: p.isActive !== false,
      };
      if (existing && row.action === "OVERWRITE") {
        await documentProfileService.update(existing.id, input, userId);
      } else {
        await documentProfileService.create(input, userId);
      }
      return;
    }
    case "FREE_DOCUMENT": {
      const existing = await prisma.freeDocument.findFirst({ where: { title: name }, select: { id: true } });
      const input = {
        title: name,
        recipient: (p.recipient as string | null) ?? null,
        body: (p.body as string) ?? "",
        config: p.config,
        isActive: p.isActive !== false,
      };
      if (existing && row.action === "OVERWRITE") {
        await freeDocumentService.update(existing.id, input, userId);
      } else {
        await freeDocumentService.create(input, userId);
      }
      return;
    }
    case "PERMISSION_TEMPLATE": {
      const codes = Array.isArray(p.permissionCodes) ? (p.permissionCodes as string[]) : [];
      if (codes.length === 0) throw new Error("Şablon en az bir yetki içermeli.");
      const perms = await prisma.permission.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true },
      });
      const missing = codes.filter((c) => !perms.some((x) => x.code === c));
      if (missing.length > 0) {
        // Katalogda olmayan kod → HATA. Sessizce atlamak, hedefte EKSİK
        // yetkili bir rol doğururdu ve bunu kimse fark etmezdi.
        throw new Error(`Bu kurulumda tanımlı olmayan yetki kodu: ${missing.join(", ")}`);
      }
      const existing = await prisma.permissionTemplate.findFirst({ where: { name }, select: { id: true } });
      if (existing && row.action === "OVERWRITE") {
        await PermissionManagementService.updateTemplate(
          existing.id,
          { name, description: (p.description as string | null) ?? null, permissionIds: perms.map((x) => x.id) },
          userId,
        );
      } else {
        await PermissionManagementService.createTemplate(
          { name, description: (p.description as string | null) ?? null, permissionIds: perms.map((x) => x.id) },
          userId,
        );
      }
      // ⚠️ ATAMALAR TAŞINMAZ: kim hangi rolü taşıyor sorusu kuruluma özgüdür
      // (bir fabrikada planlamacı Ahmet, diğerinde Mehmet). "Katalog koda,
      // atama panele" kuralının paket karşılığı.
      return;
    }
  }
}
