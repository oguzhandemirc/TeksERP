// =============================================================================
// KART KİMLİĞİ — ürün kartı (`items`) ↔ hizmet kartı (`service_items`) iki yönlü tekillik (MV-04)
// =============================================================================
// İki tablo ayrı ama kod ve ad aynı kimlik uzayıdır: etikete/belgeye basılan kod ve aranan ad bir ürünle
// bir hizmeti karıştırmamalı. Tablo içi tekillik kendi kapısındadır; burası yalnız KARŞI tabloyu sorar.
// Kod kilidi iki yolda aynı kapsamla (`CARD_CODE_LOCK_SCOPE`, 8029 uzayı) alınır ⇒ çapraz yarış serileşir.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { foldCodeForCompare } from "../../utils/code-format";
import { foldNameForCompare } from "./name-normalize.helper";

type Db = Prisma.TransactionClient | typeof prisma;
export type CardKind = "item" | "serviceItem";

/** Ürün ve hizmet kartı kodları TEK kilit kapsamını paylaşır (ürünün tarihsel kapsam adı). */
export const CARD_CODE_LOCK_SCOPE = "item";

const KIND_LABEL: Record<CardKind, string> = { item: "ürün kartında", serviceItem: "hizmet kartında" };

// Durum `lifecycleStatus`ten okunur; tek boolean iki anlamlıdır (test_item_usage_single_source).
interface Hit { code: string; name: string; lifecycleStatus: string }

async function otherByCode(db: Db, other: CardKind, code: string): Promise<Hit | null> {
  const target = foldCodeForCompare(code);
  // Master tablolar küçük; katlama JS'te (code-unique.helper gerekçesi: PG lower() İ/ı'da hatalı).
  const rows: Hit[] = other === "item"
    ? await db.item.findMany({ where: { mergedIntoId: null }, select: { code: true, name: true, lifecycleStatus: true } })
    : await db.serviceItem.findMany({ where: { mergedIntoId: null }, select: { code: true, name: true, lifecycleStatus: true } });
  return rows.find((r) => foldCodeForCompare(r.code) === target) ?? null;
}

/** `self` türünde açılacak/yeniden adlandırılacak kartın kodu KARŞI tabloda var mı → 409. */
export async function assertCodeFreeInOtherKind(db: Db, self: CardKind, code: string): Promise<void> {
  const other: CardKind = self === "item" ? "serviceItem" : "item";
  const hit = await otherByCode(db, other, code);
  if (!hit) return;
  throw AppError.conflict(
    `'${code}' kodu bir ${KIND_LABEL[other]} kullanılıyor — '${hit.code}' (${hit.name})${hit.lifecycleStatus === "ARCHIVED" ? ", pasif" : ""}. ` +
      "Ürün ve hizmet kartı kodları birlikte tekildir; farklı bir kod girin.",
    { code: "CARD_CODE_TAKEN_BY_OTHER_KIND" },
  );
}

/** Ad (Türkçe katlanmış) KARŞI tabloda canlı bir kartta var mı → 409. */
export async function assertNameFreeInOtherKind(db: Db, self: CardKind, name: string): Promise<void> {
  if (name.trim().length === 0) return;
  const nameFold = foldNameForCompare(name);
  const where = { nameFold, mergedIntoId: null };
  const select = { code: true, name: true, lifecycleStatus: true } as const;
  const hit: Hit | null = self === "item"
    ? await db.serviceItem.findFirst({ where, select })
    : await db.item.findFirst({ where, select });
  if (!hit) return;
  const other: CardKind = self === "item" ? "serviceItem" : "item";
  throw AppError.conflict(
    `'${name.trim()}' adı bir ${KIND_LABEL[other]} kullanılıyor (kod: ${hit.code}). Ürün ve hizmet kartı adları birlikte tekildir.`,
    { code: "CARD_NAME_TAKEN_BY_OTHER_KIND" },
  );
}

/** Numara serisi yükleyicisi için iki tablonun ön ekle başlayan kodları (sayaç çakışması iki tabloyu görür). */
export async function cardCodesWithPrefix(prefix: string): Promise<Array<{ code: string; createdAt: Date }>> {
  const where = { code: { gte: prefix, startsWith: prefix } };
  const select = { code: true, createdAt: true } as const;
  const items = await prisma.item.findMany({ where, select });
  const services = await prisma.serviceItem.findMany({ where, select });
  return [...items, ...services];
}
