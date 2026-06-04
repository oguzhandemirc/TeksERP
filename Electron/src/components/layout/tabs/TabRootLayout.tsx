import { AnimatedOutlet } from "@/components/motion";

/**
 * Her sekmenin memory router'ı için kök layout. Kabuk (Topbar/Sidebar/şerit)
 * dışarıda kalır; burada yalnızca sayfa içeriği + geçiş animasyonu yaşar.
 * Sekme paneli zaten kaydırılabilir kapsayıcı olduğundan burası `h-full`.
 */
export function TabRootLayout() {
  return (
    <div className="h-full">
      <AnimatedOutlet />
    </div>
  );
}
