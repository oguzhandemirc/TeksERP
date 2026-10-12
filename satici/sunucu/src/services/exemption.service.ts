// MUAFİYET BELGESİ (G2 etkinleştirme kilidi): etkinleştirme kilidinden önce doğmuş, hiç etkinleşmemiş fabrika kurulumunun
// bugünkü davranışla sürmesini sağlayan imzalı belge. Satıcının DB'si etkinleşmemiş kurulumun anahtarını bilmez: kimlik
// fabrikanın kilit ekranındaki imzalı istek zarfından (karekod metni) okunur ve zarftaki açık anahtarla doğrulanır —
// belge yalnız o anahtara ve parmak izine bağlanır. İmza tx DIŞINDA (parola alt sürece), kayıt tx İÇİNDE.
import { randomUUID, type KeyObject } from "node:crypto";
import {
  ActivateRequestSchema,
  ExemptionSchema,
  TYP,
  TransferRequestSchema,
  decodeDocument,
  installationKeyId,
  isoToMs,
  openEnvelope,
  parseJws,
  prepareTrustAnchor,
  readRequestIdentity,
  verifyCertificate,
  verifyJws,
  verifyRequest,
  type ExemptionDoc,
  type Fingerprint,
  type RootKey,
} from "../lisans-protokol";
import { KeyFileError } from "../keys/key-files";
import { signWithWrappedKey } from "../keys/signer";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import { planEntitlementSigner, signingCapabilities, type SignerPlanKind } from "./entitlement-policy";
import { requireReason } from "./sanction.service";

/** Zarfın taşıyabileceği, kurulum anahtarını ve parmak izini içeren istekler (kilit ekranında üretilebilenler). */
const EXEMPTION_SOURCE_PURPOSES = ["etkinlestir", "tasima"] as const;

export interface ExemptionIdentity {
  readonly acikAnahtar: string;
  readonly anahtarKimligi: string;
  readonly parmakIzi: Fingerprint;
  /** İstek lisans kimliği taşıyorsa (yeniden etkinleştirme/taşıma) — satıcı kaydıyla aynı olmalı. */
  readonly kurulumId: string | null;
}

/**
 * Zarftan kurulum kimliğini çıkarır: istek zarftaki açık anahtarla imzalı olmalı (anahtar sahipliği kanıtı). Zaman
 * penceresi UYGULANMAZ — muafiyet tazelik değil sahiplik ister; karekod metni portala sonradan da yapıştırılabilir.
 */
export function exemptionIdentityFromEnvelope(zarf: string): ExemptionIdentity {
  const opened = openEnvelope(zarf.trim());
  if (!opened.ok) throw new VendorError(400, "ZARF_BICIM", opened.message);
  const { request, body } = opened.value;
  const head = parseJws(request);
  const amac = head.ok ? (head.value.payload as { amac?: unknown }).amac : undefined;
  if (amac !== "etkinlestir" && amac !== "tasima") {
    throw badRequest("Zarf etkinleştirme ya da taşıma isteği taşımıyor — fabrikanın lisans ekranındaki karekod metnini yapıştırın");
  }
  let json: unknown;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    throw new VendorError(400, "ZARF_BICIM", "Zarfın gövdesi çözülemedi");
  }
  const decoded = amac === "etkinlestir" ? decodeDocument(ActivateRequestSchema, json) : decodeDocument(TransferRequestSchema, json);
  if (!decoded.ok) throw new VendorError(400, "ZARF_BICIM", `Zarfın gövdesi tanınmıyor: ${decoded.message}`);
  const identity = readRequestIdentity(request);
  if (!identity.ok) throw new VendorError(400, "ZARF_BICIM", identity.message);
  const requestTime = (head.ok ? (head.value.payload as { zaman?: unknown }).zaman : undefined) as string | undefined;
  const checked = verifyRequest(request, {
    publicKeyX: decoded.value.acikAnahtar,
    body,
    nowMs: typeof requestTime === "string" ? isoToMs(requestTime) : Number.NaN,
    purposes: EXEMPTION_SOURCE_PURPOSES,
    installationId: identity.value.installationId,
  });
  if (!checked.ok) throw new VendorError(400, "ZARF_BICIM", `Zarfın imzası doğrulanamadı: ${checked.message}`);
  return {
    acikAnahtar: decoded.value.acikAnahtar,
    anahtarKimligi: installationKeyId(decoded.value.acikAnahtar),
    parmakIzi: decoded.value.parmakIzi,
    kurulumId: identity.value.installationId,
  };
}

