// =============================================================================
// LEVENT GÖVDESİ — form şeması, istek gövdesi kurucuları ve görüntü metinleri (saf; test edilir)
// =============================================================================
// Şema backend Zod'unun (beam-body.routes.ts) panel ikizidir: no ≤32 · not ≤500 · ölçü > 0. Kesin hat sunucuda.
// Sahip: Bizim → cari yok; Devereci → fason profili (sunucu bağlı cariyi çözer) ya da mevcut cari; Müşteri/Başka → cari.
// =============================================================================
import { z } from "zod";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import type { BeamBody, BeamBodyCreateBody, BeamBodyOwnerInput, BeamBodyOwnerKind, BeamBodyPatchBody, BeamBodyPlace } from "./types";

const NO_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/;
const optPositive = (label: string) =>
  z.string().trim().refine((v) => v === "" || (Number.isFinite(Number(v.replace(",", "."))) && Number(v.replace(",", ".")) > 0), `${label} sıfırdan büyük sayı olmalı`);

export const beamBodyFormSchema = z
  .object({
    bodyNo: z.string().trim().max(32, "Gövde no en çok 32 karakter").refine((v) => v === "" || NO_RE.test(v), "Gövde no harf/rakamla başlar; harf, rakam ve . _ / - içerebilir"),
    ownerKind: z.enum(["OURS", "WARPER", "CUSTOMER", "OTHER"]),
    ownerCustomerId: z.string().nullable(),
    ownerSubcontractorId: z.string().nullable(),
    widthCm: optPositive("Gövde eni"),
    flangeDiameterCm: optPositive("Flanş çapı"),
    tareKg: optPositive("Dara"),
    initialStatus: z.enum(["EMPTY_STOCK", "AT_SUBCONTRACTOR"]),
    warehouseId: z.string().nullable(),
    subcontractorId: z.string().nullable(),
    machineIds: z.array(z.string()).max(200, "En çok 200 uyumlu tezgâh"),
    notes: z.string().max(500, "Not en çok 500 karakter"),
  })
  .superRefine((v, ctx) => {
    if (v.ownerKind === "WARPER" && !v.ownerSubcontractorId && !v.ownerCustomerId) ctx.addIssue({ code: "custom", path: ["ownerSubcontractorId"], message: "Gövdenin sahibi olan devereciyi seçin" });
    if ((v.ownerKind === "CUSTOMER" || v.ownerKind === "OTHER") && !v.ownerCustomerId) ctx.addIssue({ code: "custom", path: ["ownerCustomerId"], message: "Gövdenin sahibi olan cariyi seçin" });
    if (v.initialStatus === "AT_SUBCONTRACTOR" && !v.subcontractorId) ctx.addIssue({ code: "custom", path: ["subcontractorId"], message: "Gövdenin bulunduğu devereciyi seçin" });
  });

export type BeamBodyFormValues = z.infer<typeof beamBodyFormSchema>;

const numText = (v: string | null) => (v === null ? "" : trimNum(v));

export function beamBodyDefaults(b: BeamBody | null): BeamBodyFormValues {
  return {
    bodyNo: b?.bodyNo ?? "",
    ownerKind: b?.owner.kind ?? "OURS",
    ownerCustomerId: b?.owner.customer?.id ?? null,
    ownerSubcontractorId: null,
    widthCm: numText(b?.widthCm ?? null),
    flangeDiameterCm: numText(b?.flangeDiameterCm ?? null),
    tareKg: numText(b?.tareKg ?? null),
    initialStatus: "EMPTY_STOCK",
    warehouseId: null,
    subcontractorId: null,
    machineIds: b?.machineFits.map((m) => m.id) ?? [],
    notes: b?.notes ?? "",
  };
}

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v.trim().replace(",", ".")));
const textOrNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

export function ownerInputOf(v: Pick<BeamBodyFormValues, "ownerKind" | "ownerCustomerId" | "ownerSubcontractorId">): BeamBodyOwnerInput {
  if (v.ownerKind === "OURS") return { kind: "OURS" };
  if (v.ownerKind === "WARPER" && v.ownerSubcontractorId) return { kind: "WARPER", subcontractorId: v.ownerSubcontractorId };
  return { kind: v.ownerKind, customerId: v.ownerCustomerId };
}

export function buildCreateBody(v: BeamBodyFormValues): BeamBodyCreateBody {
  const atSub = v.initialStatus === "AT_SUBCONTRACTOR";
  return {
    bodyNo: textOrNull(v.bodyNo),
    owner: ownerInputOf(v),
    widthCm: num(v.widthCm),
    flangeDiameterCm: num(v.flangeDiameterCm),
    tareKg: num(v.tareKg),
    initialStatus: v.initialStatus,
    warehouseId: atSub ? null : v.warehouseId,
    subcontractorId: atSub ? v.subcontractorId : null,
    machineIds: v.machineIds,
    notes: textOrNull(v.notes),
  };
}

/** Düzenleme: sahip YALNIZ değiştiyse gider (sahip değişimi yalnız depoda boşken; değişmeyen sahip 409 doğurmasın). */
export function buildPatchBody(v: BeamBodyFormValues, before: BeamBody): BeamBodyPatchBody {
  const ownerChanged = v.ownerKind !== before.owner.kind || Boolean(v.ownerSubcontractorId) || (v.ownerCustomerId ?? null) !== (before.owner.customer?.id ?? null);
  return {
    ...(ownerChanged ? { owner: ownerInputOf(v) } : {}),
    widthCm: num(v.widthCm),
    flangeDiameterCm: num(v.flangeDiameterCm),
    tareKg: num(v.tareKg),
    machineIds: v.machineIds,
    notes: textOrNull(v.notes),
  };
}

export function trimNum(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(n).replace(".", ",") : v;
}

/** "160 cm · flanş 80 cm · 45 kg" — boş ölçü atlanır. */
export function dimsText(b: Pick<BeamBody, "widthCm" | "flangeDiameterCm" | "tareKg">): string {
  const parts = [b.widthCm && `${trimNum(b.widthCm)} cm`, b.flangeDiameterCm && `flanş ${trimNum(b.flangeDiameterCm)} cm`, b.tareKg && `${trimNum(b.tareKg)} kg dara`].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Nerede: tezgâh > devereci > depo; hiçbiri yoksa "—". */
export function placeText(p: BeamBodyPlace): string {
  if (p.machine) return `${p.machine.name} (${p.machine.code})`;
  if (p.subcontractor) return p.subcontractor.name;
  if (p.warehouse) return p.warehouse.name;
  return "—";
}

/** Sahip: Bizim · ya da "Cari adı (rol)". */
export function ownerText(o: BeamBody["owner"]): string {
  return o.kind === "OURS" || !o.customer ? o.label : `${o.customer.name} · ${o.label}`;
}

export const ownerNeedsCustomer = (k: BeamBodyOwnerKind) => k !== "OURS";

export const eventTimeText = (iso: string) => fmtFactoryDateTime(iso);
