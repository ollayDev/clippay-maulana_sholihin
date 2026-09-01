import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipPay — Review Submission",
  description: "Review dan approve submission creator.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
