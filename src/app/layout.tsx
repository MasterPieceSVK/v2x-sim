import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "V2X Simulator",
  description: "Browser-based V2X simulator with an ETSI ITS-G5 packet tracer",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
