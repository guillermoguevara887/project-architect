import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MemoOS",
  description: "Hub personal para Project Architect y Journey.",
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
