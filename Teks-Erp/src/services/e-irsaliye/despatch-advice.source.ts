// =============================================================================
// Donmuş sevk irsaliyesi snapshot'ı → DespatchInput (saf eşleme, DB'ye inmez).
// İçerik kâğıt irsaliyenin ACTIVE snapshot'ından gelir (BRÜT, yeniden hesap YOK);
// ürün adı `resolveDocNameMode` + `customerNameOr`dan, sayı `docNum`dan, tarih/saat
// fabrika diliminden geçer. Snapshot'ta olmayan bilgi (taşıma, alıcı adresi/vergi
// dairesi, firma künyesi) çağırandan gelir; eksikse boş kalır, doğrulayıcı söyler.
// =============================================================================
import { DOMESTIC_COUNTRY_NAME } from "../../constants/e-irsaliye";
import { factoryTimeHms, factoryYmd } from "../../constants/time";
import { docNum, type DocNum } from "../document-render/fmt-num";
import type { ShipmentDispatchDoc } from "../document-render/shipment-dispatch.html";
import { customerNameOr, resolveDocNameMode } from "../document-render/shipment-name-mode";
import type { PrintedDocSnapshot } from "../printed-document.service";
import type { ShippingDocItemNameMode } from "../system-setting.service";
import type { DespatchInput, DespatchLineInput, DriverInput, PartyInput, PostalAddressInput } from "./despatch-advice.types";

/** Sevk irsaliyesindeki metre/kg hücresinin hanesi (`shipment-dispatch.html.ts` QTY) — bekçi eşitliği ölçer. */
export const DISPATCH_QTY_DECIMALS = 2;

/** e-İrsaliye kaydında elle tamamlanan alanlar (plan §2: eksik verinin TEK tamamlanma noktası). */
export interface DespatchRecordFields {
  documentNo: string;
  ettn: string;
  licensePlate?: string | null;
  trailerPlate?: string | null;
  driverFirstName?: string | null;
  driverFamilyName?: string | null;
  driverNationalId?: string | null;
  carrierName?: string | null;
  carrierTaxId?: string | null;
  /** TCKN'li alıcıda kişi adı/soyadı. */
  recipientFirstName?: string | null;
  recipientFamilyName?: string | null;
}

/** Alıcının cari kartından canlı okunan, snapshot'ta olmayan alanlar. */
export interface RecipientCardFields {
  /** Snapshot'taki vergi no boşsa (eski belge) kullanılır. */
  taxId?: string | null;
  /** Vergi dairesinin TEK kaynağı cari kartıdır (patron kararı). */
  taxOffice?: string | null;
  address: {
    streetName?: string | null;
    citySubdivisionName?: string | null;
    cityName?: string | null;
    postalZone?: string | null;
    countryName?: string | null;
  };
}

export interface MapSnapshotArgs {
  /** ACTIVE `SHIPMENT_DISPATCH` zarfı — `numberRounding` damgası `docNum`a gider. */
  snapshot: PrintedDocSnapshot;
  /** Firma resmi künyesi (gönderici). */
  supplier: PartyInput;
  record: DespatchRecordFields;
  recipient: RecipientCardFields;
  /** `shipping.docItemNameMode` — baskıda olduğu gibi canlı okunur, XML'e DONAR. */
  nameMode: ShippingDocItemNameMode;
  /** Snapshot'ta yön alanı yoksa sevkiyatın canlı yönü. */
  shipmentDestination: "DOMESTIC" | "EXPORT";
  dispatchNote?: string | null;
  /** Düzenleme anı (`IssueDate/IssueTime`). */
  now: Date;
  /** `Shipment.dispatchedAt` (`ActualDespatchDate/Time`). */
  dispatchedAt: Date;
}

/** Belgedeki TR yazımı ("1.234,50") → UBL ondalığı ("1234.50"): kâğıtla aynı hane, tek yuvarlama. */
export function xmlDecimal(num: DocNum, n: number, dec: number): string {
  return num.tr(n, dec).replace(/\./g, "").replace(",", ".");
}

const clean = (v: string | null | undefined): string => (v ?? "").trim();
const cleanOrNull = (v: string | null | undefined): string | null => clean(v) || null;

