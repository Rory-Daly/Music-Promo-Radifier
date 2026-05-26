import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { brandColourVars } from '@/lib/brand-kit/css'
import { defaultBrandKit } from '@/lib/brand-kit/defaults'
import { brandKitSchema, type BrandKit, type Dsp } from '@/lib/brand-kit/schema'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ artistSlug: string; trackSlug: string }>
}

type LookupResult = {
  artistName: string
  artistTagline: string | null
  trackTitle: string
  brandKit: BrandKit
}

async function lookup(artistSlug: string, trackSlug: string): Promise<LookupResult | null> {
  const admin = createSupabaseAdminClient()
  const { data: artist } = await admin
    .from('artists')
    .select('id, name, brand_kit')
    .eq('slug', artistSlug)
    .maybeSingle()
  if (!artist) return null

  const { data: track } = await admin
    .from('tracks')
    .select('title')
    .eq('artist_id', artist.id)
    .eq('slug', trackSlug)
    .maybeSingle()
  if (!track) return null

  const parsed = brandKitSchema.safeParse(artist.brand_kit)
  const brandKit = parsed.success ? parsed.data : defaultBrandKit
  return {
    artistName: artist.name,
    artistTagline: brandKit.tagline,
    trackTitle: track.title,
    brandKit,
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { artistSlug, trackSlug } = await params
  const result = await lookup(artistSlug, trackSlug)
  if (!result) return { title: 'Not found' }
  return {
    title: `${result.trackTitle} — ${result.artistName}`,
    description: result.artistTagline ?? `Listen to ${result.trackTitle} by ${result.artistName}.`,
  }
}

export default async function SmartLinkPage({ params }: PageProps) {
  const { artistSlug, trackSlug } = await params
  const result = await lookup(artistSlug, trackSlug)
  if (!result) notFound()

  const { artistName, artistTagline, trackTitle, brandKit } = result
  const dsps = brandKit.smart_link.dsps.filter((d) => d.url.length > 0)

  return (
    <main
      className="min-h-screen bg-brand-bg px-6 py-16 text-brand-fg"
      style={brandColourVars(brandKit.colours)}
    >
      <div className="mx-auto flex max-w-md flex-col items-stretch gap-8">
        <header className="space-y-3 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-brand-fg-faint">
            {artistName}
          </p>
          <h1 className="font-display text-3xl leading-tight tracking-tight text-brand-fg sm:text-4xl">
            {trackTitle}
          </h1>
          {artistTagline ? (
            <p className="text-sm text-brand-fg-dim">{artistTagline}</p>
          ) : null}
        </header>

        {dsps.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {dsps.map((d) => (
              <li key={d.platform}>
                <DspButton dsp={d} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-sm text-brand-fg-dim">
            Streaming links coming soon.
          </p>
        )}

        <footer className="pt-4 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand-fg-faint">
            Made by hand · {artistName}
          </p>
        </footer>
      </div>
    </main>
  )
}

const PLATFORM_LABEL: Record<Dsp['platform'], string> = {
  spotify: 'Spotify',
  apple: 'Apple Music',
  youtube: 'YouTube',
  bandcamp: 'Bandcamp',
  soundcloud: 'SoundCloud',
  tidal: 'Tidal',
  deezer: 'Deezer',
}

function DspButton({ dsp }: { dsp: Dsp }) {
  return (
    <a
      href={dsp.url}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center justify-between gap-3 rounded-md border border-brand-rule bg-brand-bg-2 px-4 py-3 text-sm text-brand-fg transition hover:border-brand-accent"
    >
      <span className="font-medium">{PLATFORM_LABEL[dsp.platform]}</span>
      <span className="font-mono text-xs text-brand-fg-dim group-hover:text-brand-accent">
        {dsp.handle || 'Open'}
      </span>
    </a>
  )
}