type InstallationRow = { id: string; kurulumId: string; durum: string; aktif: boolean; yetenekler: unknown; sinif: Parameters<typeof planEntitlementSigner>[1] };

/** Muafiyet yalnız etkinleşmemiş, aktif kayda; anahtar başka kuruluma bağlıysa o kurulum etkindir (muafiyet gereksiz). */
async function assertExemptible(db: Db, inst: InstallationRow, id: ExemptionIdentity): Promise<void> {
  if (inst.durum !== "ETKINLESMEDI" || !inst.aktif) throw stateConflict("Muafiyet yalnız etkinleşmemiş (aktif) kuruluma verilir");
  if (id.kurulumId !== null && id.kurulumId !== inst.kurulumId) throw stateConflict("Zarfın lisans kimliği bu kurulumun değil");
  const bound = await db.kurulum.findFirst({ where: { anahtarKimligi: id.anahtarKimligi }, select: { id: true } });
  if (bound) throw stateConflict("Bu kurulum anahtarı zaten bir kuruluma bağlı (etkinleşmiş) — muafiyet gerekmez");
}

/**
 * İmza planı HAK'ınkiyle aynı kaynaktan: etkinleşmemiş kurulumda beklenen `hak-ara` → ara imzacı varsa o, yoksa VDS'teki
 * kök (G2 derlemesi ikisini de doğrular); kuyruk yok.
 */
function planExemptionSigner(ctx: VendorContext, inst: InstallationRow, nowMs: number) {
  return planEntitlementSigner(ctx.keys, inst.sinif, signingCapabilities(inst), nowMs);
}

export async function previewExemptionSigner(ctx: VendorContext, g: { installationDbId: string; nowMs: number }): Promise<{ imzaci: SignerPlanKind; kid: string | null }> {
  const inst = await prisma.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  const plan = planExemptionSigner(ctx, inst, g.nowMs);
  return { imzaci: plan.kind, kid: plan.kind === "KUYRUK" ? null : plan.kid };
}

/** Basılan belge çapaya karşı doğrulanır (imzacı türü dahil) — doğrulanmayan belge kaydedilmez, verilmez. */
function verifySignedExemption(token: string, anchor: readonly RootKey[], expected: ExemptionDoc): boolean {
  const parsed = parseJws(token);
  if (!parsed.ok) return false;
  let findKey: (kid: string) => KeyObject | undefined;
  if (expected.imzaciSertifikasi !== undefined) {
    const cert = verifyCertificate(expected.imzaciSertifikasi, { roots: anchor, usage: "HAK", atMs: isoToMs(expected.verilis) });
    if (!cert.ok) return false;
    findKey = (kid) => (kid === cert.value.document.kid ? cert.value.key : undefined);
  } else {
    const roots = prepareTrustAnchor(anchor);
    if (!roots.ok) return false;
    findKey = (kid) => roots.value.get(kid)?.key;
  }
  const v = verifyJws(token, { typ: TYP.MUAFIYET, findKey });
  if (!v.ok) return false;
  const doc = decodeDocument(ExemptionSchema, v.value.payload);
  return doc.ok && doc.value.muafiyetId === expected.muafiyetId && doc.value.kurulumAnahtarKimligi === expected.kurulumAnahtarKimligi;
}

export interface PreparedExemption {
  readonly installationDbId: string;
  readonly identity: ExemptionIdentity;
  readonly doc: ExemptionDoc;
  readonly jws: string;
  readonly imzaci: "ARA" | "KOK";
  readonly kid: string;
  readonly reason: string;
}

/**
 * Hazırlık (tx DIŞI): zarf + kayıt + plan denetimi, sonra imza. `expectedSigner` arayüzün gördüğü plandır; uyuşmazsa
 * 409 ve parola hiçbir sürece gitmez.
 */
