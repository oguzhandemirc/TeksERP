// =============================================================================
// buildDespatchAdvice — DespatchInput → UBL-TR e-İrsaliye XML'i. TEK üretici.
// Saf ve deterministik: aynı girdi = aynı bayt. Sayı biçimlemez, tarih çevirmez
// (girdi zaten basılacak metindir); öğe sırası `despatch-advice.order.ts` tablosundan.
// Doğrulama çağıranın işidir: önce `validateDespatchInput`, sonra bu fonksiyon.
// =============================================================================
import {
  COPY_INDICATOR,
  CUSTOMIZATION_ID,
  DESPATCH_ADVICE_TYPE_CODE,
  PROFILE_ID,
  SCHEME_IDS,
  UBL_NAMESPACES,
  UBL_VERSION_ID,
  UNIT_CODES,
} from "../../constants/e-irsaliye";
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
import type {
  CarrierInput,
  DespatchInput,
  DespatchLineInput,
  DriverInput,
  PartyInput,
  PostalAddressInput,
} from "./despatch-advice.types";
import { taxIdKind } from "./tax-id";
import { el, leaf, optLeaf, ordered, serializeXml, type XmlElement } from "./ubl-xml-writer";

/** 10 hane VKN, 11 hane TCKN — doğrulayıcı başka uzunluğu zaten reddeder. */
function taxScheme(taxId: string): string {
  return taxIdKind(taxId) === "TCKN" ? SCHEME_IDS.tckn : SCHEME_IDS.vkn;
}

function partyId(id: string, scheme: string): XmlElement {
  return el("cac:PartyIdentification", [leaf("cbc:ID", id, [["schemeID", scheme]])]);
}

function postalAddress(name: string, a: PostalAddressInput): XmlElement {
  return ordered(name, ADDRESS_ORDER, {
    "cbc:StreetName": optLeaf("cbc:StreetName", a.streetName),
    "cbc:BuildingNumber": optLeaf("cbc:BuildingNumber", a.buildingNumber),
    "cbc:CitySubdivisionName": leaf("cbc:CitySubdivisionName", a.citySubdivisionName),
    "cbc:CityName": leaf("cbc:CityName", a.cityName),
    "cbc:PostalZone": optLeaf("cbc:PostalZone", a.postalZone),
    "cac:Country": el("cac:Country", [leaf("cbc:Name", a.countryName)]),
  });
}

function party(p: PartyInput): XmlElement {
  const ids = [
    partyId(p.taxId, taxScheme(p.taxId)),
    p.mersisNo?.trim() ? partyId(p.mersisNo.trim(), SCHEME_IDS.mersis) : null,
    p.tradeRegistryNo?.trim() ? partyId(p.tradeRegistryNo.trim(), SCHEME_IDS.tradeRegistry) : null,
  ];
  const tel = optLeaf("cbc:Telephone", p.telephone);
  const mail = optLeaf("cbc:ElectronicMail", p.email);
  return ordered("cac:Party", PARTY_ORDER, {
    "cac:PartyIdentification": ids,
    "cac:PartyName": el("cac:PartyName", [leaf("cbc:Name", p.name)]),
    "cac:PostalAddress": postalAddress("cac:PostalAddress", p.address),
    "cac:PartyTaxScheme": p.taxOffice?.trim()
      ? el("cac:PartyTaxScheme", [el("cac:TaxScheme", [leaf("cbc:Name", p.taxOffice.trim())])])
      : null,
    "cac:Contact": tel || mail ? ordered("cac:Contact", CONTACT_ORDER, { "cbc:Telephone": tel, "cbc:ElectronicMail": mail }) : null,
    "cac:Person": p.person
      ? ordered("cac:Person", PERSON_ORDER, {
          "cbc:FirstName": leaf("cbc:FirstName", p.person.firstName),
          "cbc:FamilyName": leaf("cbc:FamilyName", p.person.familyName),
        })
      : null,
  });
}

/** ⚠ imzasız belgede yer tutucu (constants/e-irsaliye.ts madde 3). */
function signature(input: DespatchInput): XmlElement {
  const s = input.supplier;
  return ordered("cac:Signature", SIGNATURE_ORDER, {
    "cbc:ID": leaf("cbc:ID", s.taxId, [["schemeID", SCHEME_IDS.signer]]),
    "cac:SignatoryParty": ordered("cac:SignatoryParty", PARTY_ORDER, {
      "cac:PartyIdentification": partyId(s.taxId, taxScheme(s.taxId)),
      "cac:PostalAddress": postalAddress("cac:PostalAddress", s.address),
    }),
    "cac:DigitalSignatureAttachment": el("cac:DigitalSignatureAttachment", [
      el("cac:ExternalReference", [leaf("cbc:URI", `#Signature_${input.documentNo}`)]),
    ]),
  });
}

function driver(d: DriverInput): XmlElement {
  return ordered("cac:DriverPerson", PERSON_ORDER, {
    "cbc:FirstName": leaf("cbc:FirstName", d.firstName),
    "cbc:FamilyName": leaf("cbc:FamilyName", d.familyName),
    "cbc:Title": leaf("cbc:Title", "Şoför"),
    "cbc:NationalityID": leaf("cbc:NationalityID", d.nationalId),
  });
}

function carrierParty(c: CarrierInput): XmlElement {
  return ordered("cac:CarrierParty", PARTY_ORDER, {
    "cac:PartyIdentification": partyId(c.taxId, taxScheme(c.taxId)),
    "cac:PartyName": el("cac:PartyName", [leaf("cbc:Name", c.name)]),
  });
}

