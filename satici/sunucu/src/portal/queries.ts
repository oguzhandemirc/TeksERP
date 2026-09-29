// PORTAL OKUMA MODELLERİ — listeler (sunucuda süzme + imleçli sayfa) ve ayrıntılar. Bayi görünümü
// aynı sorgulardan `dealerId` süzgeciyle doğar: bayinin müşterisi olmayan kayıt "bulunamadı"dır
// (varlık sızdırılmaz). Yanıtlara sır girmez: parola özeti, şifreli TOTP, kod düz metni, özel anahtar yok.
import type { Prisma } from "@prisma/client";
import { notFoundError } from "../lib/errors";
import type { Db } from "../lib/prisma";
import type { VendorContext } from "../services/context";
import { currentCeiling, dealerUsage } from "../services/dealer.service";
import { computeSanctionState } from "../services/lease.service";
import { userView } from "./users.service";

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export const MAX_PAGE = 200;

export function page<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return { items, nextCursor: more ? (items[items.length - 1]?.id ?? null) : null };
}

export function cursorArgs(cursor: string | undefined, limit: number) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
  };
}

/**
 * Bayi görünümünde `yapan`: satıcı kullanıcı adı ve BAŞKA bayinin kullanıcı adı gösterilmez (rol ailesi kalır);
 * bayinin kendi hesapları ve sistem aktörleri (kurulum · bakım) olduğu gibi.
 */
async function dealerActorMask(db: Db, dealerId: string): Promise<(actor: string) => string> {
  const own = new Set((await db.portalKullanici.findMany({ where: { bayiId: dealerId }, select: { kullaniciAdi: true } })).map((u) => `bayi:${u.kullaniciAdi}`));
  return (actor) => (own.has(actor) ? actor : actor.startsWith("satici:") ? "satici" : actor.startsWith("bayi:") ? "bayi" : actor);
}

const dealerCustomerWhere = (dealerId: string | undefined): Prisma.MusteriWhereInput => (dealerId ? { bayiId: dealerId } : {});
const dealerInstallationWhere = (dealerId: string | undefined): Prisma.KurulumWhereInput => (dealerId ? { tesis: { musteri: { bayiId: dealerId } } } : {});

// ---------------------------------------------------------------- pano

export async function dashboard(db: Db, nowMs: number) {
  const byStatus = await db.kurulum.groupBy({ by: ["durum"], where: { aktif: true }, _count: { _all: true } });
  const openCopyAlerts = await db.kopyaUyarisi.count({ where: { durum: "ACIK" } });
  const pendingTransfers = await db.tasimaTalebi.count({ where: { durum: "BEKLIYOR" } });
  const overdueInstallments = await db.taksitKalemi.count({ where: { durum: "GECIKTI" } });
  const duePlanned = await db.planliEylem.count({ where: { durum: "BEKLIYOR", vade: { lte: new Date(nowMs + 7 * 86_400_000) } } });
  const silent = await db.kurulum.count({ where: { aktif: true, durum: "ETKIN", sonYoklamaZamani: { lt: new Date(nowMs - 24 * 3_600_000) } } });
  return {
    kurulumlar: Object.fromEntries(byStatus.map((r) => [r.durum, r._count._all])),
    acikKopyaUyarisi: openCopyAlerts,
    bekleyenTasima: pendingTransfers,
    gecikenTaksit: overdueInstallments,
    yediGundePlanliEylem: duePlanned,
    yirmiDortSaattirSessiz: silent,
  };
}

// ---------------------------------------------------------------- müşteri · tesis

export async function listCustomers(db: Db, g: { search?: string; active?: boolean; dealerId?: string; cursor?: string; limit: number }) {
  const rows = await db.musteri.findMany({
    where: {
      ...dealerCustomerWhere(g.dealerId),
      ...(g.active === undefined ? {} : { aktif: g.active }),
      ...(g.search ? { OR: [{ ad: { contains: g.search, mode: "insensitive" } }, { vergiNo: { contains: g.search } }] } : {}),
    },
    include: { bayi: { select: { id: true, ad: true } }, _count: { select: { tesisler: true } } },
    ...cursorArgs(g.cursor, g.limit),
  });
  return page(rows, g.limit);
}