export async function prepareExemption(
  ctx: VendorContext,
  g: { installationDbId: string; zarf: string; reason: string; expectedSigner: SignerPlanKind; password: Buffer; nowMs: number },
): Promise<PreparedExemption> {
  try {
    const reason = requireReason(g.reason, "Muafiyet");
    const identity = exemptionIdentityFromEnvelope(g.zarf);
    const inst = await prisma.kurulum.findUnique({ where: { id: g.installationDbId } });
    if (!inst) throw notFoundError("Kurulum");
    await assertExemptible(prisma, inst, identity);
    const plan = planExemptionSigner(ctx, inst, g.nowMs);
    if (plan.kind === "KUYRUK") throw stateConflict("Muafiyeti imzalayacak ara imzacı ya da kök anahtarı bu sunucuda yok");
    if (plan.kind !== g.expectedSigner) {
      throw new VendorError(409, "DURUM_CAKISMASI", "İmza planı değişti — sayfayı yenileyip yeniden deneyin (parola kullanılmadı)", { imzaci: plan.kind });
    }
    const payload: ExemptionDoc = {
      v: 1,
      muafiyetId: randomUUID(),
      kurulumAnahtarKimligi: identity.anahtarKimligi,
      parmakIzi: identity.parmakIzi,
      verilis: new Date(g.nowMs).toISOString(),
      gerekce: reason,
      ...(plan.kind === "ARA" ? { imzaciSertifikasi: plan.certificate } : {}),
    };
    const doc = decodeDocument(ExemptionSchema, payload);
    if (!doc.ok) throw badRequest(`Muafiyet şemaya uymuyor: ${doc.message}`);
    let jws: string;
    try {
      jws = await signWithWrappedKey({ keyFile: plan.keyFile, typ: TYP.MUAFIYET, payload: doc.value, password: g.password });
    } catch (err) {
      if (err instanceof KeyFileError && err.kind === "YANLIS_PAROLA") throw new VendorError(400, "IMZA_PAROLASI_HATALI", "İmza parolası hatalı");
      throw err;
    }
    if (!verifySignedExemption(jws, ctx.keys.anchor, doc.value)) throw new VendorError(500, "SUNUCU_HATASI", "İmzalanan muafiyet güven çapasına karşı doğrulanamadı");
    return { installationDbId: inst.id, identity, doc: doc.value, jws, imzaci: plan.kind, kid: plan.kid, reason };
  } finally {
    g.password.fill(0);
  }
}

/** Kayıt (tx İÇİ): kurulum kilidi ilk ifade; hazırlıktan sonra etkinleşen kurulum muafiyet almaz (TOCTOU). */
export async function recordExemptionTx(tx: Tx, p: PreparedExemption, actor: string): Promise<{ muafiyetId: string; anahtarKimligi: string; imzaci: "ARA" | "KOK"; kid: string }> {
  await lockInstallation(tx, p.installationDbId);
  const inst = await tx.kurulum.findUnique({ where: { id: p.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  await assertExemptible(tx, inst, p.identity);
  await tx.kurulumKaydi.create({
    data: {
      kurulumId: inst.id,
      olay: "MUAFIYET_VERILDI",
      anahtarKimligi: p.identity.anahtarKimligi,
      acikAnahtar: p.identity.acikAnahtar,
      ayrinti: { muafiyetId: p.doc.muafiyetId, imzaci: p.imzaci, imzalayanKid: p.kid, verilis: p.doc.verilis, gerekce: p.reason },
      yapan: actor,
    },
  });
  return { muafiyetId: p.doc.muafiyetId, anahtarKimligi: p.identity.anahtarKimligi, imzaci: p.imzaci, kid: p.kid };
}

/** Portalın indirttiği dosya: fabrikanın çevrimdışı yanıt ucu bu biçimi muafiyet olarak tanır. */
export function exemptionFile(p: PreparedExemption, licenseNo: string | null): { dosya: { v: 1; muafiyet: string }; dosyaAdi: string } {
  const day = p.doc.verilis.slice(0, 10).replace(/-/g, "");
  return { dosya: { v: 1, muafiyet: p.jws }, dosyaAdi: `muafiyet-${licenseNo ?? p.identity.anahtarKimligi}-${day}.json` };
}
