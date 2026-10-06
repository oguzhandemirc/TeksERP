// BAYİ ALT-PORTALI JSON API'si — GENEL dinleyicide (CF arkası), /bayi/api altında. Yalnız BAYI rolü
// girer (satıcı rolleri buradan giriş yapamaz; oturum GENEL dinleyiciye bağlı). Bayi yalnız KENDİ
// müşterilerini görür/yönetir; başkasınınki "bulunamadı"dır. Yaptırım, taşıma, anahtar, kullanıcı
// yönetimi YOK. Bayi imzalı HAK: bayi parolası imza alt sürecinin stdin'ine; sunucu protokolün
// sertifika kısıtına EK olarak bayinin GÜNCEL tavanını uygular (dealer.service.ts).
// Sahiplik iki kez: kilitsiz ön okuma (hızlı "yok") + eylemin tx'inde müşteri kilidi ALTINDA (D10) —
// müşteri o arada başka bayiye geçtiyse eylem "bulunamadı" ile düşer.
import type { Hak, Kurulum, Musteri, Tesis } from "@prisma/client";
import { z } from "zod";
import { LICENSE_CLASSES } from "../lisans-protokol";
import { passwordBuffer } from "../keys/key-files";
import { notFoundError } from "../lib/errors";
import { withSigningPasswordGuard } from "../portal/signing-guard";
import { prisma, type Db } from "../lib/prisma";
import { DEFAULT_ENTITLEMENT_MODULES, assertKnownModules, assertProductionKept } from "../portal/module-catalog";
import * as q from "../portal/queries";
import { assertWithinCeiling, ceilingViolations, currentCeiling, signedFieldsOf, findDealer, prepareDealerEntitlementVersion } from "../services/dealer.service";
import {
  createDealerActivationCodeTx,
  createDealerEntitlementTx,
  createDealerInstallationTx,
  installationCustomerId,
  recordDealerEntitlementVersionTx,
} from "../services/dealer-ownership.service";
import { entitlementVersionAudit, type EntitlementChanges } from "../services/entitlement.service";
import { createCustomerTx, createSiteTx } from "../services/master-data.service";
import { ClientTokenSchema, IsoSchema, ReasonSchema, bodyOf, idParam, pageQuery, portalAction, queryText, type PortalRequestContext, type PortalRouteDef } from "./portal-http";

const Token = ClientTokenSchema;
const ModuleList = z.array(z.string().min(1).max(64)).max(64);

const CustomerCreate = z.strictObject({ clientToken: Token, ad: z.string().min(1).max(200), vergiNo: z.string().max(20).nullable().optional() });
const SiteCreate = z.strictObject({ clientToken: Token, musteriId: z.uuid(), ad: z.string().min(1).max(200) });
// Lisans kimliği gövdede YOK: sunucu üretir (D14).
const InstallationCreate = z.strictObject({
  clientToken: Token,
  tesisId: z.uuid(),
  sinif: z.enum(LICENSE_CLASSES),
  /** Güncelleme grubu (tavandaki gruplardan); yoksa sınıftan (K-3). Bayi grubu sonradan DEĞİŞTİREMEZ (K-4). */
  kanalKodu: z.string().min(1).max(40).optional(),
  ad: z.string().max(200).nullable().optional(),
});
const EntitlementCreate = z.strictObject({
  clientToken: Token,
  moduller: ModuleList.optional(),
  kalici: z.boolean(),
  bakimBitis: IsoSchema,
  /** Geçerlilik bitişi (vadeli); DEMO'da zorunlu (K5 — sunucu reddeder). Yoksa süresiz doğar. */
  gecerlilikBitis: IsoSchema.optional(),
  uretimModuluCikarilsin: z.boolean().optional(),
});
const EntitlementVersion = z.strictObject({
  clientToken: Token,
  bayiParolasi: z.string().min(1).max(200),
  sebep: ReasonSchema,
  moduller: ModuleList.optional(),
  kalici: z.boolean().optional(),
  bakimBitis: IsoSchema.optional(),
  uretimModuluCikarilsin: z.boolean().optional(),
});
const CodeCreate = z.strictObject({ clientToken: Token, gecerlilikGun: z.number().int().min(1).max(365).optional() });

function dealerOf(c: PortalRequestContext): string {
  const id = c.session.user.bayiId;
  // Oturum kapısı BAYI rolünü bayisiz geçirmez (DB CHECK de); savunma: bayisiz oturum hiçbir şey görmez.
  if (!id) throw notFoundError("Bayi");
  return id;
}

async function ownedCustomer(db: Db, dealerId: string, id: string): Promise<Musteri> {
  const row = await db.musteri.findFirst({ where: { id, bayiId: dealerId } });
  if (!row) throw notFoundError("Müşteri");
  return row;
}

