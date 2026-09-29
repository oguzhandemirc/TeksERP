// Dağıtım belirteci (/d · /y): 24 rastgele bayt (base64url, 32 karakter). DB'de yalnız sunucu sırrıyla
// ALAN AYRIMLI HMAC özeti + son 4 karakter durur; düz metin yalnız doğduğu yanıtta BİR KEZ görünür.
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Tx } from "../lib/prisma";
import type { VendorContext } from "../services/context";

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const SCOPE = "dagitim-belirteci";

export interface IssuedToken {
  readonly token: string;
  readonly digest: string;
  readonly tail: string;
}

export function issueToken(ctx: VendorContext): IssuedToken {
  const token = randomBytes(24).toString("base64url");
  return { token, digest: ctx.codeHasher.digestScoped(SCOPE, token), tail: token.slice(-4) };
}

/** Biçimsiz belirteç DB'ye gitmez (null → çağıran "bulunamadı" der). */
export function tokenDigest(ctx: VendorContext, token: string): string | null {
  return TOKEN_PATTERN.test(token) ? ctx.codeHasher.digestScoped(SCOPE, token) : null;
}

// Günlükte/erişim kaydında belirteç görünmez: /d/<b> ve /y/<b>/… yolunda belirteç yıldızla maskelenir.
export function maskTokenPath(p: string): string {
  return p.replace(/^\/(d|y)\/[^/]+/, "/$1/***");
}

export const LEDGER_EVENTS = [
  "BAGLANTI_VERILDI",
  "INDIRILDI",
  "BAGLANTI_IPTAL",
  "YUKLEME_ISTEGI_VERILDI",
  "YUKLEME_ISTEGI_IPTAL",
  "DOSYA_YUKLENDI",
  "YUKLEME_TERK",
  "GOVDE_BUDANDI",
] as const;
export type LedgerEvent = (typeof LEDGER_EVENTS)[number];

/** Dağıtım defterine satır (değişmez; iptal/terk/budama da kendi satırıdır). */
export async function appendLedger(
  tx: Tx,
  g: {
    readonly event: LedgerEvent;
    readonly customerId: string;
    readonly actor: string;
    readonly linkId?: string;
    readonly requestId?: string;
    readonly fileId?: string;
    readonly sessionId?: string;
    readonly detail?: Prisma.InputJsonObject;
  },
): Promise<void> {
  await tx.dagitimDefteri.create({
    data: {
      olay: g.event,
      musteriId: g.customerId,
      yapan: g.actor,
      baglantiId: g.linkId ?? null,
      istekId: g.requestId ?? null,
      dosyaId: g.fileId ?? null,
      oturumId: g.sessionId ?? null,
      ...(g.detail === undefined ? {} : { ayrinti: g.detail }),
    },
  });
}
