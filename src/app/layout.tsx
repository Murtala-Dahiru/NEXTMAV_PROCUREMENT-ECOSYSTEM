import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NextMav Procure — Modern Procurement & Operations Platform",
  description:
    "Cloud-based Procure-to-Pay platform that digitizes the entire purchasing lifecycle. Replace spreadsheets, emails, and paper with one intelligent, secure system.",
  keywords: [
    "procurement",
    "procure-to-pay",
    "P2P",
    "purchase orders",
    "RFQ",
    "vendor management",
    "NextMav",
    "SME procurement",
  ],
  authors: [{ name: "NextMav" }],
  openGraph: {
    title: "NextMav Procure",
    description: "Modern Procurement & Operations Platform for SMEs and mid-market organizations.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline script prevents dark-mode FOUC before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nextmav-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