async function ownedSite(db: Db, dealerId: string, id: string): Promise<Tesis> {
  const row = await db.tesis.findFirst({ where: { id, musteri: { bayiId: dealerId } } });
  if (!row) throw notFoundError("Tesis");
  return row;
}

async function ownedInstallation(db: Db, dealerId: string, id: string): Promise<Kurulum> {
  const row = await db.kurulum.findFirst({ where: { id, tesis: { musteri: { bayiId: dealerId } } } });
  if (!row) throw notFoundError("Kurulum");
  return row;
}

async function ownedEntitlement(db: Db, dealerId: string, id: string): Promise<Hak> {
  const row = await db.hak.findFirst({ where: { id, kurulum: { tesis: { musteri: { bayiId: dealerId } } } } });
  if (!row) throw notFoundError("Hak");
  return row;
}

const withPath = (body: object, id: string) => ({ ...body, _yol: id });

export const DEALER_PORTAL_ROUTES: readonly PortalRouteDef[] = [
  { method: "get", path: "/ben", permission: "bayi:portal", kimlik: "OKUMA", handler: async (c) => ({ data: await q.dealerSelf(prisma, dealerOf(c)) }) },
  {
    method: "get",
    path: "/musteriler",
    permission: "bayi:portal",
    kimlik: "OKUMA",
    handler: async (c) => ({ data: await q.listCustomers(prisma, { dealerId: dealerOf(c), search: queryText(c.req, "arama"), ...pageQuery(c.req) }) }),
  },
  { method: "get", path: "/musteriler/:id", permission: "bayi:portal", kimlik: "OKUMA", handler: async (c) => ({ data: await q.customerDetail(prisma, idParam(c.req, "id", "Müşteri"), { dealerId: dealerOf(c) }) }) },
  { method: "get", path: "/tesisler", permission: "bayi:portal", kimlik: "OKUMA", handler: async (c) => ({ data: await q.listSites(prisma, { dealerId: dealerOf(c), customerId: queryText(c.req, "musteriId") }) }) },
  {
    method: "get",
    path: "/kurulumlar",
    permission: "bayi:portal",
    kimlik: "OKUMA",
    handler: async (c) => ({ data: await q.listInstallations(prisma, { dealerId: dealerOf(c), siteId: queryText(c.req, "tesisId"), search: queryText(c.req, "arama"), ...pageQuery(c.req) }) }),
  },
  { method: "get", path: "/kurulumlar/:id", permission: "bayi:portal", kimlik: "OKUMA", handler: async (c) => ({ data: await q.installationDetail(prisma, idParam(c.req, "id", "Kurulum"), { dealerId: dealerOf(c) }) }) },
  { method: "get", path: "/haklar/:id", permission: "bayi:portal", kimlik: "OKUMA", handler: async (c) => ({ data: await q.entitlementDetail(prisma, idParam(c.req, "id", "Hak"), { dealerId: dealerOf(c) }) }) },

  {
    method: "post",
    path: "/musteriler",
    permission: "bayi:portal",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const dealerId = dealerOf(c);
      const b = bodyOf(c, CustomerCreate);
      return portalAction(c, {
        action: "BAYI_MUSTERI_EKLE",
        clientToken: b.clientToken,
        body: b,
        run: (tx) => createCustomerTx(tx, { name: b.ad, taxNo: b.vergiNo, dealerId }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "MUSTERI_EKLENDI", entity: "Musteri", entityId: row.id, summary: { bayiId: dealerId } }],
      });
    },
  },
  {
    method: "post",
    path: "/tesisler",
    permission: "bayi:portal",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const dealerId = dealerOf(c);
      const b = bodyOf(c, SiteCreate);
      await ownedCustomer(prisma, dealerId, b.musteriId);
      return portalAction(c, {
        action: "BAYI_TESIS_EKLE",
        clientToken: b.clientToken,
        body: b,
        run: (tx) => createSiteTx(tx, { customerId: b.musteriId, name: b.ad, dealerId }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "TESIS_EKLENDI", entity: "Tesis", entityId: row.id, summary: { bayiId: dealerId } }],
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar",
    permission: "bayi:portal",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const dealerId = dealerOf(c);
      const b = bodyOf(c, InstallationCreate);
      const site = await ownedSite(prisma, dealerId, b.tesisId);
      return portalAction(c, {
        action: "BAYI_KURULUM_EKLE",
        clientToken: b.clientToken,
        body: b,
        run: (tx) => createDealerInstallationTx(tx, { dealerId, site, siteId: site.id, licenseClass: b.sinif, channelCode: b.kanalKodu, name: b.ad }),
        respond: (row) => ({ status: 201, data: row }),
        audit: (row) => [{ event: "KURULUM_EKLENDI", entity: "Kurulum", entityId: row.id, summary: { sinif: row.sinif, kanal: row.kanalKodu, bayiId: dealerId } }],
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/hak",
    permission: "bayi:portal",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const dealerId = dealerOf(c);
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, EntitlementCreate);
      const inst = await ownedInstallation(prisma, dealerId, id);
      const customerId = await installationCustomerId(prisma, id);
      const modules = assertKnownModules(b.moduller ?? [...DEFAULT_ENTITLEMENT_MODULES]);
      assertProductionKept(modules, b.uretimModuluCikarilsin);
      // Taslak da tavana sığmalı (tx'te bayi kilidi altında ve imza anında yeniden denetlenir).
      const dealer = await findDealer(prisma, dealerId);
      const draft = { modules, licenseClass: inst.sinif, perpetual: b.kalici, maintenanceUntil: new Date(b.bakimBitis) };
      assertWithinCeiling(ceilingViolations(await currentCeiling(prisma, dealer), signedFieldsOf(draft, c.nowMs)));
      return portalAction(c, {
        action: "BAYI_HAK_EKLE",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) =>
          createDealerEntitlementTx(tx, {
            dealerId,
            customerId,
            licenseClass: inst.sinif,
            installationDbId: id,
            modules,
            perpetual: b.kalici,
            maintenanceUntil: new Date(b.bakimBitis),
            validUntil: b.gecerlilikBitis ? new Date(b.gecerlilikBitis) : null,
            nowMs: c.nowMs,
            actor: c.session.actor,
          }),
        respond: (hak) => ({ status: 201, data: hak }),
        audit: (hak) => [{ event: "HAK_EKLENDI", entity: "Hak", entityId: hak.id, summary: { lisansNo: hak.lisansNo, bayiId: dealerId } }],
      });
    },
  },
  {
    method: "post",
    path: "/haklar/:id/surum",
    permission: "bayi:portal",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const dealerId = dealerOf(c);
      const id = idParam(c.req, "id", "Hak");
      const b = bodyOf(c, EntitlementVersion);
      const hak = await ownedEntitlement(prisma, dealerId, id);
      const customerId = await installationCustomerId(prisma, hak.kurulumId);
      let modules: string[] | undefined;
      if (b.moduller !== undefined) {
        modules = assertKnownModules(b.moduller);
        assertProductionKept(modules, b.uretimModuluCikarilsin);
      }
      const changes: EntitlementChanges = { modules, perpetual: b.kalici, maintenanceUntil: b.bakimBitis ? new Date(b.bakimBitis) : undefined };
      const password = passwordBuffer(b.bayiParolasi);
      return portalAction(c, {
        action: "BAYI_HAK_SURUM",
        clientToken: b.clientToken,
        body: withPath(b, id),
        prepare: () =>
          withSigningPasswordGuard(c.ctx, { userId: c.session.user.id, actor: c.session.actor, kind: "BAYI", nowMs: c.nowMs }, () =>
            prepareDealerEntitlementVersion(c.ctx, { dealerId, entitlementId: id, changes, password, reason: b.sebep, actor: c.session.actor, nowMs: c.nowMs }),
          ),
        run: async (tx, p) => ({ row: await recordDealerEntitlementVersionTx(tx, { ...p, customerId }), p }),
        respond: ({ row }) => ({ status: 201, data: { id: row.id, hakId: row.hakId, surum: row.surum, imzalayanKid: row.imzalayanKid, verilis: row.verilis } }),
        audit: ({ row, p }) => [entitlementVersionAudit(row, p)],
        release: () => password.fill(0),
      });
    },
  },
  {
    method: "post",
    path: "/kurulumlar/:id/etkinlestirme-kodu",
    permission: "bayi:portal",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const dealerId = dealerOf(c);
      const id = idParam(c.req, "id", "Kurulum");
      const b = bodyOf(c, CodeCreate);
      await ownedInstallation(prisma, dealerId, id);
      const customerId = await installationCustomerId(prisma, id);
      return portalAction(c, {
        action: "BAYI_KOD_URET",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => createDealerActivationCodeTx(tx, c.ctx, { dealerId, customerId, installationDbId: id, validDays: b.gecerlilikGun, actor: c.session.actor, nowMs: c.nowMs }),
        respond: (r) => ({
          status: 201,
          data: { id: r.id, kod: r.code, kodSonu: r.codeTail, gecerlilikBitis: r.expiresAt },
          stored: { id: r.id, kod: null, gecerlilikBitis: r.expiresAt, kodGosterilemez: true },
        }),
        audit: (r) => [{ event: "ETKINLESTIRME_KODU", entity: "Kurulum", entityId: id, summary: { kodId: r.id, tur: r.kind, bayiId: dealerId } }],
      });
    },
  },
];
