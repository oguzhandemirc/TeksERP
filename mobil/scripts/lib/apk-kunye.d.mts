// `apk-kunye.mjs` tip bildirimi — çalışan kod bağımlılıksız JS (yayın kapısı zero-dep koşar); imzalar burada.
import type { KeyObject } from "node:crypto";
import type { KunyeResult } from "../../../Electron/electron/guncelleme/kunye-jws.mjs";

export interface ApkDoc {
  readonly v: 1;
  readonly urun: "tablet";
  readonly platform: "android-arm64";
  readonly kanal: string;
  readonly versionCode: number;
  readonly versionName: string;
  readonly commit: string;
  readonly yayinZamani: string;
  readonly paket: { readonly ad: string; readonly boyut: number; readonly sha256: string };
  readonly capa: readonly string[];
}

export const APK_RELEASE_TYP: "tekserp-apk";
export const APK_KUNYE_ALANI: "tekserp";
export const APK_DOC_VERSION: 1;
export const APK_PRODUCT: "tablet";
export const APK_PLATFORM: "android-arm64";
export function apkDosyaAdi(versionName: string, versionCode: number): string;
export function decodeApkDoc(payload: unknown): KunyeResult<ApkDoc>;
export function buildApkDoc(g: {
  readonly kanal: string;
  readonly versionCode: number;
  readonly versionName: string;
  readonly commit: string;
  readonly yayinZamani: string;
  readonly paket: { readonly ad: string; readonly boyut: number; readonly sha256: string };
  readonly capa: readonly string[];
}): ApkDoc;
export function signApkDoc(g: { readonly doc: ApkDoc; readonly kid: string; readonly privateKey: KeyObject }): string;
export function checkApkSurumJson(doc: ApkDoc, s: Record<string, unknown>): KunyeResult<true>;
export function verifyApkSurumJson(
  s: unknown,
  g: { readonly keys: unknown; readonly channel: string },
): KunyeResult<{ readonly doc: ApkDoc; readonly kid: string }>;
export function withApkBlock<T extends Record<string, unknown>>(s: T, token: string): T & { tekserp: { v: 1; bildirim: string } };

export interface ApkKapiSonucu {
  readonly sonuc: "uyumlu" | "ihlal" | "bos";
  readonly satirlar: readonly string[];
}
export const APK_CAPA_REL: "mobil/src/lib/apk-imza-capasi.json";
export function apkCapasiOku(kok: string): Array<{ kid: string; x: string }>;
export function apkCapaDenetimi(liste: ReadonlyArray<{ kid: string; x: string }>): ApkKapiSonucu;
export function apkCapaGomuluFarki(bundleMetni: string, liste: ReadonlyArray<{ kid: string; x: string }>): string[];
export function apkRotasyonDenetimi(g: { readonly yayindaki: string | null; readonly yeniKid: string }): ApkKapiSonucu;
