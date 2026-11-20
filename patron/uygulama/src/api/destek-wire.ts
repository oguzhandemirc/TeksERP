// Etkili Destek tel tipleri (bulut `/api/destek/*`; sözleşme `docs/ops/DESTEK-ENTEGRASYONU-BULUT.md` §4–§7).
// `wire.ts` sunucuyla BAYT-EŞİT olduğundan destek tipleri ayrı dosyadadır; sunucu destek tipini `wire/api.ts`e
// taşırsa bu dosya oraya katlanır. Kimlik (user/tenant) istemciden GÖNDERİLMEZ — bulut oturumdan kurar.

export type DestekTur = "BUG" | "QUESTION" | "REQUEST";
export type DestekDurum = "NEW" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "ANSWERED" | "CLOSED";
export type DestekMesajTuru = "CUSTOMER" | "AGENT_REPLY" | "SYSTEM";
export type DestekKapsam = "mine" | "tenant";

export interface DestekEk {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly createdAt: string;
  readonly hasThumb: boolean;
  readonly deleted: boolean;
  readonly deletedAt: string | null;
}

export interface DestekMesaj {
  readonly id: string;
  readonly kind: DestekMesajTuru;
  readonly body: string;
  readonly authorName: string | null;
  readonly authorExternalUserId: string | null;
  readonly createdAt: string;
  readonly attachments: readonly DestekEk[];
}

export interface DestekTalep {
  readonly id: string;
  readonly number: string;
  readonly type: DestekTur;
  readonly status: DestekDurum;
  readonly subject: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly messages: readonly DestekMesaj[];
  /** Yalnız talep açma yanıtında. */
  readonly idempotentReplay?: boolean;
}

export interface DestekListeOgesi {
  readonly id: string;
  readonly number: string;
  readonly type: DestekTur;
  readonly status: DestekDurum;
  readonly subject: string;
  readonly requester: { readonly id: string; readonly name: string } | null;
  readonly unreadReplies: number;
  readonly lastActivityAt: string;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DestekSayfa {
  readonly items: readonly DestekListeOgesi[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface DestekOkunmamis {
  readonly count: number;
  /** Okunmamış ekip yanıtı taşıyan talep sayısı — rozette bu gösterilir. */
  readonly tickets: number;
}

/** Ek: düz base64 (`data:` öneki YOK). */
export interface DestekDosya {
  readonly name: string;
  readonly contentType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf";
  readonly dataBase64: string;
}

/** Bağlam KATIdır: yalnız bu alanlar (bilinmeyen üst alan 400). Toplam ≤ 16 KB. */
export interface DestekBaglam {
  screen?: string;
  path?: string;
  client?: { userAgent?: string; browser?: string; os?: string; device?: string; appVersion?: string; locale?: string };
  technical?: Record<string, unknown>;
}

export interface TalepAcGovde {
  readonly type: DestekTur;
  readonly subject: string;
  readonly message: string;
  readonly clientToken: string;
  readonly context?: DestekBaglam;
  readonly files?: readonly DestekDosya[];
}

export interface DestekEkBaglantisi {
  readonly url: string;
  readonly expiresAt: string;
}
