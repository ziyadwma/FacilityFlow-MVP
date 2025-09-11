import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "FacilityFlow MVP",
  description: "Internal MVP"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
