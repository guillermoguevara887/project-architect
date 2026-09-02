import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MemoOS",
  description: "Hub personal para Proyectos, Journey y aprendizaje.",
  applicationName: "MemoOS",
  appleWebApp: {
    capable: true,
    title: "MemoOS",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#171b24",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
