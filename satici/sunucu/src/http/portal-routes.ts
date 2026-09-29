// SATICI PORTALI JSON API'si — YALNIZ tailnet dinleyicisinde, /portal/api altında (web arayüzü 1f).
// Her rota bir izin beyan eder (roles.ts); her yazma işlem kimliğiyle (clientToken) idempotenttir.
// Yol parametresi gövde özetine girer (`_yol`): aynı kimlik başka kayıtta kullanılamaz.
import { z } from "zod";
import { ChannelCodeSchema, LICENSE_CLASSES, SANCTION_LEVELS } from "../lisans-protokol";
import { passwordBuffer } from "../keys/key-files";
import { VendorError } from "../lib/errors";
import { prisma, type Tx } from "../lib/prisma";
import {
  DEFAULT_ENTITLEMENT_MODULES,
  PORTAL_MODULE_KEYS,
  RESTRICTION_DAY_PRESETS,
  assertKnownModules,
  assertProductionKept,
} from "../portal/module-catalog";
import { hashPortalPassword } from "../portal/password";
import * as q from "../portal/queries";
import { PORTAL_ROLES, roleHas } from "../portal/roles";
import {
  createPortalUserTx,
  findPortalUser,
  resetPortalUserTotpTx,
  setPortalUserActiveTx,
  setPortalUserPasswordTx,
  unlockPortalUserTx,
  userView,
} from "../portal/users.service";
import { CHANNEL_KINDS, ChannelVersionsSchema, createChannelTx, listChannels, updateChannelTx } from "../services/channel.service";
import {
  MAX_MAINTENANCE_MONTHS,
  createDealerTx,
  findDealer,
  linkDealerKeyTx,
  reloadKeys,
  setDealerActiveTx,
  setDealerCeilingTx,
  type DealerCeilingInput,
} from "../services/dealer.service";
import { revertDrTakeoverTx } from "../services/dr.service";
import {
  createActivationCodeTx,
  createEntitlementTx,
  entitlementVersionAudit,
  prepareEntitlementVersion,
  recordEntitlementVersionTx,
  type EntitlementChanges,
} from "../services/entitlement.service";
import { cancelInstallationTx, closeCopyAlertTx, findCopyAlert, reinstateInstallationTx } from "../services/installation-admin.service";
import {
  createCustomerTx,
  createInstallationTx,
  createSiteTx,
  findInstallationWithSite,
  findSite,
  setCustomerActiveTx,
  setInstallationActiveTx,
  setSiteActiveTx,
  updateCustomerTx,
  updateInstallationTx,
  updateSiteTx,
} from "../services/master-data.service";
import {
  applySanctionTx,
  cancelPlannedActionTx,
  closeInstallmentPlanTx,
  createInstallmentPlanTx,
  extendValidityTx,
  findInstallmentItem,
  findSanctionAction,
  installmentRestrictionDays,
  plannedK3IsHeavy,
  recordInstallmentPaymentTx,
  revertSanctionTx,
  sanctionAudit,
  sanctionInputIsHeavy,
  sanctionRowIsHeavy,
  schedulePlannedActionTx,
  setEnforcementTx,
  setValidityEndTx,
} from "../services/sanction.service";
import { decideTransferTx, findTransferRequest } from "../services/transfer.service";
import {
  ClientTokenSchema,
  IsoSchema,
  ReasonSchema,
  bodyOf,
  idParam,
  pageQuery,
  portalAction,
  queryBool,
  queryEnum,
  queryText,
  type PortalRequestContext,
  type PortalRouteDef,
} from "./portal-http";

const Token = ClientTokenSchema;
const Reason = ReasonSchema;
const ModuleList = z.array(z.string().min(1).max(64)).max(64);
const ClassEnum = z.enum(LICENSE_CLASSES);
const LightLevel = z.enum(["K0", "K1", "K2", "K3"]);
const TaxNo = z.string().max(20).nullable().optional();

