// `panel-kunye.mjs` tip bildirimi — çalışan kod bağımlılıksız JS (yayın kapısı zero-dep koşar); imzalar burada.
import type { KeyObject } from "node:crypto";
import type { KunyeResult } from "./kunye-jws.mjs";
import type { CertificateDoc, MergedRevocation, RootAnchorKey, VerifiedDistributionRevocation } from "./istemci-zinciri.mjs";

export type { KunyeResult } from "./kunye-jws.mjs";
export type { CertificateDoc, MergedRevocation, RootAnchorKey, VerifiedDistributionRevocation } from "./istemci-zinciri.mjs";

/** Ret: `detay` zincir katmanının ince kodu (yalnız günlüğe; operatör metni `messageFor(code)`). */
export type ReleaseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly detay?: string };

export interface ReleaseDoc {
  readonly v: 2;
  readonly urun: "panel";
  readonly platform: "win32-x64";
  readonly kanal: string;
  readonly surum: string;
  readonly commit: string;
  readonly yayinZamani: string;
  readonly paket: { readonly ad: string; readonly boyut: number; readonly sha512: string };
  /** Bu pakete gömülü KÖK çapasının kid'leri (yayın kapısının kök düzeyindeki rotasyon kilidi). */
  readonly capa: readonly string[];
}

export interface VerifiedRelease {
  readonly doc: ReleaseDoc;
  /** İmzalayan `ist-*` anahtarı. */
  readonly kid: string;
  /** Sertifikayı imzalayan kök. */
  readonly rootKid: string;
  readonly certificate: CertificateDoc;
}

interface ReleaseCheck {
  readonly roots: unknown;
  readonly channel: string;
  readonly nowMs: number | undefined;
  readonly revocation?: VerifiedDistributionRevocation | null;
}

export interface MeasuredFile {
  readonly size: number;
  readonly sha512: string;
}

export const PANEL_RELEASE_TYP: "tekserp-panel";
export const RELEASE_BLOCK_KEY: "tekserp";
export const RELEASE_DOC_VERSION: 2;
export const RELEASE_PRODUCT: "panel";
export const RELEASE_PLATFORM: "win32-x64";
export const RELEASE_ERROR_CODES: readonly string[];

export function decodeReleaseDoc(payload: unknown): KunyeResult<ReleaseDoc>;
export function verifyReleaseBlock(block: unknown, g: ReleaseCheck): ReleaseResult<VerifiedRelease>;
export function mergeReleaseRevocations(
  block: unknown,
  g: { readonly roots: unknown; readonly stored: string | null | undefined; readonly fromToken: string | null | undefined },
): MergedRevocation;
export function checkPanelRootAnchor(roots: readonly RootAnchorKey[]): KunyeResult<unknown>;
export function sha512HexToBase64(hex: string): string;
export function checkUpdateInfo(doc: ReleaseDoc, info: unknown): KunyeResult<true>;
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null;
export function checkNewer(doc: ReleaseDoc, installedVersion: string): KunyeResult<true>;
export function verifyUpdateInfo(
  info: unknown,
  g: ReleaseCheck & { readonly installedVersion: string },
): ReleaseResult<VerifiedRelease>;
export function sha512File(filePath: string): Promise<MeasuredFile>;
export function checkArtifact(doc: ReleaseDoc, measured: unknown): KunyeResult<true>;
export function verifyArtifactFile(doc: ReleaseDoc, filePath: string): Promise<KunyeResult<MeasuredFile>>;
export function buildReleaseDoc(g: {
  readonly kanal: string;
  readonly surum: string;
  readonly commit: string;
  readonly yayinZamani: string;
  readonly paket: { readonly ad: string; readonly boyut: number; readonly sha512: string };
  readonly capa: readonly string[];
}): ReleaseDoc;
export function signReleaseDoc(g: {
  readonly doc: ReleaseDoc;
  readonly kid: string;
  readonly privateKey: KeyObject;
  /** Kök imzalı ISTEMCI sertifikası (compact JWS). */
  readonly certificate: string;
  /** İmza anı (ISO, `Z`). */
  readonly signedAt: string;
}): string;
export function messageFor(code: string): string;
