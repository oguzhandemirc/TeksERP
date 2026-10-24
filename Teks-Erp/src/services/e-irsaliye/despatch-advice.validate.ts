// =============================================================================
// e-İrsaliye YAPISAL DOĞRULAMA — iki kapı:
//   validateDespatchInput  XML'den ÖNCE, girdi alan alan (Türkçe, düzeltilebilir mesaj)
//   validateDespatchXml    üretilen metin: iyi biçim, kök, sıra, satır sayısı, tekillik
// XSD doğrulaması değildir (plan §7 V3 kullanıcı kararı: XSD paketi yok).
// =============================================================================
import {
  ALLOWED_UNIT_CODES,
  DOCUMENT_NO_RE,
  ETTN_RE,
  PLATE_RE,
  TEXT_LIMITS,
  UBL_NAMESPACES,
} from "../../constants/e-irsaliye";
import { validateXmlTree } from "./despatch-advice.xml-check";
import type { DespatchInput, PartyInput, PostalAddressInput, ValidationIssue, ValidationResult } from "./despatch-advice.types";
import { isValidTckn, isValidVkn, taxIdKind } from "./tax-id";
import { hasInvalidXmlChar } from "./ubl-xml-writer";
import { parseXml } from "./ubl-xml-reader";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const DECIMAL_RE = /^\d+(\.\d+)?$/;

const blank = (v: string | null | undefined): boolean => !v || v.trim() === "";

