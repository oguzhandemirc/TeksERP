// `kunye-jws.mjs` tip bildirimi — çalışan kod bağımlılıksız JS (yayın kapısı zero-dep koşar); imzalar burada.
import type { KeyObject } from "node:crypto";

export type KunyeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface AnchorKey {
  readonly kid: string;
  readonly x: string;
}

export interface JwsHeader {
  readonly alg: "EdDSA";
  readonly typ: string;
  readonly kid: string;
}

export interface ParsedJws {
  readonly header: JwsHeader;
  readonly payload: Record<string, unknown>;
  readonly signingInput: Buffer;
  readonly signature: Buffer;
}

export const JWS_ALG: "EdDSA";
export const JWS_MAX_LENGTH: number;
export const PRODUCTION_SIGNER_KID: RegExp;
export function ok<T>(value: T): KunyeResult<T>;
export function fail<T = never>(code: string, message: string): KunyeResult<T>;
export function isPlainObject(value: unknown): value is Record<string, unknown>;
export function b64uDecode(text: unknown): Buffer | null;
export function b64uEncode(data: Uint8Array | string): string;
export function parseJws(token: unknown): KunyeResult<ParsedJws>;
export function publicKeyFromX(x: string): KeyObject | null;
export function isSignerKid(kid: unknown): boolean;
export function anchorLookup(keys: unknown): KunyeResult<ReadonlyMap<string, KeyObject>>;
export function checkProductionAnchor(keys: readonly AnchorKey[]): KunyeResult<ReadonlyMap<string, KeyObject>>;
export function verifyJwsWithAnchor(token: unknown, g: { readonly typ: string; readonly keys: unknown }): KunyeResult<ParsedJws>;
export function signJwsCompact(g: {
  readonly typ: string;
  readonly kid: string;
  readonly payload: Record<string, unknown>;
  readonly privateKey: KeyObject;
}): string;
