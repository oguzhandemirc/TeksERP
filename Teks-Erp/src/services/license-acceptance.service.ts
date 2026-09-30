// LİSANS SÖZLEŞMESİ KABULÜ (Ek-7) — etkinleştirmenin ön şartı. Panelin kabul adımı yerel ekleme-yalnız deftere
// (`license_acceptances`) KURULUM imzalı kabul belgesiyle yazılır; etkinleştirme isteği (çevrimiçi · QR · panel
// aktarması) o belgeyi taşır ve satıcı kabulsüz etkinleştirmeyi 409 `KABUL_GEREKLI` ile reddeder.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import prisma from "../lib/prisma";
import { VersionTextSchema, msToIso, signAcceptance } from "../lib/license/protocol";
import { currentAcceptanceText, type AcceptanceBlock } from "../lib/license/acceptance-text";
import { getLicenseStore } from "../lib/license/store";
import { getLicenseSnapshot } from "../lib/license/runtime";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { appVersionForWire, licenseError, requireStore } from "./helpers/license-wire.helper";

/** GECERLI: bu anahtarın son kabulü güncel metni kapsıyor · YOK · METIN_DEGISTI · ANAHTAR_DEGISTI (başka anahtarın kabulü var). */
export const LICENSE_ACCEPTANCE_STATES = ["GECERLI", "YOK", "METIN_DEGISTI", "ANAHTAR_DEGISTI"] as const;
export type LicenseAcceptanceState = (typeof LICENSE_ACCEPTANCE_STATES)[number];

const HISTORY_LIMIT = 20;
const NAME_MAX = 120;

export const RecordLicenseAcceptanceSchema = z.strictObject({
  clientToken: z.uuid("İşlem kimliği geçersiz"),
  metinKimligi: z.string().trim().min(1, "Metin kimliği gerekli").max(40, "Metin kimliği geçersiz"),
  metinOzeti: z.string().trim().min(1, "Metin özeti gerekli").max(64, "Metin özeti geçersiz"),
  kutular: z.array(z.string().max(4, "Kutu numarası geçersiz"), "Kutular liste olmalı").max(12, "Kutu sayısı geçersiz"),
  adSoyad: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı").max(NAME_MAX, "Ad soyad en çok 120 karakter olabilir"),
  unvan: z.string().trim().min(2, "Unvan en az 2 karakter olmalı").max(NAME_MAX, "Unvan en çok 120 karakter olabilir"),
});
export type RecordLicenseAcceptanceInput = z.infer<typeof RecordLicenseAcceptanceSchema>;

export interface LicenseAcceptanceRecord {
  readonly kabulId: string;
  readonly metinKimligi: string;
  readonly metinOzeti: string;
  readonly kutular: readonly string[];
  readonly adSoyad: string;
  readonly unvan: string;
  readonly kabulEden: { readonly id: string; readonly ad: string };
  readonly anahtarKimligi: string;
  readonly lisansKimligi: string | null;
  readonly istemciSurum: string | null;
  readonly sunucuSurum: string;
  readonly zaman: string;
}

export interface LicenseAcceptanceView {
  readonly metin: {
    readonly kimlik: string;
    readonly ozet: string;
    readonly taslak: boolean;
    readonly bloklar: readonly AcceptanceBlock[];
    readonly kutular: readonly string[];
  };
  readonly durum: LicenseAcceptanceState;
  /** Bu kurulum anahtarının güncel metni kapsayan son kabulü; `durum` GECERLI değilse null. */
  readonly gecerli: LicenseAcceptanceRecord | null;
  /** Son kabuller (yeniden eskiye), her anahtar — defter görünümü. */
  readonly kayitlar: readonly LicenseAcceptanceRecord[];
  /** Kurulum anahtarı (etkinleştirme bunu imzalar); depo hazır değilse null — kabul alınamaz. */
  readonly anahtarKimligi: string | null;
  /** Formun ön doldurması: oturumdaki kullanıcının adı (kabul eden değiştirebilir; unvan serbest). */
  readonly oneri: { readonly adSoyad: string | null };
}

const RECORD_SELECT = {
  id: true, textId: true, textDigest: true, boxes: true, acceptorName: true, acceptorTitle: true, installationKeyId: true,
  licenseId: true, clientVersion: true, serverVersion: true, createdAt: true, document: true,
  acceptedBy: { select: { id: true, fullName: true } },
} as const;
const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

