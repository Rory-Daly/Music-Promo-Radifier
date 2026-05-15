import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Legatograph',
  description: 'Beat-aligned reels for instrumental musicians.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning on <html> and <body> stops React complaining when
    // browser extensions (ColorZilla's `cz-shortcut-listen`, Grammarly's
    // `data-gr-*`, etc.) mutate these elements between SSR and hydration.
    // Only attribute mismatches on these two nodes are silenced — children
    // still hydrate normally so real app-level mismatches still warn.
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
