import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "车票查询",
  description: "Hong Kong ↔ Ping Shan train ticket search",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
