import type { Metadata } from "next";
import "./globals.css";
import "./ax.css";
import "./print.css";
import "./responsive.css";

export const metadata: Metadata = {
  title: "งานตัดหญ้า",
  description: "ระบบจัดการงานจ้างเหมาตัดหญ้า งวดงาน รูปภาพ และเอกสาร",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anuphan:wght@300..700&family=Sarabun:wght@400;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
