// SATICI PORTALI — dağıtım rotaları (Faz 3d; VENDOR_PORTAL_ROUTES'a eklenir, aynı izin/kimlik beyanıyla).
// İlk kurulum bağlantısı ve yükleme isteği belirteci YALNIZ doğduğu yanıtta görünür; işlem kimliğinin
// saklanan yanıtında belirteç YOK (`belirtecGosterilemez`). Ham gövdeli uçlar (parça PUT, dosya indirme)
// JSON tablosunun dışında: distribution-raw.ts (aynı oturum + izin kapısı).
import { z } from "zod";
import { cancelLinkTx, createLinkTx, listLinks, LINK_VIEW } from "../distribution/links.service";
import { releaseOverview } from "../distribution/releases.view";
import { cancelUploadRequestTx, createUploadRequestTx, listUploadRequests, REQUEST_VIEW } from "../distribution/requests.service";
import { completeSession, sessionState, startSession, type SessionOwner } from "../distribution/sessions.service";
import { createPublisherTx, deactivatePublisherTx, listPublishers, PublisherKeySchema } from "../distribution/publications.service";
import { buildPath, hashFile, listBuilds, partDir, removeQuietly } from "../distribution/storage";
import { issueToken, type IssuedToken } from "../distribution/tokens";
import { jsonSafe } from "../distribution/view";
import { VendorError, notFoundError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { ClientTokenSchema, ReasonSchema, bodyOf, idParam, portalAction, queryEnum, queryText, type PortalRequestContext, type PortalRouteDef } from "./portal-http";

const Uuid = z.uuid();
const LinkCreate = z.strictObject({
  clientToken: ClientTokenSchema,
  tur: z.enum(["ILK_KURULUM", "DOSYA"]),
  musteriId: Uuid,
  kurulumId: Uuid.optional(),
  derlemeAdi: z.string().min(1).max(200).optional(),
  dosyaId: Uuid.optional(),
  gecerlilikSaat: z.number().int(),
  azamiIndirme: z.number().int(),
  aciklama: z.string().trim().min(1).max(500).optional(),
});
const RequestCreate = z.strictObject({
  clientToken: ClientTokenSchema,
  musteriId: Uuid,
  gecerlilikSaat: z.number().int(),
  kotaMb: z.number().int(),
  azamiDosyaMb: z.number().int(),
  aciklama: z.string().trim().min(1).max(500).optional(),
});
const Cancel = z.strictObject({ clientToken: ClientTokenSchema, sebep: ReasonSchema });
const OutgoingStart = z.strictObject({
  clientToken: ClientTokenSchema,
  musteriId: Uuid,
  dosyaAdi: z.string().min(1).max(400),
  boyut: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.string().max(100).optional(),
});
const PublisherCreate = z.strictObject({ clientToken: ClientTokenSchema, kid: z.string().min(3).max(80), ad: z.string().trim().min(1).max(200), acikAnahtar: PublisherKeySchema });
const PublisherOff = z.strictObject({ clientToken: ClientTokenSchema, sebep: ReasonSchema });

const withPath = (body: object, id: string) => ({ ...body, _yol: id });
const limitOf = (c: PortalRequestContext): number => {
  const raw = queryText(c.req, "limit");
  const n = raw === undefined ? 100 : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new VendorError(400, "GOVDE_GECERSIZ", "limit 1–500 olmalı");
  return n;
};
const optionalUuid = (c: PortalRequestContext, name: string): string | undefined => {
  const v = queryText(c.req, name);
  if (v !== undefined && !Uuid.safeParse(v).success) throw new VendorError(400, "GOVDE_GECERSIZ", `${name} biçimsiz`);
  return v;
};

/** Müşteriye verilecek tam adres (genel kök yapılandırılmışsa); yoksa null — arayüz yolu gösterir. */
function publicUrl(c: PortalRequestContext, pathPart: string): string | null {
  const base = c.ctx.config.GENEL_KOK_ADRESI;
  return base ? `${base.replace(/\/+$/, "")}${pathPart}` : null;
}

function outgoingOwner(c: PortalRequestContext, customerId: string): SessionOwner {
  return { kind: "SATICI", customerId, actor: c.session.actor };
}

async function createLink(c: PortalRequestContext) {
  const b = bodyOf(c, LinkCreate);
  let token: IssuedToken | null = null;
  return portalAction(c, {
    action: "DAGITIM_BAGLANTI_VER",
    clientToken: b.clientToken,
    body: b,
    prepare: async () => {
      token = issueToken(c.ctx);
      if (b.tur !== "ILK_KURULUM") return null;
      if (!b.derlemeAdi) throw new VendorError(400, "GOVDE_GECERSIZ", "İlk kurulum bağlantısı derleme dosyası ister");
      const h = await hashFile(buildPath(c.ctx.config.DERLEME_DIZINI, b.derlemeAdi)).catch((err: unknown) => {
        if (err instanceof VendorError) throw err;
        throw notFoundError("Derleme dosyası");
      });
      return h;
    },
    run: (tx, build) =>
      createLinkTx(tx, {
        kind: b.tur,
        customerId: b.musteriId,
        ...(b.kurulumId ? { installationDbId: b.kurulumId } : {}),
        ...(b.dosyaId ? { fileId: b.dosyaId } : {}),
        ...(b.derlemeAdi ? { buildName: b.derlemeAdi } : {}),
        ...(build ? { build } : {}),
        validHours: b.gecerlilikSaat,
        maxDownloads: b.azamiIndirme,
        ...(b.aciklama ? { note: b.aciklama } : {}),
        token: token!,
        actor: c.session.actor,
        nowMs: c.nowMs,
      }),
    respond: (link) => {
      const view = jsonSafe(Object.fromEntries(Object.keys(LINK_VIEW).map((k) => [k, (link as Record<string, unknown>)[k]])));
      return { status: 201, data: { baglanti: view, belirtec: token!.token, yol: `/d/${token!.token}`, adres: publicUrl(c, `/d/${token!.token}`) }, stored: { baglanti: view, belirtecGosterilemez: true } };
    },
    audit: (link) => [{ event: "DAGITIM_BAGLANTISI_VERILDI", entity: "IndirmeBaglantisi", entityId: link.id, summary: { tur: link.tur, musteriId: link.musteriId, sonu: link.belirtecSonu } }],
  });
}

async function createRequest(c: PortalRequestContext) {
  const b = bodyOf(c, RequestCreate);
  let token: IssuedToken | null = null;
  return portalAction(c, {
    action: "DAGITIM_YUKLEME_ISTEGI_VER",
    clientToken: b.clientToken,
    body: b,
    prepare: async () => void (token = issueToken(c.ctx)),
    run: (tx) =>
      createUploadRequestTx(tx, {
        customerId: b.musteriId,
        validHours: b.gecerlilikSaat,
        quotaMb: b.kotaMb,
        maxFileMb: b.azamiDosyaMb,
        ...(b.aciklama ? { note: b.aciklama } : {}),
        token: token!,
        actor: c.session.actor,
        nowMs: c.nowMs,
        fileCapMb: c.ctx.config.DOSYA_AZAMI_MB,
      }),
    respond: (r) => {
      const view = jsonSafe(Object.fromEntries(Object.keys(REQUEST_VIEW).map((k) => [k, (r as Record<string, unknown>)[k]])));
      return { status: 201, data: { istek: view, belirtec: token!.token, yol: `/y/${token!.token}`, adres: publicUrl(c, `/y/${token!.token}`) }, stored: { istek: view, belirtecGosterilemez: true } };
    },
    audit: (r) => [{ event: "DAGITIM_YUKLEME_ISTEGI_VERILDI", entity: "YuklemeIstegi", entityId: r.id, summary: { musteriId: r.musteriId, sonu: r.belirtecSonu } }],
  });
}

export const DISTRIBUTION_PORTAL_ROUTES: readonly PortalRouteDef[] = [
  { method: "get", path: "/dagitim/derlemeler", permission: "portal:oku", kimlik: "OKUMA", handler: async (c) => ({ data: await listBuilds(c.ctx.config.DERLEME_DIZINI) }) },
  {
    method: "get",
    path: "/dagitim/baglantilar",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => {
      const customerId = optionalUuid(c, "musteriId");
      const installationDbId = optionalUuid(c, "kurulumId");
      return { data: jsonSafe(await listLinks(prisma, { ...(customerId ? { customerId } : {}), ...(installationDbId ? { installationDbId } : {}), limit: limitOf(c) })) };
    },
  },
  { method: "post", path: "/dagitim/baglantilar", permission: "dagitim:yaz", kimlik: "ISLEM_KIMLIGI", handler: createLink },
  {
    method: "post",
    path: "/dagitim/baglantilar/:id/iptal",
    permission: "dagitim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Bağlantı");
      const b = bodyOf(c, Cancel);
      return portalAction(c, {
        action: "DAGITIM_BAGLANTI_IPTAL",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => cancelLinkTx(tx, { linkId: id, reason: b.sebep, actor: c.session.actor }),
        respond: (row) => ({ data: jsonSafe({ id: row.id, durum: row.durum, indirmeSayisi: row.indirmeSayisi }) }),
        audit: (row) => [{ event: "DAGITIM_BAGLANTISI_IPTAL", entity: "IndirmeBaglantisi", entityId: row.id, summary: { sebep: b.sebep } }],
      });
    },
  },
  {
    method: "get",
    path: "/dagitim/yukleme-istekleri",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => {
      const customerId = optionalUuid(c, "musteriId");
      return { data: jsonSafe(await listUploadRequests(prisma, { ...(customerId ? { customerId } : {}), limit: limitOf(c) })) };
    },
  },
  { method: "post", path: "/dagitim/yukleme-istekleri", permission: "dagitim:yaz", kimlik: "ISLEM_KIMLIGI", handler: createRequest },
  {
    method: "post",
    path: "/dagitim/yukleme-istekleri/:id/iptal",
    permission: "dagitim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Yükleme isteği");
      const b = bodyOf(c, Cancel);
      const r = await portalAction(c, {
        action: "DAGITIM_YUKLEME_ISTEGI_IPTAL",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => cancelUploadRequestTx(tx, { requestId: id, reason: b.sebep, actor: c.session.actor }),
        respond: (x) => ({ data: { id: x.request.id, durum: x.request.durum, terkEdilenOturumlar: x.abandoned } }),
        audit: (x) => [{ event: "DAGITIM_YUKLEME_ISTEGI_IPTAL", entity: "YuklemeIstegi", entityId: x.request.id, summary: { sebep: b.sebep, terk: x.abandoned.length } }],
      });
      // Terk edilen oturumların parçaları COMMIT'ten sonra silinir (tekrar oynatmada zararsız: dizin yok).
      for (const sid of (r.data as { terkEdilenOturumlar?: string[] }).terkEdilenOturumlar ?? []) await removeQuietly(partDir(c.ctx.config.DOSYA_DIZINI, sid));
      return r;
    },
  },
  {
    method: "get",
    path: "/dagitim/dosyalar",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => {
      const customerId = optionalUuid(c, "musteriId");
      const yon = queryEnum(c.req, "yon", ["GIDEN", "GELEN"] as const);
      const rows = await prisma.dagitimDosyasi.findMany({
        where: { ...(customerId ? { musteriId: customerId } : {}), ...(yon ? { yon } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limitOf(c),
        select: { id: true, musteriId: true, yon: true, ad: true, mime: true, boyut: true, sha256: true, saklamaBitis: true, govdeBudandiAt: true, yuklemeIstegiId: true, yukleyen: true, createdAt: true },
      });
      return { data: jsonSafe(rows) };
    },
  },
  {
    method: "get",
    path: "/dagitim/defter",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => {
      const customerId = optionalUuid(c, "musteriId");
      const rows = await prisma.dagitimDefteri.findMany({ where: customerId ? { musteriId: customerId } : {}, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limitOf(c) });
      return { data: jsonSafe(rows) };
    },
  },
  {
    method: "post",
    path: "/dagitim/giden-oturum",
    permission: "dagitim:yaz",
    kimlik: { muaf: "Oturum kendi işlem kimliğiyle idempotent (yukleme_oturumu.clientToken UNIQUE; aynı kimlik aynı oturumu döndürür)" },
    handler: async (c) => {
      const b = bodyOf(c, OutgoingStart);
      const data = await startSession(c.ctx.config, { owner: outgoingOwner(c, b.musteriId), clientToken: b.clientToken, name: b.dosyaAdi, mime: b.mime, size: b.boyut, sha256: b.sha256 }, c.nowMs);
      return { data };
    },
  },
  {
    method: "get",
    path: "/dagitim/giden-oturum/:id",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => {
      const s = await prisma.yuklemeOturumu.findUnique({ where: { id: idParam(c.req, "id", "Yükleme oturumu") }, select: { musteriId: true } });
      if (!s) throw notFoundError("Yükleme oturumu");
      return { data: await sessionState(outgoingOwner(c, s.musteriId), idParam(c.req, "id", "Yükleme oturumu")) };
    },
  },
  {
    method: "post",
    path: "/dagitim/giden-oturum/:id/tamamla",
    permission: "dagitim:yaz",
    kimlik: { muaf: "Tamamlama atomik claim ACIK→TAMAMLANDI; tamamlanmış oturumun tekrarı aynı dosyayı döndürür" },
    handler: async (c) => {
      const id = idParam(c.req, "id", "Yükleme oturumu");
      const s = await prisma.yuklemeOturumu.findUnique({ where: { id }, select: { musteriId: true } });
      if (!s) throw notFoundError("Yükleme oturumu");
      const f = await completeSession(c.ctx.config, { owner: outgoingOwner(c, s.musteriId), sessionId: id, nowMs: c.nowMs });
      return { data: jsonSafe({ dosyaId: f.id, ad: f.ad, boyut: f.boyut, sha256: f.sha256, saklamaBitis: f.saklamaBitis }) };
    },
  },
  { method: "get", path: "/surumler", permission: "portal:oku", kimlik: "OKUMA", handler: async (c) => ({ data: jsonSafe(await releaseOverview(prisma, c.ctx.config.YAYIN_DIZINI)) }) },
  { method: "get", path: "/yayincilar", permission: "portal:oku", kimlik: "OKUMA", handler: async () => ({ data: jsonSafe(await listPublishers(prisma)) }) },
  {
    method: "post",
    path: "/yayincilar",
    permission: "yayinci:anahtar",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, PublisherCreate);
      return portalAction(c, {
        action: "YAYINCI_EKLE",
        clientToken: b.clientToken,
        body: b,
        run: (tx) => createPublisherTx(tx, { kid: b.kid, name: b.ad, publicKey: b.acikAnahtar }),
        respond: (row) => ({ status: 201, data: jsonSafe(row) }),
        audit: (row) => [{ event: "YAYINCI_EKLENDI", entity: "YayinciAnahtari", entityId: row.id, summary: { kid: row.kid } }],
      });
    },
  },
  {
    method: "post",
    path: "/yayincilar/:id/pasif",
    permission: "yayinci:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Yayıncı anahtarı");
      const b = bodyOf(c, PublisherOff);
      return portalAction(c, {
        action: "YAYINCI_PASIF",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => deactivatePublisherTx(tx, id),
        respond: (row) => ({ data: jsonSafe(row) }),
        audit: (row) => [{ event: "YAYINCI_PASIFE_ALINDI", entity: "YayinciAnahtari", entityId: row.id, summary: { kid: row.kid, sebep: b.sebep } }],
      });
    },
  },
];
