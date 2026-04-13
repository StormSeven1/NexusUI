import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "cesium/Build/Cesium/Widgets/widgets.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NexusUI — 指挥控制系统",
  description: "军事指挥信息系统前端原型",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="h-screen w-screen overflow-hidden bg-nexus-bg-base text-nexus-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
