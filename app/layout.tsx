import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MindMiner — 기억으로 찾는 길",
  description: "지뢰를 배치하고, 서로의 이동을 기억하고, 가장 먼저 정상에 도착하세요. 6인 온라인 기억 전략 보드게임.",
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
