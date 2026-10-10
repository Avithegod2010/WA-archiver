import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { PWARegister } from "@/components/pwa-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WhatsApp Viewer — Import & Read Your Chats",
  description:
    "Import WhatsApp chat exports (.zip or .txt) and read them in a familiar WhatsApp-style interface. Private and local — your chats never leave this device.",
  keywords: ["WhatsApp", "chat viewer", "export", "chat history", "PWA"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "WhatsApp Viewer",
    description: "Read your exported WhatsApp chats in a familiar interface",
    siteName: "WhatsApp Viewer",
    type: "website",
  },
  appleWebApp: {
    capable: true,
    title: "WA Viewer",
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#008069",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {children}
          <Toaster position="top-center" richColors />
          <PWARegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