function shipment(input: DespatchInput): XmlElement {
  const s = input.shipment;
  const t = input.transport;
  const plate = t.licensePlate?.trim();
  const means = plate
    ? el("cac:TransportMeans", [el("cac:RoadTransport", [leaf("cbc:LicensePlateID", plate, [["schemeID", SCHEME_IDS.plate]])])])
    : null;
  const drivers = t.drivers.map(driver);
  const trailer = t.trailerPlate?.trim();
  return ordered("cac:Shipment", SHIPMENT_ORDER, {
    "cbc:ID": leaf("cbc:ID", s.id),
    "cbc:GrossWeightMeasure": optLeaf("cbc:GrossWeightMeasure", s.grossWeightKg, [["unitCode", UNIT_CODES.kilogram]]),
    "cbc:TotalTransportHandlingUnitQuantity":
      s.handlingUnitCount && s.handlingUnitCount > 0
        ? leaf("cbc:TotalTransportHandlingUnitQuantity", String(s.handlingUnitCount))
        : null,
    "cac:ShipmentStage":
      means || drivers.length > 0
        ? ordered("cac:ShipmentStage", SHIPMENT_STAGE_ORDER, { "cac:TransportMeans": means, "cac:DriverPerson": drivers })
        : null,
    "cac:Delivery": ordered("cac:Delivery", DELIVERY_ORDER, {
      "cac:DeliveryAddress": postalAddress("cac:DeliveryAddress", input.deliveryAddress ?? input.customer.address),
      "cac:CarrierParty": t.carrier ? carrierParty(t.carrier) : null,
      "cac:Despatch": ordered("cac:Despatch", DESPATCH_ORDER, {
        "cbc:ActualDespatchDate": leaf("cbc:ActualDespatchDate", s.actualDespatchDate),
        "cbc:ActualDespatchTime": leaf("cbc:ActualDespatchTime", s.actualDespatchTime),
      }),
    }),
    "cac:TransportHandlingUnit": trailer
      ? el("cac:TransportHandlingUnit", [
          el("cac:TransportEquipment", [leaf("cbc:ID", trailer, [["schemeID", SCHEME_IDS.trailerPlate]])]),
        ])
      : null,
  });
}

function despatchLine(line: DespatchLineInput, index: number): XmlElement {
  const lineNo = String(index + 1);
  return ordered("cac:DespatchLine", DESPATCH_LINE_ORDER, {
    "cbc:ID": leaf("cbc:ID", lineNo),
    "cbc:Note": leaf("cbc:Note", `${line.rollCount} top`),
    "cbc:DeliveredQuantity": leaf("cbc:DeliveredQuantity", line.meters, [["unitCode", UNIT_CODES.meter]]),
    // ⚠ UBL 2.1'de zorunlu; sipariş satırı karşılığı yok → satır sırası (constants madde 7).
    "cac:OrderLineReference": el("cac:OrderLineReference", [leaf("cbc:LineID", lineNo)]),
    "cac:Item": ordered("cac:Item", ITEM_ORDER, {
      "cbc:Description": optLeaf("cbc:Description", line.itemDescription),
      "cbc:Name": leaf("cbc:Name", line.itemName),
    }),
  });
}

/** e-İrsaliye XML'i. Girdi `validateDespatchInput` ile doğrulanmış olmalı. */
export function buildDespatchAdvice(input: DespatchInput): string {
  const root = ordered(
    "DespatchAdvice",
    DESPATCH_ADVICE_ORDER,
    {
      "cbc:UBLVersionID": leaf("cbc:UBLVersionID", UBL_VERSION_ID),
      "cbc:CustomizationID": leaf("cbc:CustomizationID", CUSTOMIZATION_ID),
      "cbc:ProfileID": leaf("cbc:ProfileID", PROFILE_ID),
      "cbc:ID": leaf("cbc:ID", input.documentNo),
      "cbc:CopyIndicator": leaf("cbc:CopyIndicator", COPY_INDICATOR),
      "cbc:UUID": leaf("cbc:UUID", input.ettn),
      "cbc:IssueDate": leaf("cbc:IssueDate", input.issueDate),
      "cbc:IssueTime": leaf("cbc:IssueTime", input.issueTime),
      "cbc:DespatchAdviceTypeCode": leaf("cbc:DespatchAdviceTypeCode", DESPATCH_ADVICE_TYPE_CODE),
      "cbc:Note": input.notes.map((n) => optLeaf("cbc:Note", n)),
      "cbc:LineCountNumeric": leaf("cbc:LineCountNumeric", String(input.lines.length)),
      "cac:Signature": signature(input),
      "cac:DespatchSupplierParty": el("cac:DespatchSupplierParty", [party(input.supplier)]),
      "cac:DeliveryCustomerParty": el("cac:DeliveryCustomerParty", [party(input.customer)]),
      "cac:Shipment": shipment(input),
      "cac:DespatchLine": input.lines.map(despatchLine),
    },
    [
      ["xmlns", UBL_NAMESPACES.root],
      ["xmlns:cac", UBL_NAMESPACES.cac],
      ["xmlns:cbc", UBL_NAMESPACES.cbc],
      ["xmlns:ext", UBL_NAMESPACES.ext],
    ],
  );
  return serializeXml(root);
}
