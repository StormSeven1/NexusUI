import type { Metadata } from "next";
import "./globals.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { SonnerToaster } from "@/components/SonnerToaster";

export const metadata: Metadata = {
  title: "多模态自主协同融合控制系统",
  description: "多模态自主协同融合控制系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="h-screen w-screen overflow-hidden bg-nexus-bg-base text-nexus-text-primary antialiased">
        {children}
        <SonnerToaster />
      </body>
    </html>
  );
}
