// =============================================================================
// Belge şablon tasarımcısı — controller (gövde doğrulama + servise delege)
// =============================================================================
// İzin kapıları route'ta; burada yalnız gerçek kayıt seçen önizlemenin ek kapısı var
// (`DOC_PERMISSIONS[docType].read`) — kayıt verisi tasarım izniyle sızmasın.
// =============================================================================

import type { Request, Response } from "express";
import { z } from "zod";
import { matchesPermission, RBAC_DENIED_CODE } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { DOC_PERMISSIONS } from "../routes/printed-document.routes";
import { AppError } from "../utils/app-error";
import * as assignments from "../services/document-template/assignment.service";
import * as templates from "../services/document-template/template.service";
import * as contracts from "../services/document-template/contract-view.service";
import * as previews from "../services/document-template/preview.service";
import * as versions from "../services/document-template/version.service";
import { renderSystemPreview } from "../services/document-template/system-preview.service";

const EditModeSchema = z.enum(["VISUAL", "CODE"], "Düzenleme kipi VISUAL ya da CODE olmalı");
const DocTypeSchema = z.string().min(1).max(40);
const JsonObject = z.record(z.string(), z.unknown());

const ContentSchema = {
  editMode: EditModeSchema,
  sourceHtml: z.string().max(500_000, "Şablon kaynağı en fazla 500 KB olabilir"),
  css: z.string().max(200_000, "CSS en fazla 200 KB olabilir"),
  pageSettings: JsonObject,
  settings: JsonObject,
  internalFields: z.array(z.string().max(80)).max(200),
};

const CreateSchema = z
  .object({
    docType: DocTypeSchema,
    name: z.string().trim().min(1, "Şablon adı gerekli").max(80),
    description: z.string().max(300).nullable().optional(),
    copyFrom: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("system") }).strict(),
      z.object({ kind: z.literal("template"), id: z.uuid() }).strict(),
      z.object({ kind: z.literal("blank") }).strict(),
    ]),
    clientToken: z.uuid().optional(),
  })
  .strict();

const PatchSchema = z
  .object({ name: z.string().trim().min(1, "Şablon adı gerekli").max(80).optional(), description: z.string().max(300).nullable().optional() })
  .strict();

const SaveVersionSchema = z
  .object({
    baseVersionId: z.uuid("Temel sürüm kimliği gerekli"),
    ...ContentSchema,
    projectData: z.unknown().optional(),
    tableBindings: JsonObject,
    note: z.string().max(300).nullable().optional(),
    clientToken: z.uuid().optional(),
  })
  .strict();

const PublishSchema = z.object({ versionId: z.uuid(), expectedPublishedVersionId: z.uuid().nullable() }).strict();

const PreviewSchema = z
  .object({
    docType: DocTypeSchema,
    source: z.object(ContentSchema).strict(),
    sample: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("senaryo"), key: z.string().min(1).max(60) }).strict(),
      z.object({ kind: z.literal("kayit"), sourceId: z.uuid() }).strict(),
    ]),
  })
  .strict();

const ListQuery = z.object({ docType: DocTypeSchema.optional(), status: z.enum(["ACTIVE", "ARCHIVED"]).optional() });
const AssignSchema = z.object({ templateId: z.uuid().nullable() }).strict();

function userIdOf(req: Request): string {
  const id = req.user?.userId;
  if (!id) throw AppError.unauthorized("Oturum gerekli.");
  return id;
}

/** Gerçek kayıt verisine dokunan uçların ek kapısı: belgenin kendi okuma izni. */
function assertDocRead(req: Request, docType: string): void {
  const entry = DOC_PERMISSIONS[docType];
  if (!entry) throw AppError.badRequest(`"${docType}" türünde basılı belge kaydı yok.`, { code: "DOCUMENT_CONTRACT_UNKNOWN", docType });
  const perms = req.user?.permissions ?? [];
  if (!entry.read.some((p) => matchesPermission(perms, p))) {
    throw AppError.forbidden(`Bu belgenin kayıtlarını görmek için şu yetkilerden biri gerekli: ${entry.read.join(", ")}`, {
      code: RBAC_DENIED_CODE,
      requiredAny: [...entry.read],
    });
  }
}

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const param = (req: Request, name: string) => String(req.params[name] ?? "");

