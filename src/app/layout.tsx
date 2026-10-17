import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { PWARegister } from "@/components/pwa-register";
import { ThemeColorSync } from "@/components/theme-color-sync";

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
    icon: {
      url: "/icon.svg",
      type: "image/svg+xml",
    },
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
  manifest: "/manifest.webmanifest",
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
  // Apply the persisted app theme before first paint (no accent flash)
  // Pre-paint: apply the persisted app theme AND the custom accent override
  // (with its darkened strong variant) so there is never a color flash.
  const themeScript = `try{
    var t=localStorage.getItem('wa-viewer:theme');
    if(t)document.documentElement.setAttribute('data-wa-theme',t);
    var a=localStorage.getItem('wa-viewer:accent');
    if(a&&/^#[0-9a-f]{6}$/i.test(a)){
      var n=parseInt(a.slice(1),16);
      var f=function(s){var v=Math.round(((n>>s)&255)*0.86).toString(16);return v.length<2?'0'+v:v};
      var r=document.documentElement.style;
      r.setProperty('--wa-accent',a);
      r.setProperty('--wa-accent-strong','#'+f(16)+f(8)+f(0));
    }
  }catch(e){}`;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {children}
          <Toaster position="top-center" richColors />
          <PWARegister />
      <ThemeColorSync />
        </ThemeProvider>
      </body>
    </html>
  );
}