/** Plaka: boşlukları at, büyük harfe çevir (plakada Türkçe harf yok; yanlışsa doğrulayıcı söyler). */
export function normalizePlate(v: string | null | undefined): string | null {
  const s = clean(v).replace(/\s+/g, "").toUpperCase();
  return s || null;
}

function mapLines(doc: ShipmentDispatchDoc, num: DocNum, nameMode: ShippingDocItemNameMode): DespatchLineInput[] {
  const mode = resolveDocNameMode({ itemNameMode: nameMode });
  return (doc.products ?? []).map((p) => {
    const customerName = customerNameOr(p.customerName, p.name);
    const showBoth = mode.showCustomerName && mode.showOurName && customerName !== p.name;
    return {
      itemName: mode.showCustomerName ? customerName : p.name,
      itemDescription: showBoth ? p.name : null,
      meters: xmlDecimal(num, p.totalMeters, DISPATCH_QTY_DECIMALS),
      rollCount: p.rollCount,
    };
  });
}

function recipientAddress(r: RecipientCardFields): PostalAddressInput {
  return {
    streetName: cleanOrNull(r.address.streetName),
    citySubdivisionName: clean(r.address.citySubdivisionName),
    cityName: clean(r.address.cityName),
    postalZone: cleanOrNull(r.address.postalZone),
    countryName: clean(r.address.countryName) || DOMESTIC_COUNTRY_NAME,
  };
}

function drivers(rec: DespatchRecordFields): DriverInput[] {
  const any = [rec.driverFirstName, rec.driverFamilyName, rec.driverNationalId].some((v) => clean(v) !== "");
  if (!any) return [];
  return [{ firstName: clean(rec.driverFirstName), familyName: clean(rec.driverFamilyName), nationalId: clean(rec.driverNationalId) }];
}

function notes(doc: ShipmentDispatchDoc, dispatchNote: string | null | undefined): string[] {
  const out: string[] = [];
  if (clean(dispatchNote)) out.push(clean(dispatchNote));
  if (clean(doc.header.orderNos)) out.push(`Sipariş No: ${clean(doc.header.orderNos)}`);
  out.push(`Toplam ${doc.totals.totalRolls} top`);
  return out;
}

/** Snapshot + künye + kayıt → doğrulanmaya hazır DespatchInput. */
export function mapSnapshotToDespatchInput(args: MapSnapshotArgs): DespatchInput {
  const doc = args.snapshot.doc as unknown as ShipmentDispatchDoc;
  const num = docNum(args.snapshot);
  const h = doc.header;
  const t = doc.totals;
  const rec = args.record;
  const handlingUnits = t.manualSackCount ?? t.sackCount;
  const hasPerson = clean(rec.recipientFirstName) !== "" || clean(rec.recipientFamilyName) !== "";
  const hasCarrier = clean(rec.carrierName) !== "" || clean(rec.carrierTaxId) !== "";
  return {
    documentNo: clean(rec.documentNo),
    ettn: clean(rec.ettn),
    issueDate: factoryYmd(args.now),
    issueTime: factoryTimeHms(args.now),
    destination: h.destination ?? args.shipmentDestination,
    notes: notes(doc, args.dispatchNote),
    supplier: args.supplier,
    customer: {
      taxId: clean(h.customerTaxNumber) || clean(args.recipient.taxId),
      name: clean(h.customerName),
      person: hasPerson ? { firstName: clean(rec.recipientFirstName), familyName: clean(rec.recipientFamilyName) } : null,
      taxOffice: cleanOrNull(args.recipient.taxOffice),
      address: recipientAddress(args.recipient),
    },
    shipment: {
      id: clean(h.shipmentNo),
      grossWeightKg: t.totalKg > 0 ? xmlDecimal(num, t.totalKg, DISPATCH_QTY_DECIMALS) : null,
      handlingUnitCount: handlingUnits > 0 ? handlingUnits : null,
      actualDespatchDate: factoryYmd(args.dispatchedAt),
      actualDespatchTime: factoryTimeHms(args.dispatchedAt),
    },
    transport: {
      licensePlate: normalizePlate(rec.licensePlate),
      trailerPlate: normalizePlate(rec.trailerPlate),
      drivers: drivers(rec),
      carrier: hasCarrier ? { name: clean(rec.carrierName), taxId: clean(rec.carrierTaxId) } : null,
    },
    lines: mapLines(doc, num, args.nameMode),
  };
}
