import type { Metadata, Viewport } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { Providers } from "@/components/providers";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Lead Finder";

export const metadata: Metadata = {
  title: {
    default: `${appName} · Business lead research`,
    template: `%s · ${appName}`,
  },
  description:
    "Discover local businesses, import lists, inspect public websites, and score opportunities without sending automated outreach.",
  applicationName: appName,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1714" },
  ],
  width: "device-width",
  initialScale: 1,
};

const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('lf-theme');
    var dark = stored === 'dark' || ((!stored || stored === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (error) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