const ReasonOnly = z.strictObject({ clientToken: Token, sebep: Reason });
const CustomerCreate = z.strictObject({ clientToken: Token, ad: z.string().min(1).max(200), vergiNo: TaxNo, bayiId: z.uuid().nullable().optional() });
const CustomerUpdate = z.strictObject({ clientToken: Token, ad: z.string().min(1).max(200).optional(), vergiNo: TaxNo, bayiId: z.uuid().nullable().optional() });
const SiteCreate = z.strictObject({ clientToken: Token, musteriId: z.uuid(), ad: z.string().min(1).max(200) });
const SiteUpdate = z.strictObject({ clientToken: Token, ad: z.string().min(1).max(200) });
const InstallationCreate = z.strictObject({
  clientToken: Token,
  tesisId: z.uuid(),
  kurulumId: z.uuid(),
  sinif: ClassEnum,
  kanalKodu: z.string().min(1).max(40),
  ad: z.string().max(200).nullable().optional(),
  yoklamaAraligiDk: z.number().int().optional(),
});
const InstallationUpdate = z.strictObject({
  clientToken: Token,
  ad: z.string().max(200).nullable().optional(),
  kanalKodu: z.string().min(1).max(40).optional(),
  yoklamaAraligiDk: z.number().int().optional(),
  sinif: ClassEnum.optional(),
});
const EntitlementCreate = z.strictObject({
  clientToken: Token,
  moduller: ModuleList.optional(),
  kalici: z.boolean(),
  bakimBitis: IsoSchema,
  uretimModuluCikarilsin: z.boolean().optional(),
});
// Vadeli geçerlilik bitişi taslakta YOK: her bitiş değişimi GECERLILIK defter satırıdır (/gecerlilik · /uzat · taksit).
const EntitlementVersion = z.strictObject({
  clientToken: Token,
  kokParolasi: z.string().min(1).max(200),
  sebep: Reason,
  moduller: ModuleList.optional(),
  kalici: z.boolean().optional(),
  bakimBitis: IsoSchema.optional(),
  uretimModuluCikarilsin: z.boolean().optional(),
});
const CodeCreate = z.strictObject({ clientToken: Token, gecerlilikGun: z.number().int().min(1).max(365).optional() });
const LightSanction = z.strictObject({
  clientToken: Token,
  kademe: LightLevel,
  mesaj: z.string().max(500).optional(),
  kisitlamaGun: z.number().int().min(0).max(3650).optional(),
  kisitlamaTarihi: IsoSchema.optional(),
  moduller: ModuleList.optional(),
  sebep: Reason,
  /** Geri sayımı 7 günden kısa K3 AĞIRDIR (yalnız yönetici): lisans numarası AYNEN. */
  onay: z.string().max(40).optional(),
});
const HeavySanction = z.strictObject({
  clientToken: Token,
  kademe: z.enum(["K4", "K5"]),
  mesaj: z.string().max(500).optional(),
  sebep: Reason,
  /** İkinci onay: kurulumun lisans numarası AYNEN. */
  onay: z.string().max(40).optional(),
});
const Enforcement = z.strictObject({ clientToken: Token, zorla: z.boolean(), sebep: Reason });
const Extend = z.strictObject({ clientToken: Token, gun: z.number().int().min(1).max(3650), sebep: Reason });
const Validity = z.strictObject({ clientToken: Token, tarih: IsoSchema.nullable(), sebep: Reason });
const Planned = z.strictObject({
  clientToken: Token,
  kademe: LightLevel,
  vade: IsoSchema,
  mesaj: z.string().max(500).optional(),
  kisitlamaGun: z.number().int().min(0).max(3650).optional(),
  moduller: ModuleList.optional(),
  sebep: Reason,
  onay: z.string().max(40).optional(),
});
const InstallmentPlan = z.strictObject({
  clientToken: Token,
  aciklama: z.string().min(1).max(500),
  kalemler: z.array(z.strictObject({ vade: IsoSchema, tutar: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/) })).min(1).max(120),
  uzatmaGun: z.number().int().min(0).max(3650).optional(),
  gecikmeGun: z.number().int().min(0).max(3650).optional(),
  kisitlamaGun: z.number().int().min(0).max(3650).optional(),
  onay: z.string().max(40).optional(),
});
const TokenOnly = z.strictObject({ clientToken: Token });
const CopyAlertClose = z.strictObject({ clientToken: Token, sebep: Reason, digerParmakIziniKabulEt: z.boolean() });
const Ceiling = z.strictObject({
  moduller: ModuleList,
  siniflar: z.array(ClassEnum).min(1).max(LICENSE_CLASSES.length),
  kurulumAdedi: z.number().int().min(0).max(100_000),
  /** Bayinin kurulum açabileceği kanallar (satıcı atar; boş = kurulum açamaz). */
  kanallar: z.array(ChannelCodeSchema).max(100).optional(),
  /** Varsayılan HAYIR (yönetici kararı g). */
  kaliciIzni: z.boolean().optional(),
  bakimAyTavani: z.number().int().min(1).max(MAX_MAINTENANCE_MONTHS).optional(),
});
const ceilingInput = (t: z.infer<typeof Ceiling>, modules: string[]): DealerCeilingInput => ({
  modules,
  classes: t.siniflar,
  installationCount: t.kurulumAdedi,
  channels: t.kanallar,
  perpetualAllowed: t.kaliciIzni,
  maintenanceMonths: t.bakimAyTavani,
});
const ChannelCreate = z.strictObject({
  clientToken: Token,
  kod: ChannelCodeSchema,
  ad: z.string().min(1).max(200),
  tur: z.enum(CHANNEL_KINDS),
  guncelSurumler: ChannelVersionsSchema.optional(),
});
const ChannelUpdate = z.strictObject({
  clientToken: Token,
  ad: z.string().min(1).max(200).optional(),
  tur: z.enum(CHANNEL_KINDS).optional(),
  guncelSurumler: ChannelVersionsSchema.optional(),
});
const DealerCreate = z.strictObject({ clientToken: Token, ad: z.string().min(1).max(200), vergiNo: TaxNo, tavan: Ceiling, sebep: Reason });
const DealerCeiling = z.strictObject({ clientToken: Token, tavan: Ceiling, sebep: Reason });
const DealerKey = z.strictObject({ clientToken: Token, kid: z.string().regex(/^bayi-[a-z0-9-]{1,60}$/) });
const UserCreate = z.strictObject({
  clientToken: Token,
  kullaniciAdi: z.string().min(3).max(60),
  adSoyad: z.string().min(1).max(120),
  rol: z.enum(PORTAL_ROLES),
  bayiId: z.uuid().nullable().optional(),
  parola: z.string().min(1).max(200),
});
const UserPassword = z.strictObject({ clientToken: Token, parola: z.string().min(1).max(200), sebep: Reason });

const withPath = (body: object, id: string) => ({ ...body, _yol: id });

