// =============================================================================
// KAYITLI RAPOR TANIMLARI — görünürlük, CRUD, durum (sürüm: rapor-surum · paylaşım: rapor-paylasim · koşu: rapor-kosu)
// =============================================================================
// Tanım KATALOG satırıdır ("sil" = ARSIV durum geçişi); gövde DEĞİŞMEZ sürüm satırlarında yaşar ve
// yürürlükteki sürüm `activeVersionId` claim'iyle değişir (count 0 → 409). Paylaşım görünürlük verir,
// veri yetkisi VERMEZ: blok izinleri koşuda kullanıcının kendi izinleriyle denetlenir. Görünmeyen
// tanım 404 döner (varlığı sızdırılmaz). SISTEM satırının gövdesi koddur (temel rapor ucu), sürümü yok.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { REPORT_BUILDER_PERMISSION, REPORT_PUBLISH_PERMISSION } from "../constants/permission-catalog";
import { REPORT_BY_KEY, REPORT_CATALOG } from "../constants/report-catalog";
import { stableStringify } from "./reports/semantik/onbellek";
import { checkReportDefinition, type DefinitionIssue, type ReportDefinitionBody } from "./reports/semantik/rapor-tanimi.schema";
import { DEFAULT_CATEGORY_CODE } from "./rapor-kategori.service";

