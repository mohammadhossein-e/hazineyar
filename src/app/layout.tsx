import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "هزینه‌یار — داشبورد",
  description: "ثبت و گزارش هزینه‌های پروژه‌ها",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
