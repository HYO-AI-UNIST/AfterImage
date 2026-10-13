import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MindMiner — 기억으로 찾는 길",
  description: "길은 사라져도, 기억은 남는다. 나만의 지뢰판을 만들고 서로의 기억을 겨루는 6인 온라인 보드게임.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
