// =============================================================================
// Üretilmiş DespatchAdvice ağacının yapısal denetimi (`validateDespatchXml`in gövdesi).
// Sıra tabloları yazıcıyla AYNI kaynaktan (`despatch-advice.order.ts`) okunur: yazıcının
// bir öğeyi tablo dışına/sırasız koyması burada yakalanır. XSD'nin yerini tutmaz (V3).
// =============================================================================
import {
  ADDRESS_ORDER,
  CONTACT_ORDER,
  DELIVERY_ORDER,
  DESPATCH_ADVICE_ORDER,
  DESPATCH_LINE_ORDER,
  DESPATCH_ORDER,
  ITEM_ORDER,
  PARTY_ORDER,
  PERSON_ORDER,
  SHIPMENT_ORDER,
  SHIPMENT_STAGE_ORDER,
  SIGNATURE_ORDER,
} from "./despatch-advice.order";
import type { ValidationIssue } from "./despatch-advice.types";
import { childrenNamed, type XmlNode } from "./ubl-xml-reader";

/** Kap adı → çocuk sıra tablosu (aynı tip farklı adla birden çok yerde geçer). */
const ORDER_BY_NAME: Readonly<Record<string, readonly string[]>> = {
  DespatchAdvice: DESPATCH_ADVICE_ORDER,
  "cac:Signature": SIGNATURE_ORDER,
  "cac:Party": PARTY_ORDER,
  "cac:SignatoryParty": PARTY_ORDER,
  "cac:CarrierParty": PARTY_ORDER,
  "cac:PostalAddress": ADDRESS_ORDER,
  "cac:DeliveryAddress": ADDRESS_ORDER,
  "cac:Contact": CONTACT_ORDER,
  "cac:Person": PERSON_ORDER,
  "cac:DriverPerson": PERSON_ORDER,
  "cac:Shipment": SHIPMENT_ORDER,
  "cac:ShipmentStage": SHIPMENT_STAGE_ORDER,
  "cac:Delivery": DELIVERY_ORDER,
  "cac:Despatch": DESPATCH_ORDER,
  "cac:DespatchLine": DESPATCH_LINE_ORDER,
  "cac:Item": ITEM_ORDER,
};

/** Kökte tam bir kez bulunması gereken öğeler. */
const ROOT_EXACTLY_ONE = [
  "cbc:UBLVersionID",
  "cbc:CustomizationID",
  "cbc:ProfileID",
  "cbc:ID",
  "cbc:CopyIndicator",
  "cbc:UUID",
  "cbc:IssueDate",
  "cbc:IssueTime",
  "cbc:DespatchAdviceTypeCode",
  "cbc:LineCountNumeric",
  "cac:DespatchSupplierParty",
  "cac:DeliveryCustomerParty",
  "cac:Shipment",
] as const;

export interface XmlCheckRules {
  namespaces: { root: string; cac: string; cbc: string };
  documentNoRe: RegExp;
  ettnRe: RegExp;
  allowedUnitCodes: ReadonlySet<string>;
}

function checkOrder(node: XmlNode, path: string, errors: ValidationIssue[]): void {
  const order = ORDER_BY_NAME[node.name];
  if (order) {
    let last = -1;
    for (const ch of node.children) {
      const idx = order.indexOf(ch.name);
      if (idx < 0) errors.push({ field: `${path}/${ch.name}`, message: `${node.name} içinde beklenmeyen öğe: ${ch.name}` });
      else if (idx < last) errors.push({ field: `${path}/${ch.name}`, message: `${node.name} içinde öğe sırası bozuk: ${ch.name}` });
      else last = idx;
    }
  }
  for (const ch of node.children) checkOrder(ch, `${path}/${ch.name}`, errors);
}

function checkLines(root: XmlNode, rules: XmlCheckRules, errors: ValidationIssue[]): void {
  const lines = childrenNamed(root, "cac:DespatchLine");
  if (lines.length === 0) errors.push({ field: "cac:DespatchLine", message: "En az bir DespatchLine olmalı" });
  const count = childrenNamed(root, "cbc:LineCountNumeric")[0]?.text;
  if (count !== String(lines.length)) {
    errors.push({ field: "cbc:LineCountNumeric", message: `LineCountNumeric (${count ?? "yok"}) satır sayısıyla (${lines.length}) aynı değil` });
  }
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const id = childrenNamed(line, "cbc:ID")[0]?.text ?? "";
    if (seen.has(id)) errors.push({ field: `cac:DespatchLine[${i}]/cbc:ID`, message: `Satır kimliği tekrar ediyor: ${id}` });
    seen.add(id);
    const qty = childrenNamed(line, "cbc:DeliveredQuantity");
    if (qty.length !== 1) {
      errors.push({ field: `cac:DespatchLine[${i}]/cbc:DeliveredQuantity`, message: "Satırda tek DeliveredQuantity olmalı" });
    } else if (!rules.allowedUnitCodes.has(qty[0]!.attrs.unitCode ?? "")) {
      errors.push({ field: `cac:DespatchLine[${i}]/cbc:DeliveredQuantity`, message: `İzinsiz birim kodu: ${qty[0]!.attrs.unitCode ?? "yok"}` });
    }
  });
}

/** Ağaç üzerinde kural listesi; boş dizi = geçti. */
export function validateXmlTree(root: XmlNode, rules: XmlCheckRules): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  if (root.name !== "DespatchAdvice") {
    return [{ field: "kök", message: `Kök öğe DespatchAdvice olmalı, ${root.name} bulundu` }];
  }
  const ns = rules.namespaces;
  if (root.attrs.xmlns !== ns.root) errors.push({ field: "kök/xmlns", message: "DespatchAdvice ad alanı yanlış" });
  if (root.attrs["xmlns:cac"] !== ns.cac) errors.push({ field: "kök/xmlns:cac", message: "cac ad alanı yanlış" });
  if (root.attrs["xmlns:cbc"] !== ns.cbc) errors.push({ field: "kök/xmlns:cbc", message: "cbc ad alanı yanlış" });
  for (const name of ROOT_EXACTLY_ONE) {
    const n = childrenNamed(root, name).length;
    if (n !== 1) errors.push({ field: name, message: `${name} kökte tam bir kez olmalı (${n} bulundu)` });
  }
  const id = childrenNamed(root, "cbc:ID")[0]?.text ?? "";
  if (!rules.documentNoRe.test(id)) errors.push({ field: "cbc:ID", message: `Belge numarası GİB biçiminde değil: ${id}` });
  const uuid = childrenNamed(root, "cbc:UUID")[0]?.text ?? "";
  if (!rules.ettnRe.test(uuid)) errors.push({ field: "cbc:UUID", message: `ETTN UUID biçiminde değil: ${uuid}` });
  checkLines(root, rules, errors);
  checkOrder(root, "DespatchAdvice", errors);
  return errors;
}
