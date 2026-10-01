import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Gallery",
  description: "Private self-hosted photo and video gallery",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="antialiased bg-ink-950 text-zinc-100">{children}</body>
    </html>
  );
}