type Row = NonNullable<Awaited<ReturnType<typeof latestFor>>>;

function latestFor(installationKeyId: string) {
  return prisma.licenseAcceptance.findFirst({ where: { installationKeyId }, orderBy: NEWEST_FIRST, select: RECORD_SELECT });
}

function toRecord(r: Row): LicenseAcceptanceRecord {
  return {
    kabulId: r.id,
    metinKimligi: r.textId,
    metinOzeti: r.textDigest,
    kutular: r.boxes,
    adSoyad: r.acceptorName,
    unvan: r.acceptorTitle,
    kabulEden: { id: r.acceptedBy.id, ad: r.acceptedBy.fullName },
    anahtarKimligi: r.installationKeyId,
    lisansKimligi: r.licenseId,
    istemciSurum: r.clientVersion,
    sunucuSurum: r.serverVersion,
    zaman: r.createdAt.toISOString(),
  };
}

/** Anahtarın son kabulü güncel metni mi kapsıyor — etkinleştirme kapısı ile ekran AYNI yüklemden. */
async function evaluate(kid: string | null): Promise<{ state: LicenseAcceptanceState; row: Row | null }> {
  const t = currentAcceptanceText();
  const row = kid ? await latestFor(kid) : null;
  if (!row) {
    const any = await prisma.licenseAcceptance.count();
    return { state: any > 0 ? "ANAHTAR_DEGISTI" : "YOK", row: null };
  }
  const current = row.textId === t.kimlik && row.textDigest === t.ozet;
  return { state: current ? "GECERLI" : "METIN_DEGISTI", row };
}

export async function getLicenseAcceptanceView(viewerId: string | null): Promise<LicenseAcceptanceView> {
  const t = currentAcceptanceText();
  const kid = getLicenseStore()?.key?.kid ?? null;
  const { state, row } = await evaluate(kid);
  const rows = await prisma.licenseAcceptance.findMany({ orderBy: NEWEST_FIRST, take: HISTORY_LIMIT, select: RECORD_SELECT });
  const viewer = viewerId ? await prisma.user.findUnique({ where: { id: viewerId }, select: { fullName: true } }) : null;
  return {
    metin: { kimlik: t.kimlik, ozet: t.ozet, taslak: t.taslak, bloklar: t.bloklar, kutular: t.kutular },
    durum: state,
    gecerli: state === "GECERLI" && row ? toRecord(row) : null,
    kayitlar: rows.map(toRecord),
    anahtarKimligi: kid,
    oneri: { adSoyad: viewer?.fullName?.trim() || null },
  };
}

const REQUIRED_MESSAGES: Readonly<Record<Exclude<LicenseAcceptanceState, "GECERLI">, string>> = {
  YOK: "Etkinleştirmeden önce lisans sözleşmesi kabul edilmeli: Lisans ekranındaki kabul adımını tamamlayın (kabul adımını göstermeyen eski panel sürümü güncellenmeli).",
  METIN_DEGISTI: "Sözleşme metni güncellendi; etkinleştirmeden önce yeni metni Lisans ekranında kabul edin.",
  ANAHTAR_DEGISTI: "Bu sunucunun lisans anahtarı değişti (yeni makine ya da taşıma); etkinleştirmeden önce sözleşmeyi bu sunucuda yeniden kabul edin.",
};

/**
 * Etkinleştirme isteğine girecek kabul belgesi: bu anahtarın güncel metni kapsayan son kabulü. Yoksa satıcıya
 * GİTMEDEN 409 `LICENSE_ACCEPTANCE_REQUIRED` (fail-closed; eski panel de bu cümleyi görür).
 */
export async function activationAcceptance(kid: string): Promise<{ kabulId: string; belge: string }> {
  const { state, row } = await evaluate(kid);
  if (state !== "GECERLI" || !row) throw licenseError(409, "LICENSE_ACCEPTANCE_REQUIRED", REQUIRED_MESSAGES[state === "GECERLI" ? "YOK" : state], { kabulDurumu: state });
  return { kabulId: row.id, belge: row.document };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
}