/** Ağır yaptırımı (K4 · K5 · geri sayımı 7 günden kısa K3) yalnız `yaptirim:agir` taşıyan rol uygular/planlar/kaldırır. */
function requireHeavyRole(c: PortalRequestContext, heavy: boolean, what: string): void {
  if (heavy && !roleHas(c.session.user.rol, "yaptirim:agir")) {
    throw new VendorError(403, "YETKISIZ", `${what} ağır yaptırımdır: yalnız yönetici`);
  }
}
const moduleChanges = (moduller: string[] | undefined, confirmed: boolean | undefined): string[] | undefined => {
  if (moduller === undefined) return undefined;
  const modules = assertKnownModules(moduller);
  assertProductionKept(modules, confirmed);
  return modules;
};

// ---------------------------------------------------------------- aktif/pasif üçlüsü

function activeToggle(
  path: string,
  permission: PortalRouteDef["permission"],
  active: boolean,
  what: string,
  run: (c: PortalRequestContext, id: string, reason: string) => Promise<{ event: string; entity: string; exec: (tx: Tx) => Promise<unknown> }>,
): PortalRouteDef {
  return {
    method: "post",
    path,
    permission,
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", what);
      const b = bodyOf(c, ReasonOnly);
      const plan = await run(c, id, b.sebep);
      return portalAction(c, {
        action: `${plan.entity.toUpperCase()}_${active ? "AKTIF" : "PASIF"}`,
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: plan.exec,
        respond: (row) => ({ data: row }),
        audit: () => [{ event: plan.event, entity: plan.entity, entityId: id, summary: { sebep: b.sebep } }],
      });
    },
  };
}

