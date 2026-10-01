// `panel-kunye.mjs` tip bildirimi — çalışan kod bağımlılıksız JS (yayın kapısı zero-dep koşar); imzalar burada.
import type { KeyObject } from "node:crypto";
import type { AnchorKey, KunyeResult } from "./kunye-jws.mjs";

export type { AnchorKey, KunyeResult } from "./kunye-jws.mjs";

export interface ReleaseDoc {
  readonly v: 1;
  readonly urun: "panel";
  readonly platform: "win32-x64";
  readonly kanal: string;
  readonly surum: string;
  readonly commit: string;
  readonly yayinZamani: string;
  readonly paket: { readonly ad: string; readonly boyut: number; readonly sha512: string };
  /** Bu pakete gömülü çapanın kid'leri (yayın kapısının rotasyon kilidi). */
  readonly capa: readonly string[];
}

export interface VerifiedRelease {
  readonly doc: ReleaseDoc;
  readonly kid: string;
}

export interface MeasuredFile {
  readonly size: number;
  readonly sha512: string;
}

export const PANEL_RELEASE_TYP: "tekserp-panel";
export const RELEASE_BLOCK_KEY: "tekserp";
export const RELEASE_DOC_VERSION: 1;
export const RELEASE_PRODUCT: "panel";
export const RELEASE_PLATFORM: "win32-x64";
export const RELEASE_ERROR_CODES: readonly string[];

export function decodeReleaseDoc(payload: unknown): KunyeResult<ReleaseDoc>;
export function verifyReleaseBlock(block: unknown, g: { readonly keys: unknown; readonly channel: string }): KunyeResult<VerifiedRelease>;
export function sha512HexToBase64(hex: string): string;
export function checkUpdateInfo(doc: ReleaseDoc, info: unknown): KunyeResult<true>;
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null;
export function checkNewer(doc: ReleaseDoc, installedVersion: string): KunyeResult<true>;
export function verifyUpdateInfo(
  info: unknown,
  g: { readonly keys: unknown; readonly channel: string; readonly installedVersion: string },
): KunyeResult<VerifiedRelease>;
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
export function signReleaseDoc(g: { readonly doc: ReleaseDoc; readonly kid: string; readonly privateKey: KeyObject }): string;
export function messageFor(code: string): string;
