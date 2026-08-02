import type { Metadata, Viewport } from "next";
import PwaRegister from "../components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "SLE Audit",
  description: "Система оценки SLE",
  applicationName: "SLE Audit",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SLE Audit"
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }]
  }
};

export const viewport: Viewport = {
  themeColor: "#ffd800",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
