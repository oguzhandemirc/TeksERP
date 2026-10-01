import anchorFile from "./imza-capasi.json";
import { messageFor, verifyArtifactFile, verifyUpdateInfo, type AnchorKey, type ReleaseDoc } from "./panel-kunye.mjs";

/**
 * GÜNCELLEME DOĞRULAYICI — panel, imzasını doğrulayamadığı güncellemeyi İNDİRMEZ ve KURMAZ (fail-closed).
 *
 * Üç kapı, üç an (electron-updater'ın kendi sha512'si aynı sunucudaki latest.yml'e bağlı olduğu için bütünlük
 * kanıtı DEĞİLDİR; kanıt, yayın makinesinde imzalanan künyedir — `panel-kunye.mjs`):
 *   ① `checkInfo`        — `update-available`: latest.yml'deki imzalı künye (çapa · typ · kanal · sürüm · dosya);
 *   ② `checkDownloaded`  — `update-downloaded`: inen dosyanın boyu + sha512'si künyedekiyle aynı mı;
 *   ③ `checkBeforeInstall` — kurulumdan HEMEN önce aynı dosya yeniden ölçülür (indirme ile kurulum arasında
 *     önbellek dizinindeki dosya değiştirilmiş olabilir; kurulum yönetici yetkisiyle koşar).
 */

/** Derleme anında ana sürece GÖMÜLEN üretim çapası (satır yalnız `guven-capasi-ekle.ts panel` ile eklenir). */
export function panelAnchor(): readonly AnchorKey[] {
  return anchorFile.anahtarlar;
}

/** Reddin operatöre ve sağlık kaydına giden yüzü — kod kapalı küme (`RELEASE_ERROR_CODES`), mesaj Türkçe. */
export interface UpdateRejection {
  readonly kod: string;
  readonly mesaj: string;
  readonly surum: string | null;
}

export type VerifyStep = { readonly ok: true } | { readonly ok: false; readonly rejection: UpdateRejection };

export interface UpdateVerifierDeps {
  readonly keys: () => readonly AnchorKey[];
  readonly channel: string;
  readonly installedVersion: string;
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

function rejected(kod: string, surum: string | null): VerifyStep {
  return { ok: false, rejection: { kod, mesaj: messageFor(kod), surum } };
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
      const r = verifyUpdateInfo(info, { keys: deps.keys(), channel: deps.channel, installedVersion: deps.installedVersion });
      if (!r.ok) return rejected(r.code, versionOf(info));
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
