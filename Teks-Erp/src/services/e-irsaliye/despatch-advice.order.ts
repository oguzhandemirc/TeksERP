// =============================================================================
// UBL 2.1 ÖĞE SIRASI TABLOLARI — yazıcı (`ordered`) ve XML doğrulayıcısı buradan okur.
// UBL şeması xsd:sequence'tır: sıra yanlışsa XSD belgeyi reddeder.
// KAYNAK: OASIS UBL 2.1 (UBL-DespatchAdvice-2.1.xsd + UBL-CommonAggregateComponents-2.1.xsd)
// ezberden; yalnız KULLANDIĞIMIZ öğeler, şemadaki göreli sıralarıyla.
// ⚠ doğrulanacak: GİB UBL-TR 1.2 XSD paketiyle (plan §7 V3) — onay gelene dek elle teyit yok.
// =============================================================================

export const DESPATCH_ADVICE_ORDER = [
  "ext:UBLExtensions",
  "cbc:UBLVersionID",
  "cbc:CustomizationID",
  "cbc:ProfileID",
  "cbc:ID",
  "cbc:CopyIndicator",
  "cbc:UUID",
  "cbc:IssueDate",
  "cbc:IssueTime",
  "cbc:DespatchAdviceTypeCode",
  "cbc:Note",
  "cbc:LineCountNumeric",
  "cac:OrderReference",
  "cac:AdditionalDocumentReference",
  "cac:Signature",
  "cac:DespatchSupplierParty",
  "cac:DeliveryCustomerParty",
  "cac:Shipment",
  "cac:DespatchLine",
] as const;

export const SIGNATURE_ORDER = ["cbc:ID", "cac:SignatoryParty", "cac:DigitalSignatureAttachment"] as const;

export const PARTY_ORDER = [
  "cac:PartyIdentification",
  "cac:PartyName",
  "cac:PostalAddress",
  "cac:PartyTaxScheme",
  "cac:Contact",
  "cac:Person",
] as const;

export const ADDRESS_ORDER = [
  "cbc:StreetName",
  "cbc:BuildingNumber",
  "cbc:CitySubdivisionName",
  "cbc:CityName",
  "cbc:PostalZone",
  "cac:Country",
] as const;

export const CONTACT_ORDER = ["cbc:Telephone", "cbc:ElectronicMail"] as const;

export const PERSON_ORDER = ["cbc:FirstName", "cbc:FamilyName", "cbc:Title", "cbc:NationalityID"] as const;

export const SHIPMENT_ORDER = [
  "cbc:ID",
  "cbc:GrossWeightMeasure",
  "cbc:TotalTransportHandlingUnitQuantity",
  "cac:ShipmentStage",
  "cac:Delivery",
  "cac:TransportHandlingUnit",
] as const;

export const SHIPMENT_STAGE_ORDER = ["cac:TransportMeans", "cac:DriverPerson"] as const;

export const DELIVERY_ORDER = ["cac:DeliveryAddress", "cac:CarrierParty", "cac:Despatch"] as const;

export const DESPATCH_ORDER = ["cbc:ActualDespatchDate", "cbc:ActualDespatchTime"] as const;

export const DESPATCH_LINE_ORDER = [
  "cbc:ID",
  "cbc:Note",
  "cbc:DeliveredQuantity",
  "cac:OrderLineReference",
  "cac:Item",
] as const;

export const ITEM_ORDER = ["cbc:Description", "cbc:Name"] as const;
