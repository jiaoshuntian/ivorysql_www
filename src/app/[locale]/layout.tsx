import { Inter } from "next/font/google";
import localFont from "next/font/local";
import { notFound } from "next/navigation";

import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { AssistantWidget } from "@/components/assistant/AssistantWidget";
import { Footer } from "@/components/blocks/footer";
import { Navbar } from "@/components/blocks/navbar";
import { StyleGlideProvider } from "@/components/styleglide-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { routing } from "@/i18n/routing";
import "@/styles/globals.css";

const dmSans = localFont({
  src: [
    {
      path: "../../../fonts/dm-sans/DMSans-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-Italic.ttf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-MediumItalic.ttf",
      weight: "500",
      style: "italic",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-SemiBoldItalic.ttf",
      weight: "600",
      style: "italic",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-Bold.ttf",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-BoldItalic.ttf",
      weight: "700",
      style: "italic",
    },
  ],
  variable: "--font-dm-sans",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ivorysql.org"),
  title: {
    default: "IvorySQL",
    template: "%s | IvorySQL",
  },
  description:
    "Open Source Oracle compatible PostgreSQL. A creative and powerful database based on PostgreSQL with Oracle compatibility, built for reliability and performance.",
  keywords: [
    "PostgreSQL",
    "Oracle compatible",
    "Oracle compatibility",
    "open source database",
    "IvorySQL",
    "database",
    "relational database",
    "HighGo",
  ],
  authors: [{ name: "IvorySQL" }],
  creator: "IvorySQL",
  publisher: "IvorySQL",
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/favicon/favicon.ico", sizes: "48x48" },
      { url: "/favicon/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon/favicon.ico" },
    ],
    apple: [{ url: "/favicon/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: [{ url: "/favicon/favicon.ico" }],
  },
  openGraph: {
    title: "IvorySQL - Open Source Oracle Compatible PostgreSQL",
    description:
      "Open Source Oracle compatible PostgreSQL. A creative and powerful database based on PostgreSQL with Oracle compatibility.",
    siteName: "IvorySQL",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "IvorySQL - Open Source Oracle Compatible PostgreSQL",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "IvorySQL - Open Source Oracle Compatible PostgreSQL",
    description:
      "Open Source Oracle compatible PostgreSQL. A creative and powerful database based on PostgreSQL with Oracle compatibility.",
    images: ["/og-image.jpg"],
    creator: "@IvorySQL",
  },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${dmSans.variable} ${inter.variable} antialiased`}>
        <NextIntlClientProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            <StyleGlideProvider />
            <Navbar />
            <main className="">{children}</main>
            <Footer />
            <AssistantWidget locale={locale} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
