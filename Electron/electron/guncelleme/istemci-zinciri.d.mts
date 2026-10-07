// `istemci-zinciri.mjs` tip bildirimi — çalışan kod bağımlılıksız JS; imzalar burada.
import type { KeyObject } from "node:crypto";
import type { KunyeResult } from "./kunye-jws.mjs";

export interface RootAnchorKey {
  readonly kid: string;
  readonly x: string;
  readonly classes: readonly string[];
}

export interface CertificateDoc {
  readonly v: 1;
  readonly sertifikaId: string;
  readonly kullanim: string;
  readonly kid: string;
  readonly x: string;
  readonly siniflar: readonly string[];
  readonly baslangic: string;
  readonly bitis: string;
  readonly bayi: { readonly bayiId: string; readonly moduller: readonly string[] } | null;
}

export interface VerifiedCertificate {
  readonly document: CertificateDoc;
  readonly rootKid: string;
  readonly allowedClasses: readonly string[];
  readonly key: KeyObject;
}

export interface DistributionRevocationDoc {
  readonly v: 1;
  readonly iptalId: string;
  readonly sira: number;
  readonly verilis: string;
  readonly iptaller: readonly { readonly kid: string; readonly sertifikaId: string; readonly tarih: string; readonly neden: string }[];
}

export interface VerifiedDistributionRevocation {
  readonly document: DistributionRevocationDoc;
  readonly rootKid: string;
}

export interface ClientSigned {
  readonly payload: Record<string, unknown>;
  readonly kid: string;
  readonly signedAt: string;
  readonly certificate: CertificateDoc;
  readonly rootKid: string;
}

export type ClientChainResult =
  | { readonly ok: true; readonly value: ClientSigned }
  | { readonly ok: false; readonly code: string; readonly detay: string; readonly message: string };

export interface RevocationCandidate {
  readonly kaynak: string;
  readonly token: unknown;
}

export interface MergedRevocation {
  readonly revocation: VerifiedDistributionRevocation | null;
  readonly token: string | null;
  readonly kaynak: string | null;
  readonly reddedilen: readonly { readonly kaynak: string; readonly code: string; readonly message: string }[];
}

export const CERT_TYP: "tekserp-sertifika";
export const DISTRIBUTION_REVOCATION_TYP: "tekserp-paketiptal";
export const CLIENT_CERT_USAGE: "ISTEMCI";
export const CLIENT_CERT_FIELD: "imzaciSertifikasi";
export const CLIENT_SIGNED_AT_FIELD: "imzaZamani";
export const CLIENT_ACCEPT_TOLERANCE_DAYS: number;
export const CLIENT_ACCEPT_TOLERANCE_MS: number;
export const CLOCK_SKEW_MS: number;
export const LICENSE_CLASSES: readonly string[];
export const CERT_USAGES: readonly string[];
export const UUID_PATTERN: RegExp;
export const ISO_DATETIME_PATTERN: RegExp;
export const CLIENT_CHAIN_ERROR_CODES: readonly string[];
export function isIsoTime(v: unknown): v is string;
export function isClientKid(kid: unknown): boolean;
export function prepareRootAnchor(roots: unknown): KunyeResult<ReadonlyMap<string, { readonly key: KeyObject; readonly classes: readonly string[] }>>;
export function decodeCertificate(payload: Record<string, unknown>): KunyeResult<CertificateDoc>;
export function verifyCertificate(token: unknown, g: { readonly roots: unknown; readonly usage: string; readonly atMs: number }): KunyeResult<VerifiedCertificate>;
export function decodeDistributionRevocation(payload: Record<string, unknown>): KunyeResult<DistributionRevocationDoc>;
export function verifyDistributionRevocation(token: unknown, roots: unknown): KunyeResult<VerifiedDistributionRevocation>;
export function isClientCertificateRevoked(cert: CertificateDoc, revocation: VerifiedDistributionRevocation | null | undefined): boolean;
export function pickNewerRevocation(
  current: VerifiedDistributionRevocation | null,
  incoming: VerifiedDistributionRevocation | null,
): VerifiedDistributionRevocation | null;
export function mergeRevocations(roots: unknown, candidates: readonly RevocationCandidate[]): MergedRevocation;
export function verifyClientSigned(
  token: unknown,
  g: { readonly typ: string; readonly roots: unknown; readonly nowMs: number | undefined; readonly revocation?: VerifiedDistributionRevocation | null },
): ClientChainResult;
export function signClientDocument(g: {
  readonly typ: string;
  readonly kid: string;
  readonly payload: Record<string, unknown>;
  readonly privateKey: KeyObject;
  readonly certificate: string;
  readonly signedAt: string;
}): string;
