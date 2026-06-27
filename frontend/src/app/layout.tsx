import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retrieval-Augmented Analytics Dashboard - Natural Language Analytics",
  description: "Ask questions about your data in plain English. Powered by LLMs and DuckDB.",
  alternates: {
    canonical: "http://localhost:3000",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
