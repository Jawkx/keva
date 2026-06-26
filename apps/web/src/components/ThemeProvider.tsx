import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// Wraps next-themes so the rest of the app can stay framework-agnostic. We
// toggle the `.dark` class on <html> (attribute="class"), which is what the
// shadcn token blocks in styles.css key off. System preference is the default.
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
