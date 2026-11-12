import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";

/** Üst çubuk açık/koyu geçişi — seçim kullanıcı tercihine yazılır ("sistem" ayarı Görünüm ekranında). */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const prefs = useOptionalPreferences();
  const dark = resolvedTheme === "dark";
  const label = dark ? "Açık temaya geç" : "Koyu temaya geç";
  const toggle = () => {
    const next = dark ? "light" : "dark";
    setTheme(next);
    prefs?.setPreference({ theme: next });
  };
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={toggle}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
