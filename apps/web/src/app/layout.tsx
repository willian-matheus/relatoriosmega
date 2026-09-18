import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Mega CRM · Seu próximo negócio",
  description:
    "Organize oportunidades e transforme relatórios em relacionamentos.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
