import type { Metadata } from 'next'
import { DM_Sans, JetBrains_Mono, Special_Elite } from 'next/font/google'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Toaster } from 'sonner'
import { loadBrandKit } from '@/lib/brand-kit/load'
import { defaultBrandKit } from '@/lib/brand-kit/defaults'
import { brandStyleVars } from '@/lib/brand-kit/css'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import './globals.css'

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const specialElite = Special_Elite({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-special-elite',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Legatograph',
  description: 'Beat-aligned reels for instrumental musicians.',
}

async function loadActiveBrandKit() {
  // Lookup the active artist's brand kit. If the user isn't signed in (eg
  // the sign-in page itself), fall back to the default kit so the shell
  // still renders with the illutible palette.
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return defaultBrandKit

    const { data } = await supabase
      .from('artist_memberships')
      .select('artist_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    if (!data?.artist_id) return defaultBrandKit
    return await loadBrandKit(data.artist_id)
  } catch {
    return defaultBrandKit
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const kit = await loadActiveBrandKit()
  const fontClasses = `${dmSans.variable} ${specialElite.variable} ${jetbrains.variable}`

  return (
    // suppressHydrationWarning on <html> and <body> stops React complaining when
    // browser extensions (ColorZilla's `cz-shortcut-listen`, Grammarly's
    // `data-gr-*`, etc.) mutate these elements between SSR and hydration.
    // Only attribute mismatches on these two nodes are silenced — children
    // still hydrate normally so real app-level mismatches still warn.
    <html
      lang="en"
      className={fontClasses}
      style={brandStyleVars(kit)}
      suppressHydrationWarning
    >
      <body className="bg-brand-bg text-brand-fg font-body antialiased" suppressHydrationWarning>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: 'border border-brand-rule bg-brand-bg-2 text-brand-fg',
              actionButton: 'bg-brand-accent text-brand-bg',
            },
          }}
        />
        <SpeedInsights />
      </body>
    </html>
  )
}
