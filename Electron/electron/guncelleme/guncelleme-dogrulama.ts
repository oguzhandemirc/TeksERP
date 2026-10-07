import anchorFile from "./imza-capasi.json";
import {
  RELEASE_BLOCK_KEY,
  mergeReleaseRevocations,
  messageFor,
  verifyArtifactFile,
  verifyUpdateInfo,
  type ReleaseDoc,
  type RootAnchorKey,
} from "./panel-kunye.mjs";

/**
 * GÜNCELLEME DOĞRULAYICI — panel, imzasını doğrulayamadığı güncellemeyi İNDİRMEZ ve KURMAZ (fail-closed).
 *
 * Üç kapı, üç an (electron-updater'ın kendi sha512'si aynı sunucudaki latest.yml'e bağlı olduğu için bütünlük
 * kanıtı DEĞİLDİR; kanıt, yayın makinesinde imzalanan künyedir — `panel-kunye.mjs`):
 *   ① `checkInfo`        — `update-available`: latest.yml'deki imzalı künye (kök çapası · ISTEMCI sertifikası ·
 *     dağıtım iptali · typ · kanal · sürüm · dosya);
 *   ② `checkDownloaded`  — `update-downloaded`: inen dosyanın boyu + sha512'si künyedekiyle aynı mı;
 *   ③ `checkBeforeInstall` — kurulumdan HEMEN önce aynı dosya yeniden ölçülür (indirme ile kurulum arasında
 *     önbellek dizinindeki dosya değiştirilmiş olabilir; kurulum yönetici yetkisiyle koşar).
 */

/** Derleme anında ana sürece GÖMÜLEN kök çapası (satır yalnız `guven-capasi-ekle.ts istemci-kok` ile eklenir). */
export function panelAnchor(): readonly RootAnchorKey[] {
  return anchorFile.kokler;
}

/** Reddin operatöre ve sağlık kaydına giden yüzü — kod kapalı küme (`RELEASE_ERROR_CODES`), mesaj Türkçe. */
export interface UpdateRejection {
  readonly kod: string;
  readonly mesaj: string;
  readonly surum: string | null;
  /** Zincir katmanının ince kodu (yalnız günlük; operatöre `mesaj` gider). */
  readonly detay?: string;
}

export type VerifyStep = { readonly ok: true } | { readonly ok: false; readonly rejection: UpdateRejection };

export interface UpdateVerifierDeps {
  readonly roots: () => readonly RootAnchorKey[];
  /**
   * Künyenin taşıması gereken kanal, denetim ANINDA okunur: eski kanal yolunda gömülü kod, ortak pakette bu
   * denetimin feed'ini seçen kiradaki güncelleme grubu. `null` (grup bilinmiyor) → künye kabul edilmez.
   */
  readonly channel: () => string | null;
  readonly installedVersion: string;
  /** Sertifika süresi/toleransı için şimdiki an. */
  readonly nowMs: () => number;
  /** Yerelde saklanan en yüksek sıralı dağıtım iptali (`iptal-deposu.ts`); güvenilmez girdi, yeniden doğrulanır. */
  readonly storedRevocation: () => string | null;
  /** Son indirme belirteci yanıtının taşıdığı dağıtım iptali (I6a). */
  readonly tokenRevocation: () => string | null;
  /** Birleştirmede yerelden YÜKSEK sıralı iptal kazanınca saklanır (en iyi çaba). */
  readonly saveRevocation: (token: string) => void;
  /** Künyeyle eşleşmeyen indirmeyi önbellekten siler (en iyi çaba). */
  readonly removeFile: (filePath: string) => Promise<void>;
}

interface DownloadedInfo {
  readonly version?: unknown;
  readonly downloadedFile?: unknown;
}

function versionOf(info: unknown): string | null {
  const v = typeof info === "object" && info !== null ? (info as { version?: unknown }).version : undefined;
  return typeof v === "string" ? v : null;
}

function rejected(kod: string, surum: string | null, detay?: string): VerifyStep {
  return { ok: false, rejection: { kod, mesaj: messageFor(kod), surum, ...(detay && detay !== kod ? { detay } : {}) } };
}

export interface UpdateVerifier {
  checkInfo(info: unknown): VerifyStep;
  checkDownloaded(info: DownloadedInfo | null | undefined): Promise<VerifyStep>;
  checkBeforeInstall(installerPath: unknown): Promise<VerifyStep>;
}

export function createUpdateVerifier(deps: UpdateVerifierDeps): UpdateVerifier {
  let expected: ReleaseDoc | null = null;
  let verified: { readonly doc: ReleaseDoc; readonly file: string } | null = null;

  return {
    checkInfo(info) {
      expected = null;
      verified = null;
      const channel = deps.channel();
      if (channel === null) return rejected("KUNYE_KANAL", versionOf(info));
      const roots = deps.roots();
      const block = typeof info === "object" && info !== null ? (info as Record<string, unknown>)[RELEASE_BLOCK_KEY] : undefined;
      // İptal künyeden ÖNCE birleştirilir ve saklanır: künye reddedilse de görülen iptal geri alınamaz olur.
      const merged = mergeReleaseRevocations(block, { roots, stored: deps.storedRevocation(), fromToken: deps.tokenRevocation() });
      if (merged.token !== null && merged.kaynak !== "yerel") {
        try {
          deps.saveRevocation(merged.token);
        } catch {
          // En iyi çaba: bu denetimde yine uygulanır.
        }
      }
      const r = verifyUpdateInfo(info, {
        roots,
        channel,
        installedVersion: deps.installedVersion,
        nowMs: deps.nowMs(),
        revocation: merged.revocation,
      });
      if (!r.ok) return rejected(r.code, versionOf(info), r.detay);
      expected = r.value.doc;
      return { ok: true };
    },

    async checkDownloaded(info) {
      verified = null;
      const doc = expected;
      const file = info?.downloadedFile;
      if (!doc || versionOf(info) !== doc.surum || typeof file !== "string") return rejected("KUNYE_YOK", versionOf(info));
      const r = await verifyArtifactFile(doc, file);
      if (!r.ok) {
        await deps.removeFile(file).catch(() => undefined);
        return rejected(r.code, doc.surum);
      }
      verified = { doc, file };
      return { ok: true };
    },

    async checkBeforeInstall(installerPath) {
      const v = verified;
      // Kurulacak dosya doğrulanan dosya DEĞİLSE (yol farkı) ya da hiç doğrulanmadıysa kurulum yok.
      if (!v || installerPath !== v.file) return rejected("KUNYE_YOK", v?.doc.surum ?? null);
      const r = await verifyArtifactFile(v.doc, v.file);
      if (r.ok) return { ok: true };
      verified = null;
      await deps.removeFile(v.file).catch(() => undefined);
      return rejected(r.code, v.doc.surum);
    },
  };
}
