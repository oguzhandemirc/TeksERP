import { Redirect } from "expo-router";
import { useSession } from "../src/state/session";
import { Loading } from "../src/ui/kit";

export default function Index() {
  const { phase } = useSession();
  if (phase === "yukleniyor") return <Loading />;
  return <Redirect href={phase === "hazir" ? "/pano" : "/giris"} />;
}
