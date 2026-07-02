import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { testPeripheral } from "./service";
import {
  connectionTypeLabels,
  peripheralKindLabels,
  type PeripheralDevice,
} from "./types";

/** Bağlantı testi — NETWORK_TCP backend'e (gerçek/simüle); SERIAL/USB Electron
 *  host'una (window.api.printer, serialport); Bluetooth tablette (mobil). */
function TestCell({ device }: { device: PeripheralDevice }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      if (device.connectionType === "NETWORK_TCP") {
        const { data } = await testPeripheral(device.id);
        if (data.error) toast.error(data.error);
        else toast.success(data.note ?? (data.simulated ? `Simüle (${data.target ?? "?"})` : `Gönderildi (${data.target ?? "?"})`));
      } else if (device.connectionType === "SERIAL_COM" || device.connectionType === "USB") {
        const bridge = window.api?.printer;
        if (!bridge) return toast.info("Bu derlemede seri/USB testi yok");
        if (!device.address) return toast.error("Adres (COM) tanımsız");
        const res = await bridge.send({ transport: "serial", target: device.address, content: "\r" });
        if (!res.available) toast.error("serialport yüklü değil (electron:rebuild gerekli)");
        else if (res.ok) toast.success("Seri bağlantı OK");
        else toast.error(res.error ?? "Başarısız");
      } else {
        toast.info("Bluetooth testi tablette (mobil) yapılır");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={run}>
      Test
    </Button>
  );
}

const mono = (v: string | null | undefined) =>
  v ? <span className="font-mono text-xs">{v}</span> : <span className="text-muted-foreground">—</span>;

export const peripheralColumns: ColumnDef<PeripheralDevice>[] = [
  {
    id: "name",
    header: "Ad",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate">{row.original.name}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{row.original.code}</div>
      </div>
    ),
  },
  {
    id: "kind",
    header: "Tür",
    cell: ({ row }) => (
      <div className="min-w-0">
        <Badge variant="muted">{peripheralKindLabels[row.original.kind]}</Badge>
        {row.original.role ? (
          <div className="mt-0.5 text-[10px] text-muted-foreground">{row.original.role}</div>
        ) : null}
      </div>
    ),
  },
  {
    id: "connection",
    header: "Bağlantı",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="text-xs">{connectionTypeLabels[row.original.connectionType]}</div>
        {mono(row.original.address)}
      </div>
    ),
  },
  {
    id: "owner",
    header: "Sahip",
    cell: ({ row }) =>
      row.original.machine ? (
        <span className="text-xs">{row.original.machine.code} (makine)</span>
      ) : row.original.station ? (
        <span className="text-xs">{row.original.station.code} (istasyon)</span>
      ) : row.original.device ? (
        <span className="text-xs">{row.original.device.name} (tablet — eski)</span>
      ) : (
        <span className="text-muted-foreground">— (serbest)</span>
      ),
  },
  {
    id: "lang",
    header: "Dil / Profil",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="text-xs">
          {row.original.languageOverride ?? "genel"}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {row.original.formatProfile?.code ?? "sistem varsayılanı"}
        </div>
      </div>
    ),
  },
  {
    id: "routes",
    header: "Şablon",
    cell: ({ row }) => {
      const n = row.original.templateRoutes?.length ?? 0;
      return n > 0 ? (
        <Badge>{n} yönlendirme</Badge>
      ) : (
        <span className="text-muted-foreground text-xs">varsayılan</span>
      );
    },
  },
  {
    accessorKey: "isActive",
    header: "Durum",
    cell: ({ row }) =>
      row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>,
  },
  {
    id: "test",
    header: "",
    cell: ({ row }) => <TestCell device={row.original} />,
  },
];
