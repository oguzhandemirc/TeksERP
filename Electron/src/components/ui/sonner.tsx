import { Toaster as Sonner } from "sonner";
import { useTheme } from "next-themes";

type ToasterProps = React.ComponentProps<typeof Sonner>;

export const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "group toast",
          description: "text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};
