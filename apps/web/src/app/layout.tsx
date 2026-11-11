import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Mega · Relatórios Gestta & Google Drive",
  description:
    "Busque relatórios, tarefas e documentos do Gestta e envie ao Google Drive.",
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
