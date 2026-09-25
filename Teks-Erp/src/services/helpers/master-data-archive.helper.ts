// =============================================================================
// ANA VERİ ARŞİV KAPISI — renk · kumaş özelliği · müşteri · depo · fasoncu
// =============================================================================
// URUN-YASAM-DONGUSU.md §6: canlı referansı olan ana veri pasife ALINAMAZ (409 +
// kayıtlar tek tek); çıkış yolu açık kayıtları kapatmak ya da birleştirmek. Uyarı kapı
// değildir (bugünkü "uyar ama bırak" 2026-09-25 olayını üretti).
//
// Varlık başına canlı/yapılandırma referans tanımı `archive-gate/<varlık>-archive.helper.ts`
// dosyasında yaşar; bu dosya yalnız jenerik motordur (model erişimi spec'lerde) —
// böylece bir servisi içe aktaran router yalnız KENDİ varlığının dokunduğu tablolara
// bağlanır (rejim kapısı taraması).
//
// ⚠️ BİLİNEN SINIR (1e kararı Q2, 2026-09-25): kilit EN İYİ ÇABADIR — tx içinde ana veri
// satırı FOR UPDATE + sayım. Üründeki gibi referans yazan yollar ana veri satırını FOR
// SHARE almaz; sayım ile pasife alma arasında doğan referans kaçabilir. İzleme:
// /api/admin/health "arşivlenmiş ana veride canlı referans" sayacı (S8, beklenen 0).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { lowerTr } from "../../utils/tr-case";
import { AuditService } from "../audit.service";
import type { ApiResponse } from "../../types/api.types";

export type Db = Prisma.TransactionClient | typeof prisma;
export type ArchiveEntity = "color" | "fabricProperty" | "customer" | "warehouse" | "subcontractor";

export interface RefRecord { id: string; title: string; detail: string }

export interface RefKind {
  kind: string;
  label: string;
  count(db: Db, id: string): Promise<number>;
  list(db: Db, id: string, take: number): Promise<RefRecord[]>;
}

export interface ArchiveSpec {
  entity: ArchiveEntity;
  /** Türkçe ad ("renk") — mesajlarda. */
  noun: string;
  /** SQL tablo adı — FOR UPDATE kilidi. */
  table: string;
  /** Audit tablo adı (servis config'iyle aynı). */
  auditTable: string;
  /** ENGELLEYEN referanslar (canlı mal, açık belge, bakiye, aktif rotanın planı). */
  live: RefKind[];
  /** Yalnız UYARI — yapılandırma (izinli liste, müşteri rotası …); kayıtlar tek tek. */
  config: RefKind[];
}

export const REF_LIST_LIMIT = 200;
const WARNING_LIMIT = 20;

async function nameOf(db: Db, spec: ArchiveSpec, id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT "name" FROM "${spec.table}" WHERE id = $1::uuid`,
    id,
  );
  return rows[0]?.name ?? "";
}

/** Engelleyen referansları tür tür ve TEK TEK listeler (409 gövdesi ve önizleme). */
export async function listArchiveBlockers(db: Db, spec: ArchiveSpec, id: string) {
  const out: Array<{ kind: string; label: string; count: number; records: RefRecord[] }> = [];
  for (const k of spec.live) {
    const count = await k.count(db, id);
    out.push({ kind: k.kind, label: k.label, count, records: count > 0 ? await k.list(db, id, REF_LIST_LIMIT) : [] });
  }
  return out;
}

/** Yapılandırma referansları — uyarı metni, kayıt başına bir satır (üst sınırlı). */
export async function archiveConfigWarnings(db: Db, spec: ArchiveSpec, id: string): Promise<string[]> {
  const out: string[] = [];
  for (const k of spec.config) {
    const recs = await k.list(db, id, WARNING_LIMIT + 1);
    for (const r of recs.slice(0, WARNING_LIMIT)) out.push(`${k.label}: ${r.title}${r.detail ? ` (${r.detail})` : ""}`);
    if (recs.length > WARNING_LIMIT) out.push(`${k.label}: … ve daha fazlası`);
  }
  return out;
}

/**
 * Tx içinde: ana veri satırı FOR UPDATE → engelleyen referans sayımı → varsa 409
 * `MASTER_DATA_HAS_LIVE_REFERENCES` (+ `details.entity`, `details.references`).
 */
export async function assertArchivableTx(tx: Prisma.TransactionClient, spec: ArchiveSpec, id: string): Promise<void> {
  const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "${spec.table}" WHERE id = $1::uuid FOR UPDATE`,
    id,
  );
  if (locked.length === 0) throw AppError.notFound("Kayıt bulunamadı");
  let total = 0;
  for (const k of spec.live) total += await k.count(tx, id);
  if (total === 0) return;
  const references = await listArchiveBlockers(tx, spec, id);
  const summary = references.filter((r) => r.count > 0).map((r) => `${r.count} ${lowerTr(r.label)}`).join(", ");
  throw AppError.conflict(
    `"${await nameOf(tx, spec, id)}" ${spec.noun} pasife alınamaz: bağlı canlı kayıt var (${summary}). ` +
      "Önce bu kayıtları kapatın ya da kartı birleştirin.",
    { code: "MASTER_DATA_HAS_LIVE_REFERENCES", entity: spec.entity, references },
  );
}

