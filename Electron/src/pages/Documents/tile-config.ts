// Belgeler kökü karoları — UX-2 K2: Tanımlar › Çıktılar grubundan taşındı; ADRESLER `/definitions/...` olarak KALIR
// (derin bağlantı/e2e güzergâhı kırılmaz), yalnız giriş yüzeyi ve breadcrumb ebeveyni "Belgeler" olur. Sıra = hub sırası.
import { Tags, FileText, Printer, LayoutTemplate, PenTool } from "lucide-react";
import { DOCUMENT_DESIGN_READ } from "@/lib/permissions";
import { isTravelerCardVisible } from "@/pages/Definitions/production-regime";
import type { DefinitionTile } from "@/pages/Definitions/tile-config";
import { flagOffHint } from "@/lib/flag-setting-path";

/** Belgeler karosu: Tanımlar karosuyla aynı biçim, grup alanı yok (tek bölüm). */
export type DocumentTile = Omit<DefinitionTile, "group">;

export const documentTiles: DocumentTile[] = [
  {
    key: "labels",
    title: "Etiketler",
    description: "Etiket boyutları (mm) + düzenleri (alan yerleşimi / uzman yazıcı kodu).",
    icon: Tags,
    to: "/definitions/labels",
    // ⚠️ İZİN HİZASI (2026-08-14, persona denetimi bulgusu): kart yalnız
    // `station:read` isterken etiket şablonu tanımlamak isteyen ticaret
    // kullanıcısı (label:read/print + label-template:read taşır ama İSTASYON
    // kavramıyla hiç işi yok) kartı GÖREMİYORDU. Rol şablonu kataloğunda
    // "bilinen hizasızlık" diye yazılıydı. Route ile AYNI liste.
    permissionAny: ["station:read", "label-template:read"],
  },
  {
    // UX-2: bağımsız etiket tasarım ekranı menüsüzdü (UX-1 tek KIRMIZI); içerik Etiketler › Düzenler sekmesiyle aynı.
    key: "label-templates",
    title: "Etiket Tasarımı",
    description: "Etiket düzeni havuzu — alan yerleşimi ve uzman yazıcı kodu (tam ekran)",
    icon: LayoutTemplate,
    to: "/definitions/label-templates",
    permission: "label-template:read",
  },
  {
    key: "document-templates",
    title: "Belge Şablonları",
    description: "İrsaliye/çeki içeriği: bölüm aç-kapa, başlık, künye, imza, alt not (canlı önizleme)",
    icon: FileText,
    to: "/definitions/document-templates",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
  {
    key: "traveler-card",
    title: "Refakat Kartı",
    description: "Refakat kartında basılan firma adı/künyesi ve görünecek bölümler",
    icon: Printer,
    to: "/definitions/traveler-card",
    permissionAny: DOCUMENT_DESIGN_READ,
    // ⚠️ KARTIN AYARI üretim nesnesidir (manifestoda `productionEnabled`);
    // hemen altındaki "Refakat Kartı Şablonları" ise BELGE nesnesidir ve
    // koşulsuz kalır. İkisini aynı kefeye koymak, üretim kapalı bir kurulumda
    // belge tasarımcısını da kilitlerdi.
    visibleWhen: isTravelerCardVisible,
    offHint: flagOffHint("productionEnabled"),
  },
  {
    key: "traveler-card-studio",
    title: "Refakat Kartı Şablonları",
    description: "Bölümleri sırala/aç-kapa ya da uzman modunda kartın tüm HTML'ini kendin yaz",
    icon: LayoutTemplate,
    to: "/definitions/traveler-card-studio",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
  {
    key: "free-documents",
    title: "Serbest Belgeler",
    description: "Sisteme bağlı olmayan serbest belgeler — üst yazı, tutanak, dekont, duyuru",
    icon: FileText,
    to: "/definitions/free-documents",
    permissionAny: DOCUMENT_DESIGN_READ,
  },
  {
    // Plan P-c: karo HER ZAMAN görünür (visibleWhen YOK); bayrak kapalıyken sayfa
    // "kapalı — Genel Ayarlar'dan açılır" der (çıkışlı kapı).
    key: "document-designer", title: "Belge Tasarımcısı", icon: PenTool, to: "/definitions/document-designer",
    description: "Belgeyi sürükle-bırak bloklar ve stil paneliyle sayfa üzerinde tasarla", permissionAny: DOCUMENT_DESIGN_READ,
  },
];