export const VENDOR_PORTAL_ROUTES: readonly PortalRouteDef[] = [
  // ------------------------------------------------------------ okuma
  { method: "get", path: "/pano", permission: "portal:oku", kimlik: "OKUMA", handler: async (c) => ({ data: await q.dashboard(prisma, c.nowMs) }) },
  {
    method: "get",
    path: "/katalog",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async () => ({
      data: {
        moduller: PORTAL_MODULE_KEYS,
        varsayilanModuller: DEFAULT_ENTITLEMENT_MODULES,
        siniflar: LICENSE_CLASSES,
        kademeler: SANCTION_LEVELS,
        kisitlamaGunSecenekleri: RESTRICTION_DAY_PRESETS,
        roller: PORTAL_ROLES,
      },
    }),
  },
  {
    method: "get",
    path: "/musteriler",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => {
      const dealerId = queryText(c.req, "bayiId");
      return { data: await q.listCustomers(prisma, { search: queryText(c.req, "arama"), active: queryBool(c.req, "aktif"), dealerId, ...pageQuery(c.req) }) };
    },
  },
  { method: "get", path: "/musteriler/:id", permission: "portal:oku", kimlik: "OKUMA", handler: async (c) => ({ data: await q.customerDetail(prisma, idParam(c.req, "id", "Müşteri")) }) },
  { method: "get", path: "/tesisler", permission: "portal:oku", kimlik: "OKUMA", handler: async (c) => ({ data: await q.listSites(prisma, { customerId: queryText(c.req, "musteriId") }) }) },
  {
    method: "get",
    path: "/kurulumlar",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({
      data: await q.listInstallations(prisma, {
        siteId: queryText(c.req, "tesisId"),
        status: queryEnum(c.req, "durum", ["ETKINLESMEDI", "ETKIN", "DEVREDILDI", "IPTAL"] as const),
        search: queryText(c.req, "arama"),
        ...pageQuery(c.req),
      }),
    }),
  },
  { method: "get", path: "/kurulumlar/:id", permission: "portal:oku", kimlik: "OKUMA", handler: async (c) => ({ data: await q.installationDetail(prisma, idParam(c.req, "id", "Kurulum")) }) },
  { method: "get", path: "/haklar/:id", permission: "portal:oku", kimlik: "OKUMA", handler: async (c) => ({ data: await q.entitlementDetail(prisma, idParam(c.req, "id", "Hak")) }) },
  {
    method: "get",
    path: "/planli-eylemler",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({
      data: await q.listPlannedActions(prisma, { status: queryEnum(c.req, "durum", ["BEKLIYOR", "UYGULANDI", "IPTAL"] as const), installationDbId: queryText(c.req, "kurulumId"), ...pageQuery(c.req) }),
    }),
  },
  {
    method: "get",
    path: "/tasima-talepleri",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({ data: await q.listTransfers(prisma, { status: queryEnum(c.req, "durum", ["BEKLIYOR", "ONAYLANDI", "REDDEDILDI"] as const), ...pageQuery(c.req) }) }),
  },
  {
    method: "get",
    path: "/kopya-uyarilari",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({ data: await q.listCopyAlerts(prisma, { status: queryEnum(c.req, "durum", ["ACIK", "KAPANDI"] as const), ...pageQuery(c.req) }) }),
  },
  { method: "get", path: "/kanallar", permission: "portal:oku", kimlik: "OKUMA", handler: async () => ({ data: await listChannels(prisma) }) },
  { method: "get", path: "/bayiler", permission: "portal:oku", kimlik: "OKUMA", handler: async () => ({ data: await q.listDealers(prisma) }) },
  { method: "get", path: "/bayiler/:id", permission: "portal:oku", kimlik: "OKUMA", handler: async (c) => ({ data: await q.dealerDetail(prisma, idParam(c.req, "id", "Bayi")) }) },
  { method: "get", path: "/kullanicilar", permission: "kullanici:yonet", kimlik: "OKUMA", handler: async () => ({ data: await q.listUsers(prisma) }) },
  {
    method: "get",
    path: "/denetim",
    permission: "denetim:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({
      data: await q.listAudit(prisma, { entity: queryText(c.req, "varlik", 40), entityId: queryText(c.req, "varlikId", 64), event: queryText(c.req, "olay", 60), ...pageQuery(c.req) }),
    }),
  },
  { method: "get", path: "/anahtarlar", permission: "anahtar:oku", kimlik: "OKUMA", handler: async (c) => ({ data: await q.keyStatus(c.ctx, prisma, c.nowMs) }) },

  // ------------------------------------------------------------ müşteri · tesis · kurulum
  {
    method: "post",
    path: "/musteriler",
    permission: "musteri:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, CustomerCreate);
      return portalAction(c, {
        action: "MUSTERI_EKLE",
        clientToken: b.clientToken,
        body: b,
        run: (tx) => createCustomerTx(tx, { name: b.ad, taxNo: b.vergiNo, dealerId: b.bayiId }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "MUSTERI_EKLENDI", entity: "Musteri", entityId: row.id, summary: { bayiId: row.bayiId } }],
      });
    },
  },
  {
    method: "patch",
    path: "/musteriler/:id",
    permission: "musteri:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Müşteri");
      const b = bodyOf(c, CustomerUpdate);
      return portalAction(c, {
        action: "MUSTERI_GUNCELLE",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => updateCustomerTx(tx, { customerId: id, name: b.ad, taxNo: b.vergiNo, dealerId: b.bayiId }),
        respond: (row) => ({ data: row }),
        audit: (row) => [{ event: "MUSTERI_GUNCELLENDI", entity: "Musteri", entityId: row.id, summary: { alanlar: Object.keys(b).filter((k) => k !== "clientToken") } }],
      });
    },
  },
  activeToggle("/musteriler/:id/pasif", "musteri:yaz", false, "Müşteri", async (_c, id, reason) => ({
    event: "MUSTERI_PASIF",
    entity: "Musteri",
    exec: (tx) => setCustomerActiveTx(tx, { customerId: id, active: false, reason }),
  })),
  activeToggle("/musteriler/:id/aktif", "musteri:yaz", true, "Müşteri", async (_c, id, reason) => ({
    event: "MUSTERI_AKTIF",
    entity: "Musteri",
    exec: (tx) => setCustomerActiveTx(tx, { customerId: id, active: true, reason }),
  })),
  {
    method: "post",
    path: "/tesisler",
    permission: "musteri:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, SiteCreate);
      return portalAction(c, {
        action: "TESIS_EKLE",
        clientToken: b.clientToken,
        body: b,
        run: (tx) => createSiteTx(tx, { customerId: b.musteriId, name: b.ad }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "TESIS_EKLENDI", entity: "Tesis", entityId: row.id }],
      });
    },
  },
  {
    method: "patch",
    path: "/tesisler/:id",
    permission: "musteri:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Tesis");
      const b = bodyOf(c, SiteUpdate);
      const site = await findSite(prisma, id);
      return portalAction(c, {
        action: "TESIS_GUNCELLE",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => updateSiteTx(tx, { site, name: b.ad }),
        respond: (row) => ({ data: row }),
        audit: (row) => [{ event: "TESIS_GUNCELLENDI", entity: "Tesis", entityId: row.id }],
      });
    },
  },
  activeToggle("/tesisler/:id/pasif", "musteri:yaz", false, "Tesis", async (_c, id, reason) => {
    const site = await findSite(prisma, id);
    return { event: "TESIS_PASIF", entity: "Tesis", exec: (tx) => setSiteActiveTx(tx, { site, active: false, reason }) };
  }),
  activeToggle("/tesisler/:id/aktif", "musteri:yaz", true, "Tesis", async (_c, id, reason) => {
    const site = await findSite(prisma, id);
    return { event: "TESIS_AKTIF", entity: "Tesis", exec: (tx) => setSiteActiveTx(tx, { site, active: true, reason }) };
  }),
  {
    method: "post",
    path: "/kurulumlar",
    permission: "musteri:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, InstallationCreate);
      const site = await findSite(prisma, b.tesisId);
      return portalAction(c, {
        action: "KURULUM_EKLE",
        clientToken: b.clientToken,
        body: b,
        run: (tx) =>
          createInstallationTx(tx, { site, siteId: site.id, installationId: b.kurulumId, licenseClass: b.sinif, channelCode: b.kanalKodu, name: b.ad, pollMinutes: b.yoklamaAraligiDk }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "KURULUM_EKLENDI", entity: "Kurulum", entityId: row.id, summary: { sinif: row.sinif, kanal: row.kanalKodu } }],
      });
    },
  },
  {
    method: "patch",
    path: "/kurulumlar/:id",
    permission: "musteri:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, InstallationUpdate);
      return portalAction(c, {
        action: "KURULUM_GUNCELLE",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) =>
          updateInstallationTx(tx, { installationDbId: id, name: b.ad, channelCode: b.kanalKodu, pollMinutes: b.yoklamaAraligiDk, licenseClass: b.sinif, actor: c.session.actor }),
        respond: (row) => ({ data: row }),
        audit: (row) => [{ event: "KURULUM_GUNCELLENDI", entity: "Kurulum", entityId: row.id, summary: { alanlar: Object.keys(b).filter((k) => k !== "clientToken") } }],
      });
    },
  },
  activeToggle("/kurulumlar/:id/pasif", "musteri:yaz", false, "Kurulum", async (c, id, reason) => {
    const installation = await findInstallationWithSite(prisma, id);
    return { event: "KURULUM_PASIF", entity: "Kurulum", exec: (tx) => setInstallationActiveTx(tx, { installation, active: false, reason, actor: c.session.actor }) };
  }),
  activeToggle("/kurulumlar/:id/aktif", "musteri:yaz", true, "Kurulum", async (c, id, reason) => {
    const installation = await findInstallationWithSite(prisma, id);
    return { event: "KURULUM_AKTIF", entity: "Kurulum", exec: (tx) => setInstallationActiveTx(tx, { installation, active: true, reason, actor: c.session.actor }) };
  }),

  // ------------------------------------------------------------ HAK · kod
  {
    method: "post",
    path: "/kurulumlar/:id/hak",
    permission: "hak:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, EntitlementCreate);
      const modules = moduleChanges(b.moduller ?? [...DEFAULT_ENTITLEMENT_MODULES], b.uretimModuluCikarilsin)!;
      return portalAction(c, {
        action: "HAK_EKLE",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) =>
          createEntitlementTx(tx, {
            installationDbId: id,
            modules,
            perpetual: b.kalici,
            maintenanceUntil: new Date(b.bakimBitis),
            validUntil: null,
            nowMs: c.nowMs,
          }),
        respond: (hak) => ({ status: 201, data: hak }),
        audit: (hak) => [{ event: "HAK_EKLENDI", entity: "Hak", entityId: hak.id, summary: { lisansNo: hak.lisansNo, moduller: hak.moduller } }],
      });
    },
  },
  {
    method: "post",
    path: "/haklar/:id/surum",
    permission: "hak:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Hak");
      const b = bodyOf(c, EntitlementVersion);
      const changes: EntitlementChanges = {
        modules: moduleChanges(b.moduller, b.uretimModuluCikarilsin),
        perpetual: b.kalici,
        maintenanceUntil: b.bakimBitis ? new Date(b.bakimBitis) : undefined,
      };
      const password = passwordBuffer(b.kokParolasi);
      return portalAction(c, {
        action: "HAK_SURUM",
        clientToken: b.clientToken,
        body: withPath(b, id),
        prepare: () => prepareEntitlementVersion(c.ctx, { entitlementId: id, changes, password, reason: b.sebep, actor: c.session.actor, nowMs: c.nowMs }),
        run: async (tx, p) => ({ row: await recordEntitlementVersionTx(tx, p), p }),
        respond: ({ row }) => ({ status: 201, data: { id: row.id, hakId: row.hakId, surum: row.surum, imzalayanKid: row.imzalayanKid, verilis: row.verilis } }),
        audit: ({ row, p }) => [entitlementVersionAudit(row, p)],
        release: () => password.fill(0),
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/etkinlestirme-kodu",
    permission: "kod:uret",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, CodeCreate);
      return portalAction(c, {
        action: "KOD_URET",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => createActivationCodeTx(tx, c.ctx, { installationDbId: id, validDays: b.gecerlilikGun, actor: c.session.actor, nowMs: c.nowMs }),
        // Düz kod YALNIZ canlı yanıtta: saklanan (tekrar) yanıtta yok — yeni kod üretilir.
        respond: (r) => ({
          status: 201,
          data: { id: r.id, kod: r.code, kodSonu: r.codeTail, gecerlilikBitis: r.expiresAt },
          stored: { id: r.id, kod: null, kodSonu: r.codeTail, gecerlilikBitis: r.expiresAt, kodGosterilemez: true },
        }),
        audit: (r) => [{ event: "ETKINLESTIRME_KODU", entity: "Kurulum", entityId: id, summary: { kodSonu: r.codeTail } }],
      });
    },
  },

  // ------------------------------------------------------------ yaptırım
  {
    method: "post",
    path: "/kurulumlar/:id/yaptirim",
    permission: "yaptirim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, LightSanction);
      const modules = b.moduller ? assertKnownModules(b.moduller) : undefined;
      const restrictionDate = b.kisitlamaTarihi ? new Date(b.kisitlamaTarihi) : undefined;
      requireHeavyRole(c, sanctionInputIsHeavy({ level: b.kademe, restrictionDays: b.kisitlamaGun, restrictionDate }, c.nowMs), "Geri sayımı 7 günden kısa K3");
      return portalAction(c, {
        action: "YAPTIRIM",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) =>
          applySanctionTx(tx, {
            installationDbId: id,
            level: b.kademe,
            message: b.mesaj,
            restrictionDays: b.kisitlamaGun,
            restrictionDate,
            modules,
            reason: b.sebep,
            actor: c.session.actor,
            confirmation: b.onay,
            nowMs: c.nowMs,
          }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [sanctionAudit(row)],
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/agir-yaptirim",
    permission: "yaptirim:agir",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, HeavySanction);
      return portalAction(c, {
        action: "AGIR_YAPTIRIM",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) =>
          applySanctionTx(tx, { installationDbId: id, level: b.kademe, message: b.mesaj, reason: b.sebep, actor: c.session.actor, confirmation: b.onay, nowMs: c.nowMs }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [sanctionAudit(row)],
      });
    },
  },
  {
    method: "post",
    path: "/yaptirimlar/:id/geri-al",
    permission: "yaptirim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Yaptırım eylemi");
      const b = bodyOf(c, ReasonOnly);
      const target = await findSanctionAction(prisma, id);
      // Ağır eylemi (K4 · K5 · kısa geri sayımlı K3) yalnız onu uygulayabilen rol kaldırır.
      requireHeavyRole(c, sanctionRowIsHeavy(target), `${target.tur} geri alma`);
      return portalAction(c, {
        action: "YAPTIRIM_GERI_AL",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => revertSanctionTx(tx, { target, reason: b.sebep, actor: c.session.actor }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [sanctionAudit(row)],
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/zorlama",
    permission: "yaptirim:agir",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, Enforcement);
      return portalAction(c, {
        action: "ZORLAMA",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => setEnforcementTx(tx, { installationDbId: id, enforce: b.zorla, reason: b.sebep, actor: c.session.actor }),
        respond: (row) => ({ data: { degisti: row !== null, eylem: row } }),
        audit: (row) => (row ? [sanctionAudit(row)] : []),
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/uzat",
    permission: "yaptirim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, Extend);
      return portalAction(c, {
        action: "UZAT",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => extendValidityTx(tx, { installationDbId: id, days: b.gun, reason: b.sebep, actor: c.session.actor, nowMs: c.nowMs }),
        respond: (row) => ({ data: { degisti: row !== null, eylem: row } }),
        audit: (row) => (row ? [sanctionAudit(row)] : []),
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/gecerlilik",
    permission: "yaptirim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, Validity);
      return portalAction(c, {
        action: "GECERLILIK",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => setValidityEndTx(tx, { installationDbId: id, validUntil: b.tarih ? new Date(b.tarih) : null, reason: b.sebep, actor: c.session.actor }),
        respond: (row) => ({ data: { degisti: row !== null, eylem: row } }),
        audit: (row) => (row ? [sanctionAudit(row)] : []),
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/planli-eylem",
    permission: "yaptirim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, Planned);
      const modules = b.moduller ? assertKnownModules(b.moduller) : undefined;
      requireHeavyRole(c, plannedK3IsHeavy(b.kademe, b.kisitlamaGun), "Geri sayımı 7 günden kısa planlı K3");
      return portalAction(c, {
        action: "PLANLI_EYLEM",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) =>
          schedulePlannedActionTx(tx, {
            installationDbId: id,
            level: b.kademe,
            dueAt: new Date(b.vade),
            message: b.mesaj,
            restrictionDays: b.kisitlamaGun,
            modules,
            reason: b.sebep,
            actor: c.session.actor,
            confirmation: b.onay,
          }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "PLANLI_EYLEM", entity: "PlanliEylem", entityId: row.id, summary: { tur: row.tur, vade: row.vade.toISOString(), sebep: row.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/planli-eylemler/:id/iptal",
    permission: "yaptirim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Planlı eylem");
      const b = bodyOf(c, ReasonOnly);
      const planned = await prisma.planliEylem.findUnique({ where: { id } });
      if (!planned) throw new VendorError(404, "BULUNAMADI", "Planlı eylem bulunamadı");
      return portalAction(c, {
        action: "PLANLI_EYLEM_IPTAL",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => cancelPlannedActionTx(tx, { planned, reason: b.sebep, actor: c.session.actor, nowMs: c.nowMs }),
        respond: (row) => ({ data: row }),
        audit: () => [{ event: "PLANLI_EYLEM_IPTAL", entity: "PlanliEylem", entityId: id, summary: { sebep: b.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/taksit-plani",
    permission: "yaptirim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, InstallmentPlan);
      requireHeavyRole(c, plannedK3IsHeavy("K3", installmentRestrictionDays(b.kisitlamaGun)), "Kısıtlama günü 7'den kısa taksit planı");
      return portalAction(c, {
        action: "TAKSIT_PLANI",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) =>
          createInstallmentPlanTx(tx, {
            installationDbId: id,
            description: b.aciklama,
            items: b.kalemler.map((k) => ({ dueAt: new Date(k.vade), amount: k.tutar })),
            extendDays: b.uzatmaGun,
            graceDays: b.gecikmeGun,
            restrictionDays: b.kisitlamaGun,
            actor: c.session.actor,
            confirmation: b.onay,
          }),
        respond: (plan) => ({ status: 201, data: plan }),
        audit: (plan) => [{ event: "TAKSIT_PLANI", entity: "TaksitPlani", entityId: plan.id, summary: { kurulumId: id, kalem: plan.kalemler.length } }],
      });
    },
  },
  {
    method: "post",
    path: "/taksit-kalemleri/:id/odeme",
    permission: "yaptirim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Taksit kalemi");
      const b = bodyOf(c, TokenOnly);
      const item = await findInstallmentItem(id);
      return portalAction(c, {
        action: "TAKSIT_ODEME",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => recordInstallmentPaymentTx(tx, { item, actor: c.session.actor, nowMs: c.nowMs }),
        respond: (r) => ({ data: { kalem: r.item, gecerlilik: r.validity, kaldirilanK3: r.revertedK3 } }),
        audit: (r) => [{ event: "TAKSIT_ODENDI", entity: "TaksitKalemi", entityId: r.item.id, summary: { sira: r.item.sira, yeniBitis: (r.validity?.parametre as { yeni?: string } | undefined)?.yeni ?? null } }],
      });
    },
  },
  {
    method: "post",
    path: "/taksit-planlari/:id/kapat",
    permission: "yaptirim:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Taksit planı");
      const b = bodyOf(c, ReasonOnly);
      const plan = await prisma.taksitPlani.findUnique({ where: { id } });
      if (!plan) throw new VendorError(404, "BULUNAMADI", "Taksit planı bulunamadı");
      return portalAction(c, {
        action: "TAKSIT_PLANI_KAPAT",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => closeInstallmentPlanTx(tx, { plan, reason: b.sebep, actor: c.session.actor, nowMs: c.nowMs }),
        respond: (row) => ({ data: row }),
        audit: () => [{ event: "TAKSIT_PLANI_KAPANDI", entity: "TaksitPlani", entityId: id, summary: { sebep: b.sebep } }],
      });
    },
  },

  // ------------------------------------------------------------ kurulum yönetimi
  ...(["onayla", "reddet"] as const).map(
    (verb): PortalRouteDef => ({
      method: "post",
      path: `/tasima-talepleri/:id/${verb}`,
      permission: "kurulum:yonet",
      kimlik: "ISLEM_KIMLIGI",
      handler: async (c) => {
        const id = idParam(c.req, "id", "Taşıma talebi");
        const b = bodyOf(c, ReasonOnly);
        const talep = await findTransferRequest(id);
        const decision = verb === "onayla" ? "ONAYLANDI" : "REDDEDILDI";
        return portalAction(c, {
          action: `TASIMA_${decision}`,
          clientToken: b.clientToken,
          body: withPath(b, id),
          run: (tx) => decideTransferTx(tx, { talep, decision, actor: c.session.actor, reason: b.sebep }),
          respond: (row) => ({ data: { ...row, yeniAcikAnahtar: undefined } }),
          audit: (row) => [{ event: `TASIMA_${decision}`, entity: "TasimaTalebi", entityId: row.id, summary: { sebep: b.sebep } }],
        });
      },
    }),
  ),
  {
    method: "post",
    path: "/kopya-uyarilari/:id/kapat",
    permission: "kurulum:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kopya uyarısı");
      const b = bodyOf(c, CopyAlertClose);
      const alert = await findCopyAlert(id);
      return portalAction(c, {
        action: "KOPYA_UYARISI_KAPAT",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => closeCopyAlertTx(tx, { alert, acceptOtherFingerprint: b.digerParmakIziniKabulEt, reason: b.sebep, actor: c.session.actor }),
        respond: (row) => ({ data: row }),
        audit: () => [{ event: "KOPYA_UYARISI_KAPANDI", entity: "Kurulum", entityId: alert.kurulumId, summary: { uyariId: id, kabul: b.digerParmakIziniKabulEt, sebep: b.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/dr-geri-al",
    permission: "kurulum:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, ReasonOnly);
      return portalAction(c, {
        action: "DR_GERI_AL",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => revertDrTakeoverTx(tx, { mainInstallationDbId: id, actor: c.session.actor, reason: b.sebep }),
        respond: () => ({ data: null }),
        audit: () => [{ event: "DR_GERI_ALINDI", entity: "Kurulum", entityId: id, summary: { sebep: b.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/iptal",
    permission: "kurulum:iptal",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, ReasonOnly);
      return portalAction(c, {
        action: "KURULUM_IPTAL",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => cancelInstallationTx(tx, { installationDbId: id, reason: b.sebep, actor: c.session.actor }),
        respond: () => ({ data: null }),
        audit: () => [{ event: "KURULUM_IPTAL", entity: "Kurulum", entityId: id, summary: { sebep: b.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/iptal-geri-al",
    permission: "kurulum:iptal",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, ReasonOnly);
      return portalAction(c, {
        action: "KURULUM_IPTAL_GERI_AL",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => reinstateInstallationTx(tx, { installationDbId: id, reason: b.sebep, actor: c.session.actor }),
        respond: () => ({ data: null }),
        audit: () => [{ event: "KURULUM_IPTAL_GERI_ALINDI", entity: "Kurulum", entityId: id, summary: { sebep: b.sebep } }],
      });
    },
  },

  // ------------------------------------------------------------ kanal
  {
    method: "post",
    path: "/kanallar",
    permission: "kanal:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, ChannelCreate);
      return portalAction(c, {
        action: "KANAL_EKLE",
        clientToken: b.clientToken,
        body: b,
        run: (tx) => createChannelTx(tx, { code: b.kod, name: b.ad, kind: b.tur, versions: b.guncelSurumler }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "KANAL_EKLENDI", entity: "Kanal", entityId: row.id, summary: { kod: row.kod, tur: row.tur } }],
      });
    },
  },
  {
    method: "patch",
    path: "/kanallar/:id",
    permission: "kanal:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kanal");
      const b = bodyOf(c, ChannelUpdate);
      return portalAction(c, {
        action: "KANAL_GUNCELLE",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => updateChannelTx(tx, { channelId: id, name: b.ad, kind: b.tur, versions: b.guncelSurumler }),
        respond: (row) => ({ data: row }),
        audit: (row) => [{ event: "KANAL_GUNCELLENDI", entity: "Kanal", entityId: row.id, summary: { kod: row.kod, alanlar: Object.keys(b).filter((k) => k !== "clientToken") } }],
      });
    },
  },

  // ------------------------------------------------------------ bayi
  {
    method: "post",
    path: "/bayiler",
    permission: "bayi:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, DealerCreate);
      const modules = assertKnownModules(b.tavan.moduller);
      return portalAction(c, {
        action: "BAYI_EKLE",
        clientToken: b.clientToken,
        body: b,
        run: (tx) =>
          createDealerTx(tx, { name: b.ad, taxNo: b.vergiNo, ceiling: ceilingInput(b.tavan, modules), reason: b.sebep, actor: c.session.actor }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "BAYI_EKLENDI", entity: "Bayi", entityId: row.id, summary: { tavanSurum: 1, sebep: b.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/bayiler/:id/tavan",
    permission: "bayi:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Bayi");
      const b = bodyOf(c, DealerCeiling);
      const modules = assertKnownModules(b.tavan.moduller);
      return portalAction(c, {
        action: "BAYI_TAVAN",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => setDealerCeilingTx(tx, { dealerId: id, ceiling: ceilingInput(b.tavan, modules), reason: b.sebep, actor: c.session.actor }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "BAYI_TAVANI", entity: "Bayi", entityId: id, summary: { surum: row.surum, sebep: b.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/bayiler/:id/anahtar",
    permission: "bayi:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Bayi");
      const b = bodyOf(c, DealerKey);
      await findDealer(prisma, id);
      reloadKeys(c.ctx);
      return portalAction(c, {
        action: "BAYI_ANAHTAR",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => linkDealerKeyTx(tx, c.ctx, { dealerId: id, kid: b.kid, nowMs: c.nowMs }),
        respond: (row) => ({ data: row }),
        audit: () => [{ event: "BAYI_ANAHTARI_BAGLANDI", entity: "Bayi", entityId: id, summary: { kid: b.kid } }],
      });
    },
  },
  activeToggle("/bayiler/:id/pasif", "bayi:yonet", false, "Bayi", async (_c, id, reason) => ({
    event: "BAYI_PASIF",
    entity: "Bayi",
    exec: (tx) => setDealerActiveTx(tx, { dealerId: id, active: false, reason }),
  })),
  activeToggle("/bayiler/:id/aktif", "bayi:yonet", true, "Bayi", async (_c, id, reason) => ({
    event: "BAYI_AKTIF",
    entity: "Bayi",
    exec: (tx) => setDealerActiveTx(tx, { dealerId: id, active: true, reason }),
  })),

  // ------------------------------------------------------------ portal kullanıcıları
  {
    method: "post",
    path: "/kullanicilar",
    permission: "kullanici:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, UserCreate);
      return portalAction(c, {
        action: "KULLANICI_EKLE",
        clientToken: b.clientToken,
        body: b,
        prepare: () => hashPortalPassword(b.parola),
        run: (tx, hash) => createPortalUserTx(tx, c.ctx, { username: b.kullaniciAdi, fullName: b.adSoyad, role: b.rol, dealerId: b.bayiId, passwordHash: hash }),
        // TOTP sırrı YALNIZ canlı yanıtta (kurulumu hesabı açan yönetici yapar); saklanan yanıtta yok.
        respond: (r) => ({ status: 201, data: { kullanici: userView(r.user), totp: r.totp }, stored: { kullanici: userView(r.user), totp: null, totpGosterilemez: true } }),
        audit: (r) => [{ event: "PORTAL_KULLANICI_EKLENDI", entity: "PortalKullanici", entityId: r.user.id, summary: { rol: r.user.rol, bayiId: r.user.bayiId } }],
      });
    },
  },
  activeToggle("/kullanicilar/:id/pasif", "kullanici:yonet", false, "Kullanıcı", async (c, id, reason) => ({
    event: "PORTAL_KULLANICI_PASIF",
    entity: "PortalKullanici",
    exec: async (tx) => userView(await setPortalUserActiveTx(tx, { userId: id, active: false, reason, byUserId: c.session.user.id })),
  })),
  activeToggle("/kullanicilar/:id/aktif", "kullanici:yonet", true, "Kullanıcı", async (c, id, reason) => ({
    event: "PORTAL_KULLANICI_AKTIF",
    entity: "PortalKullanici",
    exec: async (tx) => userView(await setPortalUserActiveTx(tx, { userId: id, active: true, reason, byUserId: c.session.user.id })),
  })),
  {
    method: "post",
    path: "/kullanicilar/:id/totp-sifirla",
    permission: "kullanici:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kullanıcı");
      const b = bodyOf(c, ReasonOnly);
      await findPortalUser(prisma, id);
      return portalAction(c, {
        action: "KULLANICI_TOTP_SIFIRLA",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => resetPortalUserTotpTx(tx, c.ctx, { userId: id, reason: b.sebep }),
        respond: (r) => ({ data: { kullanici: userView(r.user), totp: r.totp }, stored: { kullanici: userView(r.user), totp: null, totpGosterilemez: true } }),
        audit: () => [{ event: "PORTAL_TOTP_SIFIRLANDI", entity: "PortalKullanici", entityId: id, summary: { sebep: b.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/kullanicilar/:id/kilit-ac",
    permission: "kullanici:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kullanıcı");
      const b = bodyOf(c, TokenOnly);
      return portalAction(c, {
        action: "KULLANICI_KILIT_AC",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: async (tx) => userView(await unlockPortalUserTx(tx, { userId: id })),
        respond: (u) => ({ data: u }),
        audit: () => [{ event: "PORTAL_KILIT_ACILDI", entity: "PortalKullanici", entityId: id }],
      });
    },
  },
  {
    method: "post",
    path: "/kullanicilar/:id/parola",
    permission: "kullanici:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kullanıcı");
      const b = bodyOf(c, UserPassword);
      return portalAction(c, {
        action: "KULLANICI_PAROLA",
        clientToken: b.clientToken,
        body: withPath(b, id),
        prepare: () => hashPortalPassword(b.parola),
        run: async (tx, hash) => userView(await setPortalUserPasswordTx(tx, { userId: id, passwordHash: hash, reason: b.sebep })),
        respond: (u) => ({ data: u }),
        audit: () => [{ event: "PORTAL_PAROLA_SIFIRLANDI", entity: "PortalKullanici", entityId: id, summary: { sebep: b.sebep } }],
      });
    },
  },
];
