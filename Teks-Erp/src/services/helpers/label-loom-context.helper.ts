// =============================================================================
// Tezgah (MACHINE) + levent (WARP_BEAM) etiketi — payload, render girdisi, toplu kopya
// =============================================================================
// Dokuma manuel veri S1b (docs/design/DOKUMA-MANUEL-PLAN.md D3, D12). İki bağlam da
// ÇUVAL emsalidir (`label.service.buildSackRenderInput`): barkod + QR = kaydın kendi
// kodu (`Machine.code` / `WarpBeam.beamNo` — ayrı barkod kolonu YOK, tek kod kuralı);
// şablon çözülemez ya da kimlik alanını bağlamıyorsa 400 (FAIL-CLOSED, ROLL şablonuna
// SAPMAZ — `label-html-landscape` bilinmeyen türü top düzenine düşürür).
//
// Kopya: rulo/kartela akışı 1-5, Etiket Stüdyosu 1-100 tavanlıdır; tezgah etiketi
// RULO halinde basılır (operatör her topa bir tane yapıştırır) → 1-200, üstü 400
// (sessiz kırpma YOK: 250 isteyip 200 basılması fark edilmez). Emit katmanının 100
// tavanına DOKUNULMAZ (standalone sözleşmesi `test_standalone_label` onu ölçer):
// HTML tek etiket render edilip çoğaltılır, native 100'lük parçaların birleşimidir.
// =============================================================================

import { LabelKind, PrinterLanguage, StationKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ekranYolu } from "../../constants/panel-ekran-yolu";
import type { LabelPayload } from "../../types/label.types";
import { renderCode128Svg, renderQrSvg } from "./barcode-svg.helper";
import { resolveLabelRouting } from "./label-routing.resolver";
import { assertContextRenderable } from "./label-context-fit";
import { applyCopies } from "./label-html.shared";
import { renderLabel, type LabelRenderInput, type RenderedLabel } from "./label-renderer.registry";

/** Tezgah/levent toplu basım kopya tavanı — girişte doğrulanır, üstü 400. */
export const LABEL_BATCH_COPIES_MAX = 200;
/** Emit katmanının kopya tavanı (`native-label.shared.clampCopies` · `applyCopies` varsayılanı). */
const EMIT_COPIES_MAX = 100;

/** Baskı yönlendirme seçenekleri — `resolveFormatOpts(req)` çıktısı + kopya. */
export interface LoomLabelOpts {
  copies?: number;
  machineId?: string | null;
  peripheralId?: string | null;
  deviceId?: string | null;
  templateId?: string | null;
}

/**
 * Kopya adedi: verilmezse 1 (panel her zaman gönderir); tam sayı değilse ya da
 * 1..200 dışındaysa 400 `LABEL_COPIES_RANGE` — kırpma YOK.
 */
export function resolveBatchCopies(copies: number | undefined): number {
  if (copies === undefined) return 1;
  if (!Number.isInteger(copies) || copies < 1 || copies > LABEL_BATCH_COPIES_MAX) {
    throw AppError.badRequest(`Etiket adedi 1 ile ${LABEL_BATCH_COPIES_MAX} arasında bir tam sayı olmalı.`, {
      code: "LABEL_COPIES_RANGE",
    });
  }
  return copies;
}

/** Top alanları nötr — bu bağlamların etiketinde ürün/renk/kalite/müşteri YOK. */
function neutralPayload(id: string, barcode: string, kind: LabelKind): LabelPayload {
  return {
    rollId: id, barcode, status: "", qualityGrade: "", widthCm: null, lengthMeters: 0, weightKg: null,
    markedForKartela: false, itemCode: "", itemName: "", itemNameDefault: "", itemNameSource: "DEFAULT",
    colorCode: null, colorName: null, colorNameDefault: null, colorNameSource: null,
    customerName: null, customerId: null, orderNumber: null, orderLineId: null, batchNumber: null,
    printedAt: new Date().toISOString(), kind,
  };
}

const dec = (v: { toString(): string } | null | undefined): number | null => (v == null ? null : Number(v));

/**
 * Tezgah etiketi payload'ı. Yalnız DOKUMA istasyonundaki makine (değilse 400
 * `MACHINE_NOT_LOOM`) ve AKTİF tezgah (değilse 409 `MACHINE_INACTIVE`) — pasif tezgahın
 * etiketi KK1'de okutulup üretim yazamayacağı bir kimlik basardı.
 */
export async function loadMachineLabelPayload(machineId: string): Promise<LabelPayload> {
  const m = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { id: true, code: true, name: true, isActive: true, station: { select: { name: true, kind: true } } },
  });
  if (!m) throw AppError.notFound("Makine bulunamadı");
  if (m.station.kind !== StationKind.WEAVING) {
    throw AppError.badRequest(`"${m.code}" bir dokuma tezgahı değil — tezgah etiketi yalnız dokuma istasyonundaki makine için basılır.`, {
      code: "MACHINE_NOT_LOOM",
    });
  }
  if (!m.isActive) {
    throw AppError.conflict(`"${m.code}" tezgahı pasif — etiketi basılamaz. Önce tezgahı aktif edin.`, { code: "MACHINE_INACTIVE" });
  }
  return {
    ...neutralPayload(m.id, m.code, LabelKind.MACHINE),
    machineCode: m.code,
    machineName: m.name,
    stationName: m.station.name,
  };
}

