import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

// Inter is a variable font with a high-end UI feel — the "smoother" read
// the user described. We expose it as --font-sans so Tailwind v4's
// `font-sans` utility resolves to it via the @theme token in globals.css.
// Mono stays Geist Mono — only the sans stack is changing.
const inter = Inter({
  variable: "--font-sans",
  subsets:  ["latin"],
  display:  "swap",
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets:  ["latin"],
  display:  "swap",
});

export const metadata: Metadata = {
  title: "Kinvox",
  description: "Multi-Tenant Sales & Support SaaS for Oklahoma City",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full`}>
      <body className="h-full bg-pvx-bg text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