function isRealDate(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Hata toplayıcı — alan yolu + Türkçe mesaj. */
class Issues {
  readonly errors: ValidationIssue[] = [];
  add(field: string, message: string): void {
    this.errors.push({ field, message });
  }
  /** Zorunlu metin + uzunluk. */
  need(field: string, value: string | null | undefined, label: string, max: number): void {
    if (blank(value)) this.add(field, `${label} boş olamaz`);
    else if (value!.length > max) this.add(field, `${label} en fazla ${max} karakter olabilir`);
  }
  opt(field: string, value: string | null | undefined, label: string, max: number): void {
    if (value && value.length > max) this.add(field, `${label} en fazla ${max} karakter olabilir`);
  }
}
type Push = Issues;

/** VKN/TCKN — tür + sağlama. `who` kullanıcıya görünen taraf adı. */
function checkTaxId(push: Push, field: string, value: string | null | undefined, who: string): void {
  if (blank(value)) return push.add(field, `${who} vergi numarası (VKN/TCKN) boş`);
  const kind = taxIdKind(value!);
  if (kind === null) return push.add(field, `${who} vergi numarası 10 hane (VKN) ya da 11 hane (TCKN) olmalı`);
  if (kind === "VKN" && !isValidVkn(value!)) push.add(field, `${who} VKN'si geçersiz (sağlama hanesi tutmuyor)`);
  if (kind === "TCKN" && !isValidTckn(value!)) push.add(field, `${who} TCKN'si geçersiz (sağlama hanesi tutmuyor)`);
}

function checkAddress(push: Push, field: string, a: PostalAddressInput | null | undefined, who: string): void {
  if (!a) return push.add(field, `${who} adresi yok`);
  const L = TEXT_LIMITS.addressPart;
  push.need(`${field}.cityName`, a.cityName, `${who} ili`, L);
  push.need(`${field}.citySubdivisionName`, a.citySubdivisionName, `${who} ilçesi`, L);
  push.need(`${field}.countryName`, a.countryName, `${who} ülkesi`, L);
  push.opt(`${field}.streetName`, a.streetName, `${who} adres satırı`, L);
  push.opt(`${field}.buildingNumber`, a.buildingNumber, `${who} bina no`, TEXT_LIMITS.shortCode);
  push.opt(`${field}.postalZone`, a.postalZone, `${who} posta kodu`, TEXT_LIMITS.shortCode);
}

function checkParty(push: Push, field: string, p: PartyInput | null | undefined, who: string): void {
  if (!p) return push.add(field, `${who} bilgisi yok`);
  checkTaxId(push, `${field}.taxId`, p.taxId, who);
  push.need(`${field}.name`, p.name, `${who} unvanı`, TEXT_LIMITS.name);
  if (!blank(p.taxId) && taxIdKind(p.taxId) === "TCKN") {
    push.need(`${field}.person.firstName`, p.person?.firstName, `${who} (TCKN'li) kişi adı`, TEXT_LIMITS.name);
    push.need(`${field}.person.familyName`, p.person?.familyName, `${who} (TCKN'li) kişi soyadı`, TEXT_LIMITS.name);
  }
  push.opt(`${field}.taxOffice`, p.taxOffice, `${who} vergi dairesi`, TEXT_LIMITS.name);
  for (const k of ["mersisNo", "tradeRegistryNo", "telephone"] as const) {
    push.opt(`${field}.${k}`, p[k], `${who} iletişim/sicil alanı`, TEXT_LIMITS.shortCode);
  }
  push.opt(`${field}.email`, p.email, `${who} e-postası`, TEXT_LIMITS.name);
  checkAddress(push, `${field}.address`, p.address, who);
}

function checkTransport(push: Push, input: DespatchInput): void {
  const t = input.transport;
  for (const [k, label] of [["licensePlate", "Araç plakası"], ["trailerPlate", "Dorse plakası"]] as const) {
    const v = t[k];
    if (!blank(v) && !PLATE_RE.test(v!)) push.add(`transport.${k}`, `${label} boşluksuz büyük harf ve rakamdan oluşmalı (ör. 34ABC123)`);
  }
  t.drivers.forEach((d, i) => {
    push.need(`transport.drivers[${i}].firstName`, d.firstName, "Şoför adı", TEXT_LIMITS.name);
    push.need(`transport.drivers[${i}].familyName`, d.familyName, "Şoför soyadı", TEXT_LIMITS.name);
    if (!isValidTckn(d.nationalId ?? "")) push.add(`transport.drivers[${i}].nationalId`, "Şoför TCKN'si geçersiz");
  });
  if (t.carrier) {
    push.need("transport.carrier.name", t.carrier.name, "Taşıyıcı unvanı", TEXT_LIMITS.name);
    checkTaxId(push, "transport.carrier.taxId", t.carrier.taxId, "Taşıyıcının");
  }
  // ⚠ doğrulanacak kural (constants madde 6): plaka + şoför YA DA taşıyıcı firma.
  const ownVehicle = !blank(t.licensePlate) && t.drivers.length > 0;
  if (!ownVehicle && !t.carrier) {
    push.add("transport", "Taşıma bilgisi eksik: araç plakası ve şoför ya da taşıyıcı firma (unvan + VKN) girilmeli");
  }
}

function checkLines(push: Push, input: DespatchInput): void {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return push.add("lines", "İrsaliyede en az bir ürün satırı olmalı");
  }
  input.lines.forEach((l, i) => {
    const f = `lines[${i}]`;
    const no = `Satır ${i + 1}`;
    push.need(`${f}.itemName`, l.itemName, `${no}: ürün adı`, TEXT_LIMITS.name);
    push.opt(`${f}.itemDescription`, l.itemDescription, `${no}: stok adı`, TEXT_LIMITS.name);
    if (!DECIMAL_RE.test(l.meters ?? "") || !(Number(l.meters) > 0)) {
      push.add(`${f}.meters`, `${no}: metre sıfırdan büyük olmalı`);
    }
    if (!Number.isInteger(l.rollCount) || l.rollCount < 0) push.add(`${f}.rollCount`, `${no}: top adedi geçersiz`);
  });
}

