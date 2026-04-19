import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CampusSense",
  description: "Claude-powered energy analyst for Ohio State.",
};

// Runs synchronously in <head> before React hydrates — prevents a flash of
// wrong theme on first paint. Kept tiny and self-contained.
const themeInitScript = `
try {
  var t = localStorage.getItem('cs-theme');
  if (t !== 'dark' && t !== 'light') t = 'dark';
  var r = document.documentElement;
  r.classList.remove('dark', 'light');
  r.classList.add(t);
  r.dataset.theme = t;
  r.style.colorScheme = t;
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-bg text-fg font-sans">
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