/**
 * Pasife alma — kapı + yazım AYNI tx'te; audit tx dışı. `afterTx` varlığa özgü yan
 * yazımlar içindir (fasoncu → rol bayrağı senkronu). Başarıda yapılandırma referansları
 * `warnings` olarak döner (engel değil).
 */
export async function archiveMasterData(
  spec: ArchiveSpec,
  id: string,
  opts: {
    userId?: string;
    action: "DELETE" | "UPDATE";
    write: (tx: Prisma.TransactionClient) => Promise<unknown>;
    afterTx?: (tx: Prisma.TransactionClient) => Promise<void>;
  },
): Promise<ApiResponse<unknown>> {
  const data = await prisma.$transaction(async (tx) => {
    await assertArchivableTx(tx, spec, id);
    const row = await opts.write(tx);
    if (opts.afterTx) await opts.afterTx(tx);
    return row;
  });
  await AuditService.log({
    userId: opts.userId,
    action: opts.action,
    tableName: spec.auditTable,
    recordId: id,
    newData: { isActive: false },
  });
  const warnings = await archiveConfigWarnings(prisma, spec, id);
  return {
    success: true,
    data,
    message: "Kayıt pasife alındı",
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

async function isActiveNow(spec: ArchiveSpec, id: string): Promise<boolean | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ isActive: boolean }>>(
    `SELECT "isActive" FROM "${spec.table}" WHERE id = $1::uuid`,
    id,
  );
  return rows[0] ? rows[0].isActive : null;
}

/**
 * `DELETE` = pasife al. Zaten pasif kayıtta kapı koşmaz (geçiş yok, yazım yok) — eski
 * veride canlı referanslı pasif kayıt varsa bile bugünkü durum değişmez.
 */
export async function gatedSoftDelete(
  spec: ArchiveSpec,
  id: string,
  userId: string | undefined,
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<ApiResponse<unknown>> {
  const now = await isActiveNow(spec, id);
  if (now === null) throw AppError.notFound("Kayıt bulunamadı");
  if (!now) return { success: true, data: null, message: "Kayıt zaten pasif" };
  return archiveMasterData(spec, id, { userId, action: "DELETE", write });
}

/**
 * `PATCH {isActive:false, …}`: gövdedeki pasife alma kapıdan geçer, kalan alanlar
 * servisin kendi güncellemesine (`next`) gider. Zaten pasif kayıtta `isActive` yalnız
 * düşürülür (form her kayıtta alanı gönderir; ad düzeltmesi 409'a takılmasın).
 */
export async function gatedUpdate(
  spec: ArchiveSpec,
  id: string,
  data: Record<string, unknown>,
  opts: {
    userId?: string;
    write: (tx: Prisma.TransactionClient) => Promise<unknown>;
    next: (rest: Record<string, unknown>) => Promise<ApiResponse<unknown>>;
  },
): Promise<ApiResponse<unknown>> {
  const { userId, write, next } = opts;
  if (data.isActive !== false) return next(data);
  const { isActive: _dropped, ...rest } = data;
  void _dropped;
  if ((await isActiveNow(spec, id)) !== true) return next(rest);
  const res = await archiveMasterData(spec, id, { userId, action: "UPDATE", write });
  if (Object.keys(rest).length === 0) return res;
  const after = await next(rest);
  const warnings = [...(res.warnings ?? []), ...(after.warnings ?? [])];
  return warnings.length > 0 ? { ...after, warnings } : after;
}