export async function customerDetail(db: Db, id: string, g: { dealerId?: string } = {}) {
  const row = await db.musteri.findFirst({
    where: { id, ...dealerCustomerWhere(g.dealerId) },
    include: {
      bayi: { select: { id: true, ad: true } },
      tesisler: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { _count: { select: { kurulumlar: true } } } },
    },
  });
  if (!row) throw notFoundError("Müşteri");
  return row;
}

export async function listSites(db: Db, g: { customerId?: string; dealerId?: string }) {
  return db.tesis.findMany({
    where: { ...(g.customerId ? { musteriId: g.customerId } : {}), ...(g.dealerId ? { musteri: { bayiId: g.dealerId } } : {}) },
    include: { musteri: { select: { id: true, ad: true } }, _count: { select: { kurulumlar: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_PAGE,
  });
}

// ---------------------------------------------------------------- kurulum

const installationSummary = {
  tesis: { select: { id: true, ad: true, musteri: { select: { id: true, ad: true, bayiId: true } } } },
  haklar: { where: { aktif: true }, select: { id: true, lisansNo: true, guncelSurum: true, moduller: true, kalici: true, bakimBitis: true, gecerlilikBitis: true } },
  _count: { select: { kopyaUyarilari: { where: { durum: "ACIK" as const } }, tasimalar: { where: { durum: "BEKLIYOR" as const } } } },
} satisfies Prisma.KurulumInclude;

export async function listInstallations(
  db: Db,
  g: { siteId?: string; status?: Prisma.KurulumWhereInput["durum"]; search?: string; dealerId?: string; cursor?: string; limit: number },
) {
  const rows = await db.kurulum.findMany({
    where: {
      ...dealerInstallationWhere(g.dealerId),
      ...(g.siteId ? { tesisId: g.siteId } : {}),
      ...(g.status ? { durum: g.status } : {}),
      ...(g.search
        ? {
            OR: [
              { ad: { contains: g.search, mode: "insensitive" } },
              { tesis: { ad: { contains: g.search, mode: "insensitive" } } },
              { tesis: { musteri: { ad: { contains: g.search, mode: "insensitive" } } } },
              { haklar: { some: { lisansNo: { contains: g.search.toUpperCase() } } } },
            ],
          }
        : {}),
    },
    include: installationSummary,
    ...cursorArgs(g.cursor, g.limit),
  });
  return page(
    rows.map((r) => ({ ...r, kabulEdilenParmakIzi: undefined, acikAnahtar: undefined })),
    g.limit,
  );
}

/** Kurulum künyesi: hak + sürümler, yaptırım (katlanmış + defter), kiralar, yoklamalar, uyarılar, talepler, planlar, kayıtlar. */
export async function installationDetail(db: Db, id: string, g: { dealerId?: string } = {}) {
  const inst = await db.kurulum.findFirst({ where: { id, ...dealerInstallationWhere(g.dealerId) }, include: installationSummary });
  if (!inst) throw notFoundError("Kurulum");
  const dealerView = g.dealerId !== undefined;
  const hak = inst.haklar[0] ?? null;
  const versions = hak
    ? await db.hakSurumu.findMany({ where: { hakId: hak.id }, orderBy: { surum: "desc" }, select: { id: true, surum: true, imzalayanKid: true, verilis: true, sebep: true, yapan: true, createdAt: true } })
    : [];
  const codes = await db.etkinlestirmeKodu.findMany({
    where: { kurulumId: inst.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, kodSonu: true, durum: true, gecerlilikBitis: true, kullanimZamani: true, yapan: true, createdAt: true },
  });
  if (dealerView) {
    const mask = await dealerActorMask(db, g.dealerId!);
    return {
      kurulum: { ...inst, kabulEdilenParmakIzi: undefined },
      hak,
      hakSurumleri: versions.map((v) => ({ ...v, yapan: mask(v.yapan) })),
      etkinlestirmeKodlari: codes.map((k) => ({ ...k, yapan: mask(k.yapan) })),
    };
  }
  const base = {
    kurulum: { ...inst, kabulEdilenParmakIzi: undefined },
    hak,
    hakSurumleri: versions,
    etkinlestirmeKodlari: codes,
  };
  const sanctions = await db.yaptirimEylemi.findMany({ where: { kurulumId: inst.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const leases = await db.kira.findMany({
    where: { kurulumId: inst.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, karar: true, oncekiKiraId: true, anahtarKimligi: true, hakSurum: true, verilis: true, bitis: true, createdAt: true },
  });
  const polls = await db.yoklama.findMany({
    where: { kurulumId: inst.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, sonuc: true, kiraId: true, durum: true, saat: true, gozlem: true, createdAt: true },
  });
  return {
    ...base,
    kurulum: { ...base.kurulum, kabulEdilenParmakIzi: inst.kabulEdilenParmakIzi },
    yaptirim: await computeSanctionState(db, inst.id),
    yaptirimDefteri: sanctions,
    kiralar: leases,
    yoklamalar: polls,
    kopyaUyarilari: await db.kopyaUyarisi.findMany({ where: { kurulumId: inst.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 }),
    tasimaTalepleri: await db.tasimaTalebi.findMany({
      where: { kurulumId: inst.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, yeniAnahtarKimligi: true, ortam: true, gerekce: true, durum: true, kararZamani: true, kararVeren: true, kararSebebi: true, createdAt: true },
    }),
    planliEylemler: await db.planliEylem.findMany({ where: { kurulumId: inst.id }, orderBy: [{ vade: "asc" }, { id: "asc" }] }),
    taksitPlanlari: await db.taksitPlani.findMany({
      where: { kurulumId: inst.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { kalemler: { orderBy: { sira: "asc" } } },
    }),
    kurulumKaydi: await db.kurulumKaydi.findMany({ where: { kurulumId: inst.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }),
  };
}

export async function entitlementDetail(db: Db, id: string, g: { dealerId?: string } = {}) {
  const hak = await db.hak.findFirst({
    where: { id, ...(g.dealerId ? { kurulum: dealerInstallationWhere(g.dealerId) } : {}) },
    include: {
      kurulum: { select: { id: true, kurulumId: true, ad: true, sinif: true, durum: true } },
      surumler: { orderBy: { surum: "desc" }, select: { id: true, surum: true, imzalayanKid: true, verilis: true, sebep: true, yapan: true, belge: true, createdAt: true } },
    },
  });
  if (!hak) throw notFoundError("Hak");
  if (!g.dealerId) return hak;
  const mask = await dealerActorMask(db, g.dealerId);
  return { ...hak, surumler: hak.surumler.map((v) => ({ ...v, yapan: mask(v.yapan) })) };
}

// ---------------------------------------------------------------- yaptırım · talepler

export async function listPlannedActions(db: Db, g: { status?: "BEKLIYOR" | "UYGULANDI" | "IPTAL"; installationDbId?: string; cursor?: string; limit: number }) {
  const rows = await db.planliEylem.findMany({
    where: { ...(g.status ? { durum: g.status } : {}), ...(g.installationDbId ? { kurulumId: g.installationDbId } : {}) },
    ...cursorArgs(g.cursor, g.limit),
  });
  return page(rows, g.limit);
}

/** Bağsız (kimliksiz) talep için İPUCU: DB kimliği (`ortam.installationId`, bilgi) son yoklamasında aynı olan kurulumlar. */
async function suggestedInstallations(db: Db, ortam: unknown) {
  const dbId = (ortam as { installationId?: unknown } | null)?.installationId;
  if (typeof dbId !== "string") return [];
  return db.kurulum.findMany({
    where: { aktif: true, sonOrtam: { path: ["installationId"], equals: dbId } },
    select: { id: true, kurulumId: true, ad: true, durum: true, tesis: { select: { ad: true, musteri: { select: { ad: true } } } } },
    take: 5,
  });
}

export async function listTransfers(db: Db, g: { status?: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI"; cursor?: string; limit: number }) {
  const rows = await db.tasimaTalebi.findMany({
    where: g.status ? { durum: g.status } : {},
    select: {
      id: true,
      kurulumId: true,
      yeniAnahtarKimligi: true,
      ortam: true,
      gerekce: true,
      durum: true,
      kararZamani: true,
      kararVeren: true,
      kararSebebi: true,
      createdAt: true,
      kurulum: { select: { kurulumId: true, ad: true, tesis: { select: { ad: true, musteri: { select: { ad: true } } } } } },
    },
    ...cursorArgs(g.cursor, g.limit),
  });
  const out = [];
  for (const r of rows) out.push({ ...r, onerilenKurulumlar: r.kurulumId === null && r.durum === "BEKLIYOR" ? await suggestedInstallations(db, r.ortam) : [] });
  return page(out, g.limit);
}

export async function listCopyAlerts(db: Db, g: { status?: "ACIK" | "KAPANDI"; cursor?: string; limit: number }) {
  const rows = await db.kopyaUyarisi.findMany({
    where: g.status ? { durum: g.status } : {},
    include: { kurulum: { select: { kurulumId: true, ad: true, tesis: { select: { ad: true, musteri: { select: { ad: true } } } } } } },
    ...cursorArgs(g.cursor, g.limit),
  });
  return page(rows, g.limit);
}

// ---------------------------------------------------------------- bayi · kullanıcı

export async function listDealers(db: Db) {
  const dealers = await db.bayi.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_PAGE });
  const out = [];
  for (const d of dealers) {
    out.push({ ...d, tavan: await currentCeiling(db, d), kullanim: await dealerUsage(db, d.id) });
  }
  return out;
}

export async function dealerDetail(db: Db, id: string) {
  const dealer = await db.bayi.findUnique({ where: { id } });
  if (!dealer) throw notFoundError("Bayi");
  return {
    ...dealer,
    tavan: await currentCeiling(db, dealer),
    tavanGecmisi: await db.bayiTavani.findMany({ where: { bayiId: id }, orderBy: { surum: "desc" } }),
    kullanim: await dealerUsage(db, id),
    musteriSayisi: await db.musteri.count({ where: { bayiId: id } }),
    kullanicilar: (await db.portalKullanici.findMany({ where: { bayiId: id }, orderBy: { createdAt: "asc" } })).map(userView),
  };
}

export async function listUsers(db: Db) {
  return (await db.portalKullanici.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(userView);
}

// ---------------------------------------------------------------- denetim · anahtar

export async function listAudit(db: Db, g: { entity?: string; entityId?: string; event?: string; cursor?: string; limit: number }) {
  const rows = await db.denetim.findMany({
    where: {
      ...(g.entity ? { varlik: g.entity } : {}),
      ...(g.entityId ? { varlikId: g.entityId } : {}),
      ...(g.event ? { olay: g.event } : {}),
    },
    ...cursorArgs(g.cursor, g.limit),
  });
  return page(rows, g.limit);
}

/** Anahtar durumu: YALNIZ açık yarı + kid + tür + geçerlilik + çapa bilgisi (özel yarı zaten DB'de yok). */
export async function keyStatus(ctx: VendorContext, db: Db, nowMs: number) {
  const registry = await db.anahtarKaydi.findMany({
    orderBy: [{ tur: "asc" }, { kid: "asc" }],
    select: { kid: true, tur: true, acikAnahtar: true, siniflar: true, baslangic: true, bitis: true, durum: true, createdAt: true, updatedAt: true },
  });
  const loaded = new Set([...ctx.keys.wrapped.map((w) => w.kid), ...ctx.keys.subKeys.map((k) => k.kid)]);
  return {
    capa: { kaynak: ctx.keys.anchorSource, kokler: ctx.keys.anchor.map((r) => ({ kid: r.kid, x: r.x, siniflar: r.classes })) },
    anahtarlar: registry.map((r) => ({
      ...r,
      yuklu: loaded.has(r.kid),
      suresiDoldu: r.bitis !== null && r.bitis.getTime() < nowMs,
      capada: ctx.keys.wrapped.find((w) => w.kid === r.kid)?.inAnchor ?? null,
    })),
    kiraImzalayabilir: ctx.keys.subKeys.some((k) => k.kind === "ALT"),
    indirmeAnahtari: ctx.keys.downloadKey(nowMs)?.kid ?? null,
    uyarilar: ctx.keys.warnings,
  };
}

/** Bayinin kendi görünümü: tavan + kullanım (başka bayiler görünmez). */
export async function dealerSelf(db: Db, dealerId: string) {
  const dealer = await db.bayi.findUnique({ where: { id: dealerId } });
  if (!dealer) throw notFoundError("Bayi");
  const ceiling = await currentCeiling(db, dealer);
  const mask = await dealerActorMask(db, dealer.id);
  return {
    id: dealer.id,
    ad: dealer.ad,
    anahtarBagli: dealer.anahtarKid !== null,
    tavan: ceiling ? { ...ceiling, yapan: mask(ceiling.yapan) } : null,
    kullanim: await dealerUsage(db, dealer.id),
  };
}
