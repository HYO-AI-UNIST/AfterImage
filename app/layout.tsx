import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "잔상 Afterimage — 기억으로 찾는 길",
  applicationName: "Afterimage",
  description: "지뢰를 배치하고, 서로의 이동을 기억하고, 가장 먼저 정상에 도착하세요. 온라인 기억 전략 보드게임.",
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
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('mindminer.theme.v1')==='light'?'light':'dark'}catch{}" }}/></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
