import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Architect",
  description:
    "Recopila y estructura el contexto de proyectos complejos antes de planificarlos.",
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