function checkHeader(push: Push, input: DespatchInput): void {
  if (!DOCUMENT_NO_RE.test(input.documentNo ?? "")) {
    push.add("documentNo", "Belge numarası GİB biçiminde olmalı: 3 karakter seri + 4 hane yıl + 9 hane sıra");
  }
  if (!ETTN_RE.test(input.ettn ?? "")) push.add("ettn", "ETTN geçerli bir UUID olmalı");
  if (!isRealDate(input.issueDate ?? "")) push.add("issueDate", "Düzenleme tarihi YYYY-AA-GG biçiminde olmalı");
  if (!TIME_RE.test(input.issueTime ?? "")) push.add("issueTime", "Düzenleme saati SS:DD:ss biçiminde olmalı");
  if (DOCUMENT_NO_RE.test(input.documentNo ?? "") && isRealDate(input.issueDate ?? "")) {
    if (input.documentNo.slice(3, 7) !== input.issueDate.slice(0, 4)) {
      push.add("documentNo", "Belge numarasındaki yıl düzenleme tarihinin yılıyla aynı olmalı");
    }
  }
  if (input.destination !== "DOMESTIC") push.add("destination", "Yurt dışı sevkiyat için e-İrsaliye bu sürümde desteklenmiyor");
  input.notes.forEach((n, i) => push.opt(`notes[${i}]`, n, "Not", TEXT_LIMITS.note));
  const s = input.shipment;
  push.need("shipment.id", s.id, "Sevkiyat numarası", TEXT_LIMITS.shortCode);
  if (s.grossWeightKg != null && !DECIMAL_RE.test(s.grossWeightKg)) push.add("shipment.grossWeightKg", "Brüt ağırlık geçersiz");
  if (s.handlingUnitCount != null && (!Number.isInteger(s.handlingUnitCount) || s.handlingUnitCount < 0)) {
    push.add("shipment.handlingUnitCount", "Çuval adedi geçersiz");
  }
  if (!isRealDate(s.actualDespatchDate ?? "")) push.add("shipment.actualDespatchDate", "Sevk tarihi YYYY-AA-GG biçiminde olmalı");
  if (!TIME_RE.test(s.actualDespatchTime ?? "")) push.add("shipment.actualDespatchTime", "Sevk saati SS:DD:ss biçiminde olmalı");
}

/** Her metin yaprağında XML 1.0'da yazılamayan karakter ara (yazıcı aksi halde hata atar). */
function checkChars(push: Push, value: unknown, path: string): void {
  if (typeof value === "string") {
    if (hasInvalidXmlChar(value)) push.add(path, "Metinde yazdırılamayan kontrol karakteri var — alanı yeniden yazın");
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkChars(push, v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) checkChars(push, v, path ? `${path}.${k}` : k);
  }
}

/** XML üretilmeden önce: alan alan Türkçe hata listesi; `ok=false` iken XML ÜRETİLMEZ. */
export function validateDespatchInput(input: DespatchInput): ValidationResult {
  const push = new Issues();
  checkHeader(push, input);
  checkParty(push, "supplier", input.supplier, "Göndericinin");
  checkParty(push, "customer", input.customer, "Alıcının");
  if (input.deliveryAddress) checkAddress(push, "deliveryAddress", input.deliveryAddress, "Teslim adresinin");
  checkTransport(push, input);
  checkLines(push, input);
  checkChars(push, input, "");
  return { ok: push.errors.length === 0, errors: push.errors };
}

/** Üretilmiş XML'in hafif yapısal denetimi (iyi biçim + kök + sıra + sayım + tekillik). */
export function validateDespatchXml(xml: string): ValidationResult {
  let root;
  try {
    root = parseXml(xml);
  } catch (e) {
    return { ok: false, errors: [{ field: "xml", message: `XML iyi biçimli değil: ${(e as Error).message}` }] };
  }
  const errors = validateXmlTree(root, {
    namespaces: UBL_NAMESPACES,
    documentNoRe: DOCUMENT_NO_RE,
    ettnRe: ETTN_RE,
    allowedUnitCodes: ALLOWED_UNIT_CODES,
  });
  return { ok: errors.length === 0, errors };
}