export const DEFINITION_STATUSES = ["TASLAK", "YAYINDA", "ARSIV"] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];
export const VISIBILITIES = ["OZEL", "PAYLASIMLI", "HERKES"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** İzinli geçişler (kaynak → hedefler); ARSIV son duraktır. */
const TRANSITIONS: Record<DefinitionStatus, readonly DefinitionStatus[]> = { TASLAK: ["YAYINDA", "ARSIV"], YAYINDA: ["ARSIV"], ARSIV: [] };

export interface Actor {
  userId: string;
  permissions: readonly string[];
}

const DEFINITION_SELECT = {
  id: true, kind: true, key: true, name: true, description: true, categoryId: true, ownerId: true, visibility: true,
  status: true, activeVersionId: true, isBroken: true, createdAt: true, updatedAt: true,
  owner: { select: { id: true, fullName: true } },
  category: { select: { id: true, name: true, code: true } },
  activeVersion: { select: { id: true, versionNo: true, createdAt: true } },
} satisfies Prisma.ReportDefinitionSelect;

type DefinitionRow = Prisma.ReportDefinitionGetPayload<{ select: typeof DEFINITION_SELECT }>;

export interface ReportDefinitionDto {
  id: string;
  tur: string;
  anahtar: string | null;
  ad: string;
  aciklama: string | null;
  kategori: { id: string; ad: string; kod: string | null };
  sahip: { id: string; ad: string } | null;
  gorunurluk: string;
  durum: string;
  aktifSurum: { id: string; no: number; tarih: string } | null;
  bozuk: boolean;
  duzenleyebilir: boolean;
  /** SISTEM tanımında temel raporun panel yolu (gövde kod servisidir). */
  panelYolu: string | null;
  olusturuldu: string;
  guncellendi: string;
}

const can = (a: Actor, code: string) => matchesPermission(a.permissions, code);

/** Kullanıcının izniyle açılan SISTEM rapor anahtarları (katalog `izin`i). */
function systemKeysFor(a: Actor): string[] {
  return REPORT_CATALOG.filter((e) => e.nesil === "v2" && e.hazir && can(a, e.izin)).map((e) => e.key);
}

/** Görünürlük — liste, ayrıntı ve koşu TEK yüklemden okur. */
export function visibleWhere(a: Actor): Prisma.ReportDefinitionWhereInput {
  const shared: Prisma.ReportDefinitionWhereInput = { visibility: "PAYLASIMLI", shares: { some: { userId: a.userId } } };
  return {
    OR: [
      { kind: "SISTEM", status: { not: "ARSIV" }, key: { in: systemKeysFor(a) } },
      { kind: "OZEL", ownerId: a.userId },
      { kind: "OZEL", status: "YAYINDA", OR: [{ visibility: "HERKES" }, shared] },
      // DUZENLE paylaşımı taslağı da gösterir (birlikte hazırlanır).
      { kind: "OZEL", status: "TASLAK", shares: { some: { userId: a.userId, access: "DUZENLE" } } },
    ],
  };
}

async function canEditRow(row: { kind: string; ownerId: string | null; status: string; id: string }, a: Actor): Promise<boolean> {
  if (row.kind !== "OZEL" || row.status === "ARSIV" || !can(a, REPORT_BUILDER_PERMISSION)) return false;
  if (row.ownerId === a.userId) return true;
  const s = await prisma.reportShare.findUnique({ where: { definitionId_userId: { definitionId: row.id, userId: a.userId } }, select: { access: true } });
  return s?.access === "DUZENLE";
}

function toDto(r: DefinitionRow, editable: boolean): ReportDefinitionDto {
  return {
    id: r.id, tur: r.kind, anahtar: r.key, ad: r.name, aciklama: r.description,
    kategori: { id: r.category.id, ad: r.category.name, kod: r.category.code },
    sahip: r.owner ? { id: r.owner.id, ad: r.owner.fullName } : null,
    gorunurluk: r.visibility, durum: r.status,
    aktifSurum: r.activeVersion ? { id: r.activeVersion.id, no: r.activeVersion.versionNo, tarih: r.activeVersion.createdAt.toISOString() } : null,
    bozuk: r.isBroken, duzenleyebilir: editable,
    panelYolu: r.key ? (REPORT_BY_KEY.get(r.key)?.panelYolu ?? null) : null,
    olusturuldu: r.createdAt.toISOString(), guncellendi: r.updatedAt.toISOString(),
  };
}

function notFound(): AppError {
  return AppError.notFound("Rapor bulunamadı.", { code: "RAPOR_TANIMI_YOK" });
}

/** Görünür tanımı okur; görünmüyorsa 404. */
export async function loadVisible(id: string, a: Actor): Promise<DefinitionRow> {
  const row = await prisma.reportDefinition.findFirst({ where: { AND: [{ id }, visibleWhere(a)] }, select: DEFINITION_SELECT });
  if (!row) throw notFound();
  return row;
}

export async function loadEditable(id: string, a: Actor): Promise<DefinitionRow> {
  const row = await loadVisible(id, a);
  if (!(await canEditRow(row, a))) {
    throw AppError.forbidden("Bu raporu düzenleme yetkiniz yok.", { code: "RAPOR_DUZENLEME_YETKISI_YOK" });
  }
  return row;
}

// ── Liste ────────────────────────────────────────────────────────────────────

export const LIST_SCOPES = ["tumu", "benim", "paylasilan", "sistem"] as const;

export interface ListInput {
  kapsam: (typeof LIST_SCOPES)[number];
  kategoriId?: string;
  durum?: DefinitionStatus;
  ara?: string;
  anahtar?: string;
  cursor?: string;
  limit: number;
}

function listWhere(input: ListInput, a: Actor): Prisma.ReportDefinitionWhereInput {
  const and: Prisma.ReportDefinitionWhereInput[] = [visibleWhere(a)];
  if (input.kapsam === "benim") and.push({ kind: "OZEL", ownerId: a.userId });
  if (input.kapsam === "paylasilan") and.push({ kind: "OZEL", ownerId: { not: a.userId } });
  if (input.kapsam === "sistem") and.push({ kind: "SISTEM" });
  if (input.kategoriId) and.push({ categoryId: input.kategoriId });
  if (input.anahtar) and.push({ key: input.anahtar });
  // Arşiv yalnız açıkça istenince görünür.
  and.push(input.durum ? { status: input.durum } : { status: { not: "ARSIV" } });
  if (input.ara?.trim()) and.push({ name: { contains: input.ara.trim(), mode: "insensitive" } });
  return { AND: and };
}

/** Liste + cursor + özet şeridi TEK where'den. */
export async function listDefinitions(input: ListInput, a: Actor) {
  const where = listWhere(input, a);
  const rows = await prisma.reportDefinition.findMany({
    where,
    select: DEFINITION_SELECT,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, input.limit);
  const items: ReportDefinitionDto[] = [];
  for (const r of page) items.push(toDto(r, await canEditRow(r, a)));
  const byKind = await prisma.reportDefinition.groupBy({ by: ["kind"], where, _count: { _all: true } });
  const count = (k: string) => byKind.find((g) => g.kind === k)?._count._all ?? 0;
  return {
    items,
    nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
    ozet: { toplam: count("SISTEM") + count("OZEL"), ozel: count("OZEL"), sistem: count("SISTEM") },
  };
}

export async function getDefinition(id: string, a: Actor) {
  const row = await loadVisible(id, a);
  const version = row.activeVersionId
    ? await prisma.reportDefinitionVersion.findUnique({ where: { id: row.activeVersionId }, select: { body: true, note: true, requiredPermissions: true } })
    : null;
  return { ...toDto(row, await canEditRow(row, a)), govde: version?.body ?? null, gerekenIzinler: version?.requiredPermissions ?? [] };
}

// ── Doğrulama ────────────────────────────────────────────────────────────────

export function brokenError(hatalar: DefinitionIssue[]): AppError {
  return AppError.badRequest("Rapor tanımı geçersiz: " + hatalar.slice(0, 3).map((h) => `${h.yol} — ${h.mesaj}`).join(" · "), {
    code: "RAPOR_TANIMI_BOZUK",
    hatalar,
  });
}

/** Kayıt öncesi kapı: geçersiz gövde 400 + JSON yolları. */
export function assertValidBody(raw: unknown): { body: ReportDefinitionBody; permissions: string[] } {
  const check = checkReportDefinition(raw);
  if (!check.gecerli) throw brokenError(check.hatalar);
  return { body: check.govde, permissions: check.gerekenIzinler };
}

// ── Oluşturma ────────────────────────────────────────────────────────────────

export interface CreateInput {
  ad?: string;
  aciklama?: string | null;
  kategoriId?: string;
  durum: "TASLAK" | "YAYINDA";
  govde: unknown;
  clientToken?: string | null;
}

async function resolveCategory(id: string | undefined): Promise<string> {
  const row = id
    ? await prisma.reportCategory.findFirst({ where: { id, isActive: true }, select: { id: true } })
    : await prisma.reportCategory.findUnique({ where: { code: DEFAULT_CATEGORY_CODE }, select: { id: true } });
  if (!row) throw AppError.badRequest("Kategori bulunamadı ya da pasif.", { code: "RAPOR_KATEGORI_YOK" });
  return row.id;
}

function createReplay(a: Actor, input: CreateInput) {
  return tokenReplay<{ id: string; ownerId: string | null; name: string; status: string; body: unknown }, ReportDefinitionDto>({
    find: async (db, clientToken) => {
      const d = await db.reportDefinition.findUnique({
        where: { clientToken },
        select: { id: true, ownerId: true, name: true, status: true, versions: { where: { versionNo: 1 }, select: { body: true } } },
      });
      return d ? { id: d.id, ownerId: d.ownerId, name: d.name, status: d.status, body: d.versions[0]?.body ?? null } : null;
    },
    alive: (p) => {
      if (p.status === "ARSIV") {
        throw AppError.conflict("Bu rapor oluşturulup sonra arşive kaldırılmış; yeniden oluşturmak için formu yeniden açın.", { code: "RAPOR_TANIMI_ARSIVDE", tanimId: p.id });
      }
    },
    identity: (p) => [
      { ad: "ownerId", mevcut: p.ownerId, gelen: a.userId },
      { ad: "govde", mevcut: stableStringify(p.body), gelen: stableStringify(assertValidBody(input.govde).body) },
    ],
    collision: "Bu işlem kimliği başka bir rapora ait; kaydı yeniden gönderin.",
    respond: async (p) => toDto(await prisma.reportDefinition.findUniqueOrThrow({ where: { id: p.id }, select: DEFINITION_SELECT }), true),
  });
}

export async function createDefinition(input: CreateInput, a: Actor): Promise<ReportDefinitionDto> {
  const { body, permissions } = assertValidBody(input.govde);
  return createReplay(a, input).run(input.clientToken, async () => {
    const categoryId = await resolveCategory(input.kategoriId);
    const id = await prisma.$transaction(async (tx) => {
      const def = await tx.reportDefinition.create({
        data: {
          kind: "OZEL", name: input.ad?.trim() || body.baslik, description: input.aciklama ?? null, categoryId, ownerId: a.userId,
          visibility: "OZEL", status: input.durum, clientToken: input.clientToken ?? null, createdById: a.userId, updatedById: a.userId,
        },
        select: { id: true },
      });
      const v = await tx.reportDefinitionVersion.create({
        data: { definitionId: def.id, versionNo: 1, body: body as Prisma.InputJsonValue, requiredPermissions: permissions, createdById: a.userId, note: "İlk sürüm" },
        select: { id: true },
      });
      await tx.reportDefinition.updateMany({ where: { id: def.id, activeVersionId: null }, data: { activeVersionId: v.id } });
      return def.id;
    });
    const row = await prisma.reportDefinition.findUniqueOrThrow({ where: { id }, select: DEFINITION_SELECT });
    await AuditService.log({ userId: a.userId, action: "CREATE", tableName: "REPORT_DEFINITION", recordId: id, newData: { ad: row.name, kategoriId: categoryId, durum: row.status, surumNo: 1 } });
    return toDto(row, true);
  });
}

// ── Künye ve durum ───────────────────────────────────────────────────────────

export interface UpdateMetaInput {
  ad?: string;
  aciklama?: string | null;
  kategoriId?: string;
}

/** Ad/açıklama/kategori ("kategoriye al") — düzenleyici yazar; gövde değişmez. */
export async function updateMeta(id: string, input: UpdateMetaInput, a: Actor): Promise<ReportDefinitionDto> {
  const row = await loadEditable(id, a);
  const categoryId = input.kategoriId ? await resolveCategory(input.kategoriId) : undefined;
  const data = {
    ...(input.ad !== undefined ? { name: input.ad.trim() } : {}),
    ...(input.aciklama !== undefined ? { description: input.aciklama } : {}),
    ...(categoryId ? { categoryId } : {}),
  };
  const n = await prisma.reportDefinition.updateMany({ where: { id, status: { not: "ARSIV" } }, data: { ...data, updatedById: a.userId } });
  if (n.count === 0) throw AppError.conflict("Rapor arşive kaldırılmış; değiştirilemez.", { code: "RAPOR_TANIMI_ARSIVDE" });
  await AuditService.log({
    userId: a.userId, action: "UPDATE", tableName: "REPORT_DEFINITION", recordId: id,
    oldData: { ad: row.name, aciklama: row.description, kategoriId: row.categoryId }, newData: data,
  });
  return toDto(await prisma.reportDefinition.findUniqueOrThrow({ where: { id }, select: DEFINITION_SELECT }), true);
}

/** Durum geçişi ATOMİK CLAIM; arşive kaldırma sahibin ya da `report:publish`in işidir. */
export async function changeStatus(id: string, from: DefinitionStatus, to: DefinitionStatus, a: Actor): Promise<ReportDefinitionDto> {
  const row = await loadVisible(id, a);
  if (row.kind !== "OZEL") throw AppError.conflict("Sistem raporunun durumu katalogdan gelir.", { code: "RAPOR_SISTEM_TANIMI" });
  const allowed = to === "ARSIV" ? row.ownerId === a.userId || can(a, REPORT_PUBLISH_PERMISSION) : await canEditRow(row, a);
  if (!allowed) throw AppError.forbidden("Bu raporun durumunu değiştirme yetkiniz yok.", { code: "RAPOR_DUZENLEME_YETKISI_YOK" });
  if (!TRANSITIONS[from].includes(to)) {
    throw AppError.badRequest(`"${from}" durumundan "${to}" durumuna geçilemez.`, { code: "RAPOR_DURUM_GECISI_GECERSIZ" });
  }
  const n = await prisma.reportDefinition.updateMany({ where: { id, status: from }, data: { status: to, updatedById: a.userId } });
  if (n.count === 0) throw AppError.conflict("Raporun durumu siz bakarken değişti; yenileyip yeniden deneyin.", { code: "RAPOR_DURUM_CAKISMASI" });
  await AuditService.log({ userId: a.userId, action: "UPDATE", tableName: "REPORT_DEFINITION", recordId: id, oldData: { durum: from }, newData: { durum: to } });
  return toDto(await prisma.reportDefinition.findUniqueOrThrow({ where: { id }, select: DEFINITION_SELECT }), to !== "ARSIV");
}
