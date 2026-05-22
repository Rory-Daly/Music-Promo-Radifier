'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { brandKitSchema, type BrandKit } from '@/lib/brand-kit/schema'
import { cn } from '@/lib/utils'

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

type Mode = 'view' | 'edit'

type Props = {
  artistId: string
  brandKit: BrandKit
}

export function BrandTab({ artistId, brandKit }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>('view')
  const [draft, setDraft] = useState<string>(() => JSON.stringify(brandKit, null, 2))
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })

  const parseResult = useMemo(() => {
    try {
      const json = JSON.parse(draft) as unknown
      const parsed = brandKitSchema.safeParse(json)
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? 'Invalid brand kit',
        }
      }
      return { ok: true as const, kit: parsed.data }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Invalid JSON' }
    }
  }, [draft])

  async function save() {
    if (!parseResult.ok) {
      setSaveState({ kind: 'error', message: parseResult.error })
      return
    }
    setSaveState({ kind: 'saving' })
    try {
      const res = await fetch('/api/brand-kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId, brandKit: parseResult.kit }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setSaveState({ kind: 'error', message: body?.error ?? `Save failed (${res.status})` })
        return
      }
      setSaveState({ kind: 'success', message: 'Saved. Refresh to see colours apply.' })
      setMode('view')
      startTransition(() => router.refresh())
    } catch (e) {
      setSaveState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Save failed',
      })
    }
  }

  return (
    <section className="space-y-6" role="tabpanel" aria-label="Brand">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl tracking-tight">Brand kit</h2>
          {brandKit.tagline ? (
            <p className="mt-1 text-xs text-brand-fg-dim">{brandKit.tagline}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode(mode === 'view' ? 'edit' : 'view')}
            className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent"
          >
            {mode === 'view' ? 'Edit JSON' : 'View'}
          </button>
        </div>
      </header>

      {saveState.kind === 'success' ? (
        <p className="rounded-md border border-brand-rule bg-brand-bg-2 px-3 py-2 text-sm text-brand-fg">
          {saveState.message}
        </p>
      ) : null}
      {saveState.kind === 'error' ? (
        <p className="rounded-md border border-brand-accent-2 bg-brand-bg-2 px-3 py-2 text-sm text-brand-fg">
          {saveState.message}
        </p>
      ) : null}

      {mode === 'view' ? (
        <BrandKitView kit={brandKit} />
      ) : (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            rows={28}
            className="block w-full rounded-md border border-brand-rule bg-brand-bg-2 p-3 font-mono text-xs text-brand-fg focus:border-brand-accent focus:outline-none"
          />
          <div className="flex items-center justify-between gap-3 text-xs">
            <span
              className={cn(
                'font-mono',
                parseResult.ok ? 'text-brand-fg-dim' : 'text-brand-accent-2',
              )}
            >
              {parseResult.ok ? 'JSON valid · ready to save' : parseResult.error}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(JSON.stringify(brandKit, null, 2))
                  setSaveState({ kind: 'idle' })
                }}
                className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg-dim transition hover:text-brand-fg"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!parseResult.ok || saveState.kind === 'saving'}
                className="rounded-md border border-brand-accent bg-brand-accent px-3 py-1.5 font-medium text-brand-bg transition disabled:opacity-50"
              >
                {saveState.kind === 'saving' ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function BrandKitView({ kit }: { kit: BrandKit }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card title="Colours">
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(kit.colours).map(([name, value]) => (
            <div key={name} className="space-y-1">
              <div
                className="h-12 w-full rounded border border-brand-rule"
                style={{ background: value }}
                aria-label={`${name} swatch ${value}`}
              />
              <p className="font-mono text-[10px] text-brand-fg-faint">{name}</p>
              <p className="font-mono text-[10px] text-brand-fg-dim">{value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Fonts">
        <dl className="space-y-3 text-sm">
          {(['body', 'display', 'mono'] as const).map((slot) => (
            <div key={slot} className="flex items-baseline justify-between gap-3">
              <dt className="font-mono text-xs uppercase tracking-[0.2em] text-brand-fg-faint">
                {slot}
              </dt>
              <dd
                className={cn(
                  'text-brand-fg',
                  slot === 'display' && 'font-display',
                  slot === 'mono' && 'font-mono',
                )}
              >
                {kit.fonts[slot].family}{' '}
                <span className="text-brand-fg-faint">· {kit.fonts[slot].weights.join(', ')}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Voice">
        <div className="space-y-3 text-sm">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-brand-fg-faint">
            Register · {kit.voice.register}
          </p>
          {kit.voice.exemplars.length > 0 ? (
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.2em] text-brand-fg-faint">
                Exemplars
              </p>
              <ul className="mt-1 space-y-1 text-brand-fg-dim">
                {kit.voice.exemplars.map((e, i) => (
                  <li key={i} className="italic">
                    “{e}”
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {kit.voice.avoid.length > 0 ? (
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.2em] text-brand-fg-faint">
                Avoid
              </p>
              <ul className="mt-1 space-y-1 text-brand-fg-dim">
                {kit.voice.avoid.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="Smart link & DSPs">
        <p className="break-all font-mono text-xs text-brand-fg-dim">
          {kit.smart_link.template}
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {kit.smart_link.dsps.map((d) => (
            <li key={d.platform} className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-brand-fg-faint">
                {d.platform}
              </span>
              {d.url ? (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-brand-fg underline-offset-2 hover:text-brand-accent hover:underline"
                >
                  {d.handle}
                </a>
              ) : (
                <span className="text-brand-fg-faint">{d.handle} · no url</span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Caption presets" wide>
        {kit.caption_presets.length === 0 ? (
          <p className="text-sm text-brand-fg-dim">No presets yet.</p>
        ) : (
          <ul className="space-y-3">
            {kit.caption_presets.map((p) => (
              <li key={p.id} className="rounded border border-brand-rule p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-brand-fg">{p.label}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
                    {p.platforms.join(' · ')}
                  </p>
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-brand-fg-dim">
                  {p.template}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Hashtags" wide>
        <div className="space-y-3 text-sm">
          <Hashtags label="Default" tags={kit.hashtag_presets.default} />
          {Object.entries(kit.hashtag_presets.by_platform ?? {}).map(([platform, tags]) => (
            <Hashtags key={platform} label={platform} tags={tags} />
          ))}
        </div>
      </Card>
    </div>
  )
}

function Card({
  title,
  wide,
  children,
}: {
  title: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-brand-rule bg-brand-bg-2 p-4',
        wide && 'lg:col-span-2',
      )}
    >
      <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.3em] text-brand-fg-faint">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Hashtags({ label, tags }: { label: string; tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
        {label}
      </p>
      <p className="mt-1 flex flex-wrap gap-1 text-brand-fg-dim">
        {tags.map((t) => (
          <span
            key={t}
            className="rounded border border-brand-rule bg-brand-bg px-1.5 py-0.5 font-mono text-[10px]"
          >
            {t}
          </span>
        ))}
      </p>
    </div>
  )
}
