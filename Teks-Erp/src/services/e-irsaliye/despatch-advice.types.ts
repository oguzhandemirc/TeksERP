// =============================================================================
// DespatchInput — plan §2 eşleme tablosunun tipli karşılığı (XML'in TEK girdisi).
// Kaynak eşleme (`despatch-advice.source.ts`) bunu donmuş sevk irsaliyesi
// snapshot'ından kurar; yazıcı (`despatch-advice.builder.ts`) sayı biçimlemez,
// tarih çevirmez — her değer burada BASILACAĞI METİN olarak durur (determinizm).
// =============================================================================

/** UBL `cac:PostalAddress` parçaları. Yalnız il/ilçe/ülke zorunlu. */
export interface PostalAddressInput {
  /** Cadde/sokak ya da cari kartındaki tek satır adres. */
  streetName?: string | null;
  buildingNumber?: string | null;
  /** İlçe → `cbc:CitySubdivisionName`. */
  citySubdivisionName: string;
  /** İl → `cbc:CityName`. */
  cityName: string;
  postalZone?: string | null;
  countryName: string;
}

/** Gerçek kişi adı (TCKN'li taraf ve şoför). */
export interface PersonNameInput {
  firstName: string;
  familyName: string;
}

/** Gönderici ya da alıcı. `taxId` 10 hane = VKN, 11 hane = TCKN. */
export interface PartyInput {
  taxId: string;
  /** Unvan / görünen ad → `cac:PartyName/cbc:Name`. */
  name: string;
  /** TCKN'li tarafta zorunlu → `cac:Person`. */
  person?: PersonNameInput | null;
  /** Vergi dairesi → `cac:PartyTaxScheme/cac:TaxScheme/cbc:Name` (alıcıda kaynak cari kartı). */
  taxOffice?: string | null;
  address: PostalAddressInput;
  mersisNo?: string | null;
  tradeRegistryNo?: string | null;
  telephone?: string | null;
  email?: string | null;
}

/** Şoför → `cac:ShipmentStage/cac:DriverPerson` (TCKN `cbc:NationalityID`). */
export interface DriverInput extends PersonNameInput {
  nationalId: string;
}

/** Taşıyıcı firma → `cac:Delivery/cac:CarrierParty`. */
export interface CarrierInput {
  name: string;
  taxId: string;
}

export interface TransportInput {
  licensePlate?: string | null;
  trailerPlate?: string | null;
  drivers: DriverInput[];
  carrier?: CarrierInput | null;
}

/** Tek ürün satırı. `meters` noktalı ondalık METİN (yuvarlamayı `docNum` yaptı). */
export interface DespatchLineInput {
  itemName: string;
  /** Yalnız "ikisi" ad rejiminde ve ad farklıysa: bizim stok adımız. */
  itemDescription?: string | null;
  meters: string;
  rollCount: number;
}

export interface ShipmentInfoInput {
  /** Sevkiyat no → `cac:Shipment/cbc:ID`. */
  id: string;
  /** Noktalı ondalık METİN; yoksa öğe basılmaz. */
  grossWeightKg?: string | null;
  /** Fiziksel çuval adedi (beyan > sistem sayımı); 0/yok → basılmaz. */
  handlingUnitCount?: number | null;
  /** Fiili sevk anı, fabrika dilimi: `YYYY-MM-DD` / `HH:mm:ss`. */
  actualDespatchDate: string;
  actualDespatchTime: string;
}

export interface DespatchInput {
  /** GİB numarası (seri + yıl + sıra) → `cbc:ID`. */
  documentNo: string;
  /** ETTN → `cbc:UUID`. */
  ettn: string;
  /** Düzenleme anı, fabrika dilimi: `YYYY-MM-DD` / `HH:mm:ss`. */
  issueDate: string;
  issueTime: string;
  /** Sevkiyatın yönü — XML'e basılmaz; v1 yalnız yurt içini kabul eder. */
  destination: "DOMESTIC" | "EXPORT";
  notes: string[];
  supplier: PartyInput;
  customer: PartyInput;
  /** Teslim adresi; verilmezse alıcının adresi basılır. */
  deliveryAddress?: PostalAddressInput | null;
  shipment: ShipmentInfoInput;
  transport: TransportInput;
  lines: DespatchLineInput[];
}

/** Doğrulayıcı çıktısı — `field` UBL değil girdi yoludur, `message` Türkçe. */
export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}
