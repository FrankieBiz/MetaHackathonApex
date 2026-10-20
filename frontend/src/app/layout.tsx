import type { Metadata, Viewport } from "next";
import "@fontsource-variable/jetbrains-mono";
import "react-grid-layout/css/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apex OS Terminal",
  description:
    "Academic execution terminal: priority queue, grade trajectory, velocity, and recursive task trees.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  );
}
