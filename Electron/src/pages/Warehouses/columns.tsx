import type { ColumnDef } from "@tanstack/react-table";
import { ScrollText, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { Warehouse } from "./types";

/**
 * Kolonlar bir FABRİKA fonksiyonudur çünkü "varsayılan yap" aksiyonu sayfa
 * durumuna (mutation) ihtiyaç duyuyor. Sabit dizi olsaydı aksiyon ya ayrı bir
 * ekrana ya da satır menüsüne taşınırdı — ikisi de tek tıklık bir işi uzatırdı.
 */
export function buildWarehouseColumns(opts: {
  canWrite: boolean;
  onSetDefault: (w: Warehouse) => void;
  isSettingDefault: boolean;
  onShowMovements: (w: Warehouse) => void;
}): ColumnDef<Warehouse>[] {
  return [
    {
      accessorKey: "code",
      header: () => <SortableHeader field="code" label="Kod" />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
    },
    {
      accessorKey: "name",
      header: () => <SortableHeader field="name" label="Depo Adı" />,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span>{row.original.name}</span>
          {row.original.isDefault && (
            // Varsayılan depo bir KURAL taşır: depo söylenmeyen her giriş buraya
            // düşer. Listede görünür olması, "hangi depoya yazılıyor" sorusunun
            // cevabını ekranda tutar.
            <Badge variant="secondary" className="gap-1">
              <Star className="h-3 w-3 fill-current" />
              Varsayılan
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "address",
      header: "Adres",
      cell: ({ row }) =>
        row.original.address ? (
          <span className="text-xs text-muted-foreground">{row.original.address}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "isActive",
      header: () => <SortableHeader field="isActive" label="Durum" />,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "default" : "outline"}>
          {row.original.isActive ? "Aktif" : "Pasif"}
        </Badge>
      ),
    },
    {
      // HAREKETLER — "bu depoya ne girdi / bundan ne çıktı" defterinin kapısı.
      // ⚠️ İzinle SÜZÜLMEZ ve süzülmemeli: bu sayfayı açabilen kişi zaten
      // `warehouse:read` taşıyor ve defter ucunun okuma kümesi onu KAPSIYOR
      // (`warehouse:read | write | transfer`). Ayrıca bir `PermissionGate`
      // koymak, ekranı gören ama düğmeyi göremeyen bir kullanıcı sınıfı
      // uydururdu — iki listenin ayrışması "tıklıyorum, hiçbir şey olmuyor"un
      // en yaygın sebebi (kart ↔ route hizası dersi).
      id: "movements",
      header: "",
      size: 130,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            opts.onShowMovements(row.original);
          }}
        >
          <ScrollText className="mr-1 h-3.5 w-3.5" />
          Hareketler
        </Button>
      ),
    },
    {
      id: "setDefault",
      header: "",
      size: 150,
      cell: ({ row }) => {
        const w = row.original;
        // Pasif depo varsayılan YAPILAMAZ (backend 400) — buton hiç çizilmez;
        // gri buton olmayan bir yolu vaat eder.
        if (!opts.canWrite || w.isDefault || !w.isActive) return null;
        return (
          <Button
            variant="ghost"
            size="sm"
            disabled={opts.isSettingDefault}
            onClick={(e) => {
              e.stopPropagation();
              opts.onSetDefault(w);
            }}
          >
            <Star className="mr-1 h-3.5 w-3.5" />
            Varsayılan yap
          </Button>
        );
      },
    },
  ];
}
