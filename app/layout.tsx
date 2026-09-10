import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pathways · Container registry onboarding",
  description: "Map application onboarding, explore parallel workstreams, and understand the dependencies between every step.",
  other: {
    "codex-preview": "development",
  },
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