/** Gelen yük mevcut kabulle aynı mı — aynı işlem kimliği başka ad/unvan/metinle gelirse 409. */
function replayFor(input: RecordLicenseAcceptanceInput, userId: string) {
  return tokenReplay<{ acceptorName: string; acceptorTitle: string; textDigest: string }, LicenseAcceptanceView>({
    find: (db, clientToken) => db.licenseAcceptance.findUnique({ where: { clientToken }, select: { acceptorName: true, acceptorTitle: true, textDigest: true } }),
    alive: { neverDies: "kabul kaydı silinmez ve geri alınmaz; yeni kabul yeni satırdır" },
    identity: (p) => [
      { ad: "adSoyad", mevcut: p.acceptorName, gelen: input.adSoyad },
      { ad: "unvan", mevcut: p.acceptorTitle, gelen: input.unvan },
      { ad: "metinOzeti", mevcut: p.textDigest, gelen: input.metinOzeti },
    ],
    collision: "Bu işlem kimliği başka bir sözleşme kabulüne ait; formu yeniden gönderin.",
    respond: () => getLicenseAcceptanceView(userId),
  });
}

export async function recordLicenseAcceptance(g: {
  userId: string;
  input: RecordLicenseAcceptanceInput;
  /** Panel sürümü (künye başlığı) — yalnız bilgi, belgeye `istemci.surum` olarak girer. */
  panelVersion: string | null;
}): Promise<LicenseAcceptanceView> {
  const store = requireStore();
  const t = currentAcceptanceText();
  // Paketin metni protokol kataloğunda yoksa satıcı tanımaz: kabul alınmaz (fail-closed; bekçi bu hâli derlemede keser).
  if (!t.katalogda) throw licenseError(409, "LICENSE_ACCEPTANCE_TEXT_UNPUBLISHED", "Bu sunucu sürümündeki sözleşme metni lisans kataloğunda yok; sunucu paketi hatalı, satıcıyla görüşün.");
  if (g.input.metinKimligi !== t.kimlik || g.input.metinOzeti !== t.ozet) {
    throw licenseError(409, "LICENSE_ACCEPTANCE_TEXT_CHANGED", "Sözleşme metni değişti; ekranı yenileyip güncel metni okuyarak yeniden kabul edin.", { metinKimligi: t.kimlik });
  }
  if (!sameSet(g.input.kutular, t.kutular)) {
    throw licenseError(400, "LICENSE_ACCEPTANCE_BOXES", "Kabul için metindeki bütün kutular işaretlenmeli.");
  }
  return replayFor(g.input, g.userId).run(g.input.clientToken, async () => {
    const nowMs = Date.now();
    const acceptanceId = randomUUID();
    const clientVersion = g.panelVersion && VersionTextSchema.safeParse(g.panelVersion).success ? g.panelVersion : null;
    const signed = signAcceptance({
      privateKey: store.key.privateKey,
      payload: {
        v: 1,
        kabulId: acceptanceId,
        metin: { kimlik: t.kimlik, ozet: t.ozet },
        kutular: [...t.kutular],
        kabulEden: { kullaniciId: g.userId, ad: g.input.adSoyad, unvan: g.input.unvan },
        zaman: msToIso(nowMs),
        istemci: { tur: "panel", surum: clientVersion },
        sunucuSurum: appVersionForWire(),
      },
    });
    await prisma.licenseAcceptance.create({
      data: {
        id: acceptanceId,
        clientToken: g.input.clientToken,
        textId: t.kimlik,
        textDigest: t.ozet,
        boxes: [...t.kutular],
        acceptorName: g.input.adSoyad,
        acceptorTitle: g.input.unvan,
        acceptedById: g.userId,
        installationKeyId: store.key.kid,
        licenseId: getLicenseSnapshot().licenseId,
        clientVersion,
        serverVersion: appVersionForWire(),
        document: signed,
        // Belgenin `zaman`ıyla aynı an: kayıt ile imzalı kanıt tek saati taşır.
        createdAt: new Date(nowMs),
      },
    });
    void AuditService.log({
      userId: g.userId,
      action: "CREATE",
      tableName: "LICENSE_ACCEPTANCE",
      recordId: acceptanceId,
      newData: { metinKimligi: t.kimlik, kutular: t.kutular.join(","), unvan: g.input.unvan },
    });
    return getLicenseAcceptanceView(g.userId);
  });
}
