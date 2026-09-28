import "@fontsource-variable/geist";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { getLocale } from "@/lib/i18n";
import { AR } from "@/lib/i18n/ar";
import { I18nProvider } from "@/lib/i18n/client";
import { Toaster } from "@/components/client";

export const metadata: Metadata = {
  title: { default: "Mada Ops", template: "%s · Mada Ops" },
  description: "Mada Trips internal operations platform",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0a100e" }, { color: "#f4f2ed" }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = (await cookies()).get("mada_theme")?.value;
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className={theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <head>
        {!theme && <script dangerouslySetInnerHTML={{ __html: `if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')` }} />}
      </head>
      <body className="min-h-dvh font-sans text-[14px] antialiased">
        <I18nProvider locale={locale} dict={locale === "ar" ? AR : {}}>
          {children}
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