/**
 * Levent etiketi payload'ı. Sarım gerçekleri İPTAL EDİLMEMİŞ WOUND satırından (bir levent
 * bir kez sarılır — partial unique); sarılmamış/iptal edilmiş sarımda metre/kg/tarih null
 * → eleman baskıda atlanır. Kumaş adı dokuma iş emrinin kalemi; işsiz leventte boş.
 */
export async function loadWarpBeamLabelPayload(beamId: string): Promise<LabelPayload> {
  const b = await prisma.warpBeam.findUnique({
    where: { id: beamId },
    select: {
      id: true, beamNo: true, physicalBeamNo: true, plannedLengthM: true,
      warpSpec: { select: { code: true, name: true } },
      weavingOrder: { select: { weavingOrderNumber: true, item: { select: { name: true } } } },
      events: {
        where: { kind: "WOUND", reversal: null },
        select: { lengthM: true, theoreticalKg: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
  });
  if (!b) throw AppError.notFound("Levent bulunamadı");
  const wound = b.events[0] ?? null;
  return {
    ...neutralPayload(b.id, b.beamNo, LabelKind.WARP_BEAM),
    itemName: b.weavingOrder?.item.name ?? "",
    beamNo: b.beamNo,
    physicalBeamNo: b.physicalBeamNo,
    warpSpecCode: b.warpSpec.code,
    warpSpecName: b.warpSpec.name,
    plannedLengthM: dec(b.plannedLengthM),
    woundLengthM: dec(wound?.lengthM),
    woundKg: dec(wound?.theoreticalKg),
    weavingOrderNumber: b.weavingOrder?.weavingOrderNumber ?? null,
    woundAt: wound ? wound.createdAt.toISOString() : null,
  };
}

const CONTEXT_NOUN: Partial<Record<LabelKind, string>> = { MACHINE: "Tezgah", WARP_BEAM: "Levent" };

/**
 * Render girdisi — FAIL-CLOSED: şablon çözülemezse 400 (SACK emsali metni), çözülen şablon
 * bağlamın kimliğini (`machineCode` / `beamNo`) bağlamıyorsa `assertContextRenderable` 400.
 * Etiketlenen makine `machineId` olarak GEÇİLMEZ: o alan YAZICININ bağlı olduğu makinedir.
 */
export async function buildLoomRenderInput(payload: LabelPayload, opts: LoomLabelOpts): Promise<LabelRenderInput> {
  const kind = payload.kind!;
  const routing = await resolveLabelRouting({
    kind,
    peripheralId: opts.peripheralId,
    templateId: opts.templateId,
    machineId: opts.machineId,
    deviceId: opts.deviceId,
  });
  const noun = CONTEXT_NOUN[kind] ?? kind;
  if (!routing.template) {
    throw AppError.badRequest(
      `${noun} etiket şablonu tanımlı değil — ${ekranYolu("etiketDuzenleri")}'nden bir ` +
        `${noun} şablonu oluşturup ${ekranYolu("etiketAtamalari")}'nda Bağlam Varsayılanı olarak atayın.`,
      { code: "LABEL_TEMPLATE_MISSING" },
    );
  }
  assertContextRenderable(routing.template, kind);
  return {
    payload,
    template: routing.template,
    variant: routing.variant,
    barcodeSvg: renderCode128Svg(payload.barcode),
    qrSvg: renderQrSvg(payload.barcode),
    copies: resolveBatchCopies(opts.copies),
    format: routing.format,
    rasterMode: routing.rasterMode,
  };
}

/** HTML: tek etiket render edilir, gövde N kez çoğaltılır (200 tavanı burada). */
async function renderHtmlBatch(input: LabelRenderInput): Promise<RenderedLabel> {
  const one = await renderLabel(PrinterLanguage.RASTER_HTML, { ...input, copies: 1 });
  return { ...one, content: applyCopies(one.content, input.copies, LABEL_BATCH_COPIES_MAX) };
}

export async function renderLoomHtml(input: LabelRenderInput): Promise<string> {
  return (await renderHtmlBatch(input)).content;
}

/**
 * Seçili dil: RASTER_HTML → HTML çoğaltma; native/raster → emit tavanı (100) aşılırsa
 * ≤100'lük İŞLERİN ardışık birleşimi (yazıcı her işi sırayla basar; metin yolunda
 * dizgi, raster yolunda bayt birleşimi).
 */
export async function renderLoomNative(input: LabelRenderInput): Promise<RenderedLabel> {
  const language = input.format.language;
  if (language === PrinterLanguage.RASTER_HTML) return renderHtmlBatch(input);
  const parts: RenderedLabel[] = [];
  for (let left = input.copies; left > 0; left -= EMIT_COPIES_MAX) {
    parts.push(await renderLabel(language, { ...input, copies: Math.min(EMIT_COPIES_MAX, left) }));
  }
  if (parts.length === 1) return parts[0]!;
  const first = parts[0]!;
  if (first.encoding === "binary") {
    return { ...first, bytes: Buffer.concat(parts.map((p) => p.bytes ?? Buffer.alloc(0))) };
  }
  return { ...first, content: parts.map((p) => p.content).join("") };
}
