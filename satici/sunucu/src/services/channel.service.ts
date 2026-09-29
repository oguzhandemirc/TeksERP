// KANAL — dağıtım kanalı ana verisi (asgari): kod · ad · tür · güncel sürümler. Kurulum kanala
// bağlıdır (FK); kira `kanal.guncelSurumler`i buradan alır. `kod` kimliktir ve DEĞİŞMEZ (indirme
// belirtecinin yol öneki `/<kod>/…`); sert silme yok. Yayın bildirimi (güncel sürümün otomatik
// yazılması + zil) Faz 3'te — bugün satıcı elle günceller.
import type { Kanal, KanalTuru, Prisma } from "@prisma/client";
import { z } from "zod";
import { ChannelCodeSchema, VersionTextSchema } from "../lisans-protokol";
import { badRequest, notFoundError, stateConflict } from "../lib/errors";
import type { Db, Tx } from "../lib/prisma";
import { uniqueViolationOn } from "../lib/prisma-errors";

export const CHANNEL_KINDS = ["uretim", "hazirlik"] as const satisfies readonly KanalTuru[];

/** Protokol KİRA `kanal.guncelSurumler` alanının KATI hâli (yazımda tanınmayan anahtar RED). */
export const ChannelVersionsSchema = z.strictObject({
  backend: VersionTextSchema.optional(),
  panel: VersionTextSchema.optional(),
  tablet: VersionTextSchema.optional(),
});
export type ChannelVersions = z.infer<typeof ChannelVersionsSchema>;

/** Kiraya giden sürümler: kayıtlı JSON şemaya uymuyorsa boş küme (bozuk veri kira basımını düşürmez). */
export function channelVersionsForLease(channel: Pick<Kanal, "guncelSurumler"> | null): ChannelVersions {
  if (!channel) return {};
  const parsed = ChannelVersionsSchema.safeParse(channel.guncelSurumler);
  return parsed.success ? parsed.data : {};
}

function cleanName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 200) throw badRequest("Kanal adı 1–200 karakter olmalı");
  return n;
}

function cleanVersions(v: unknown): Prisma.InputJsonObject {
  const parsed = ChannelVersionsSchema.safeParse(v ?? {});
  if (!parsed.success) throw badRequest("Güncel sürümler yalnız backend · panel · tablet anahtarlarında X.Y.Z biçiminde olabilir");
  return parsed.data;
}

/** Kurulum doğarken/kanalı değişirken: kanal KAYITLI olmalı (FK'nın okunur hatası). */
export async function requireChannel(db: Db, code: string): Promise<Kanal> {
  if (!ChannelCodeSchema.safeParse(code).success) throw badRequest("Kanal kodu biçimsiz");
  const channel = await db.kanal.findUnique({ where: { kod: code } });
  if (!channel) throw badRequest(`Kanal kayıtlı değil: ${code} (önce portalda kanal açın)`);
  return channel;
}

export async function findChannel(db: Db, channelId: string): Promise<Kanal> {
  const channel = await db.kanal.findUnique({ where: { id: channelId } });
  if (!channel) throw notFoundError("Kanal");
  return channel;
}

export async function listChannels(db: Db): Promise<(Kanal & { kurulumSayisi: number })[]> {
  const rows = await db.kanal.findMany({ orderBy: [{ kod: "asc" }], include: { _count: { select: { kurulumlar: true } } } });
  return rows.map(({ _count, ...k }) => ({ ...k, kurulumSayisi: _count.kurulumlar }));
}

export interface CreateChannelInput {
  readonly code: string;
  readonly name: string;
  readonly kind: KanalTuru;
  readonly versions?: unknown;
}

/** Tek satır ekleme (ebeveyni yok): kod tekilliği UNIQUE ile — yarışı kaybeden de aynı 409'u alır. */
export async function createChannelTx(tx: Tx, g: CreateChannelInput): Promise<Kanal> {
  if (!ChannelCodeSchema.safeParse(g.code).success) throw badRequest("Kanal kodu küçük harf/rakam/tire, en çok 40 karakter olmalı");
  const taken = await tx.kanal.findUnique({ where: { kod: g.code }, select: { id: true } });
  if (taken) throw stateConflict(`Bu kanal kodu kayıtlı: ${g.code}`);
  return tx.kanal
    .create({ data: { kod: g.code, ad: cleanName(g.name), tur: g.kind, guncelSurumler: cleanVersions(g.versions) } })
    .catch((err: unknown) => {
      throw uniqueViolationOn(err, "kod") ? stateConflict(`Bu kanal kodu kayıtlı: ${g.code}`) : err;
    });
}

export interface UpdateChannelInput {
  readonly channelId: string;
  readonly name?: string;
  readonly kind?: KanalTuru;
  readonly versions?: unknown;
}

/** Ad · tür · güncel sürümler (kod değişmez). Kira bir sonraki yoklamada yeni sürümleri taşır. */
export async function updateChannelTx(tx: Tx, g: UpdateChannelInput): Promise<Kanal> {
  const channel = await findChannel(tx, g.channelId);
  const data: Prisma.KanalUpdateInput = {
    ...(g.name === undefined ? {} : { ad: cleanName(g.name) }),
    ...(g.kind === undefined ? {} : { tur: g.kind }),
    ...(g.versions === undefined ? {} : { guncelSurumler: cleanVersions(g.versions) }),
  };
  if (Object.keys(data).length === 0) return channel;
  return tx.kanal.update({ where: { id: channel.id }, data });
}

/** Bayi tavanına yazılacak kanallar: tekrarsız, hepsi kayıtlı. */
export async function cleanChannelList(db: Db, codes: readonly string[]): Promise<string[]> {
  const unique = [...new Set(codes)];
  if (unique.length > 100) throw badRequest("En çok 100 kanal");
  for (const code of unique) await requireChannel(db, code);
  return unique;
}