export const documentTemplateController = {
  listContracts: async (_req: Request, res: Response) => ok(res, contracts.listContractViews()),
  getContract: async (req: Request, res: Response) => ok(res, contracts.getContractView(param(req, "docType"))),
  getSystem: async (req: Request, res: Response) => ok(res, await contracts.getSystemView(param(req, "docType"))),

  list: async (req: Request, res: Response) => ok(res, await templates.listTemplates(ListQuery.parse(req.query))),
  get: async (req: Request, res: Response) => ok(res, await templates.getTemplate(assertValidUuid(req.params.id))),
  create: async (req: Request, res: Response) => ok(res, await templates.createTemplate(CreateSchema.parse(req.body ?? {}), userIdOf(req)), 201),
  patch: async (req: Request, res: Response) =>
    ok(res, await templates.updateTemplateMeta(assertValidUuid(req.params.id), PatchSchema.parse(req.body ?? {}), userIdOf(req))),

  listVersions: async (req: Request, res: Response) => ok(res, await versions.listVersions(assertValidUuid(req.params.id))),
  getVersion: async (req: Request, res: Response) =>
    ok(res, await versions.getVersion(assertValidUuid(req.params.id), assertValidUuid(req.params.vid, "vid"))),
  saveVersion: async (req: Request, res: Response) => {
    const result = await versions.saveVersion(assertValidUuid(req.params.id), SaveVersionSchema.parse(req.body ?? {}), userIdOf(req));
    return ok(res, result, result.created ? 201 : 200);
  },
  publish: async (req: Request, res: Response) =>
    ok(res, await versions.publishVersion(assertValidUuid(req.params.id), PublishSchema.parse(req.body ?? {}), userIdOf(req))),

  archive: async (req: Request, res: Response) => ok(res, await templates.archiveTemplate(assertValidUuid(req.params.id), userIdOf(req))),
  unarchive: async (req: Request, res: Response) => ok(res, await templates.unarchiveTemplate(assertValidUuid(req.params.id), userIdOf(req))),
  deletePreview: async (req: Request, res: Response) => ok(res, await templates.deletePreview(assertValidUuid(req.params.id))),
  remove: async (req: Request, res: Response) => ok(res, await templates.deleteTemplate(assertValidUuid(req.params.id), userIdOf(req))),

  preview: async (req: Request, res: Response) => {
    const input = PreviewSchema.parse(req.body ?? {});
    if (input.sample.kind === "kayit") assertDocRead(req, input.docType);
    return ok(res, await previews.previewTemplate(input));
  },
  // Yerleşik renderer + örnek veri; eşleniği olmayan türde de çizer, yazmaz.
  systemPreview: async (req: Request, res: Response) => ok(res, await renderSystemPreview(param(req, "docType"))),
  sampleSources: async (req: Request, res: Response) => {
    const docType = param(req, "docType");
    assertDocRead(req, docType);
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 64) : undefined;
    return ok(res, await previews.listSampleSources(docType, q));
  },

  listAssignments: async (_req: Request, res: Response) => ok(res, await assignments.listAssignments()),
  setDefault: async (req: Request, res: Response) =>
    ok(res, await assignments.setDefault(param(req, "docType"), AssignSchema.parse(req.body ?? {}).templateId, userIdOf(req))),
  setProfile: async (req: Request, res: Response) =>
    ok(
      res,
      await assignments.setProfileAssignment(
        assertValidUuid(req.params.profileId, "profileId"),
        param(req, "docType"),
        AssignSchema.parse(req.body ?? {}).templateId,
        userIdOf(req),
      ),
    ),
};
