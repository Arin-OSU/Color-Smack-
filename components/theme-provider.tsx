"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type Theme = "dark" | "light";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
});

const STORAGE_KEY = "cs-theme";

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(t);
  root.dataset.theme = t;
  root.style.colorScheme = t;
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
}) {
  // Initialize from <html class> set by the FOUC script in layout.tsx.
  // Server rendered value is defaultTheme; client corrects in useEffect
  // — wrapped in `suppressHydrationWarning` on <html> so the class mismatch
  // is expected and silent.
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  useEffect(() => {
    let initial: Theme = defaultTheme;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "dark" || saved === "light") initial = saved;
    } catch {
      // ignore storage errors (private mode, etc.)
    }
    applyTheme(initial);
    setThemeState(initial);
  }, [defaultTheme]);

  const setTheme = useCallback((t: Theme) => {
    applyTheme(t);
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
