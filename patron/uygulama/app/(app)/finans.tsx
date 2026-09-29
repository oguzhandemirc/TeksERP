// Finans: yalnız izinli sekmeler görünür (bakiye özeti · kasa/banka · çek · fatura · tahsilat).
import { useRouter } from "expo-router";
import { useState } from "react";
import { can } from "../../src/lib/access";
import { useSession } from "../../src/state/session";
import { ProjectionList } from "../../src/ui/data";
import { Screen } from "../../src/ui/Frame";
import { Muted, Tabs } from "../../src/ui/kit";
import { SnapshotCard } from "../../src/ui/SnapshotCard";
import { openRecord } from "../../src/ui/nav";

type Tab = "ozet" | "kasa" | "cek" | "fatura" | "tahsilat";
const TABS: readonly { key: Tab; label: string; perm: string }[] = [
  { key: "ozet", label: "Özet", perm: "bulut:cari-bakiye:oku" },
  { key: "kasa", label: "Kasa/Banka", perm: "bulut:kasa:oku" },
  { key: "cek", label: "Çek/Senet", perm: "bulut:cek:oku" },
  { key: "fatura", label: "Fatura", perm: "bulut:fatura:oku" },
  { key: "tahsilat", label: "Tahsilat", perm: "bulut:tahsilat:oku" },
];

export default function Finance() {
  const { permissions } = useSession();
  const router = useRouter();
  const tabs = TABS.filter((t) => can(permissions, t.perm));
  const [tab, setTab] = useState<Tab | undefined>(tabs[0]?.key);
  const open = (p: string) => (r: { id: string }) => openRecord(router, p, r.id);
  return (
    <Screen title="Finans" module="finans">
      {tabs.length > 1 && tab ? <Tabs items={tabs} value={tab} onChange={setTab} /> : null}
      {tab === "ozet" ? <SnapshotCard projection="ozet-finans" title="Finans özeti" /> : null}
      {tab === "kasa" ? (
        <>
          <Muted>Kasalar</Muted>
          <ProjectionList projection="kasa" onOpen={open("kasa")} />
          <Muted>Bankalar</Muted>
          <ProjectionList projection="banka" onOpen={open("banka")} />
        </>
      ) : null}
      {tab === "cek" ? <ProjectionList projection="cek-senet" onOpen={open("cek-senet")} /> : null}
      {tab === "fatura" ? <ProjectionList projection="fatura" onOpen={open("fatura")} /> : null}
      {tab === "tahsilat" ? <ProjectionList projection="tahsilat-odeme" onOpen={open("tahsilat-odeme")} /> : null}
    </Screen>
  );
}
