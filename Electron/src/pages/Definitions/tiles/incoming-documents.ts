// Tanımlar › Gelen Belge Kurulumu karoları — belge tipi öğretme/düzenleme ve müşteri varsayılanı (T5: Depo'dan taşındı).
// Ekran adresleri `/operations/gelen-belgeler/...` olarak kalır; görünürlük Gelen Belgeler karosuyla AYNI yüklem.
import { FileCog, PackageCheck, ScanLine } from "lucide-react";
import { isIncomingDocumentVisible } from "@/pages/Operations/GelenBelgeler/gelenBelge-regime";
import { CUSTOMER_DEFAULTS_PATH, TEACH_START_PATH } from "@/pages/Operations/GelenBelgeler/paths";
import type { DefinitionTile } from "../tile-config";

export const incomingDocumentTiles: DefinitionTile[] = [
  {
    // E2 + belge tanıt 3 aşama: tanıtılan belge tipleri (düzenle/sıfırla) + gönderen cari bağı. Modül kapalıyken GİZLİ (Gelen Belgeler karosu gibi).
    key: "gelen-belge-sablonlari",
    title: "Belge Tipleri",
    description: "Tanıtılan belge tiplerini düzenle ya da sıfırla; gönderen cariye ve varsayılan sahibe bağla, parti no alanını seç",
    icon: FileCog,
    to: "/operations/gelen-belgeler/sablonlar",
    group: "incoming",
    permission: "gelen-belge:template",
    visibleWhen: isIncomingDocumentVisible,
  },
  {
    // K30-T: yeni belge tipini öğretme girişi (yükle → okununca adım adım tanıt). Şablon izni + aynı modül kapısı.
    key: "gelen-belge-tanit",
    title: "Belge Tanıt",
    description: "Yeni belge tipini öğret — fotoğrafı yükle, başlığa ve değerlere sırayla dokun",
    icon: ScanLine,
    to: TEACH_START_PATH,
    group: "incoming",
    permission: "gelen-belge:template",
    visibleWhen: isIncomingDocumentVisible,
  },
  {
    // E4b: sahibe özel varsayılan ürün (ürünsüz satır onayda bununla girer; fabrika ayarını ezer). Aynı kapı.
    key: "gelen-belge-varsayilan-urunler",
    title: "Müşteri Varsayılan Ürünleri",
    description: "Gelen belgede ürünü seçilmemiş satırın müşteriye göre gireceği kumaş",
    icon: PackageCheck,
    to: CUSTOMER_DEFAULTS_PATH,
    group: "incoming",
    permission: "gelen-belge:template",
    visibleWhen: isIncomingDocumentVisible,
  },
];
