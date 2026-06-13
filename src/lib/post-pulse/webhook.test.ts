import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  parseWebhookPayload,
  SIGNATURE_HEADER,
  verifyWebhookSignature,
} from './webhook'

const SECRET = 'test_secret_value'
const RAW_BODY = JSON.stringify({ id: 123, overallStatus: 'COMPLETED' })

function hex(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function base64(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

describe('verifyWebhookSignature', () => {
  beforeEach(() => {
    process.env.POST_PULSE_WEBHOOK_SECRET = SECRET
  })
  afterEach(() => {
    delete process.env.POST_PULSE_WEBHOOK_SECRET
  })

  it('accepts a hex signature', () => {
    const sig = hex(RAW_BODY, SECRET)
    expect(verifyWebhookSignature(RAW_BODY, sig)).toEqual({ ok: true })
  })

  it('accepts a base64 signature', () => {
    const sig = base64(RAW_BODY, SECRET)
    expect(verifyWebhookSignature(RAW_BODY, sig)).toEqual({ ok: true })
  })

  it('accepts a sha256= prefixed signature', () => {
    const sig = `sha256=${hex(RAW_BODY, SECRET)}`
    expect(verifyWebhookSignature(RAW_BODY, sig)).toEqual({ ok: true })
  })

  it('rejects a wrong signature', () => {
    const sig = hex(RAW_BODY, 'wrong_secret')
    expect(verifyWebhookSignature(RAW_BODY, sig)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('rejects when the header is missing', () => {
    expect(verifyWebhookSignature(RAW_BODY, null)).toEqual({
      ok: false,
      reason: 'missing_header',
    })
  })

  it('rejects when the secret is missing', () => {
    delete process.env.POST_PULSE_WEBHOOK_SECRET
    expect(verifyWebhookSignature(RAW_BODY, hex(RAW_BODY, SECRET))).toEqual({
      ok: false,
      reason: 'missing_secret',
    })
  })

  it('exports the expected lowercase header name', () => {
    expect(SIGNATURE_HEADER).toBe('x-postpulse-signature')
  })
})

describe('parseWebhookPayload', () => {
  it('extracts id, status, permalink from a flat payload', () => {
    const parsed = parseWebhookPayload({
      id: 9821,
      overallStatus: 'COMPLETED',
      permalink: 'https://instagram.com/p/abc',
    })
    expect(parsed.postPulsePostId).toBe('9821')
    expect(parsed.overallStatus).toBe('COMPLETED')
    expect(parsed.permalink).toBe('https://instagram.com/p/abc')
    expect(parsed.errorMessage).toBeNull()
  })

  it('extracts permalink from publications[0]', () => {
    const parsed = parseWebhookPayload({
      id: 1,
      overallStatus: 'COMPLETED',
      publications: [{ permalink: 'https://tiktok.com/@x/video/1' }],
    })
    expect(parsed.permalink).toBe('https://tiktok.com/@x/video/1')
  })

  it('extracts permalink from publications[0].platformResponse', () => {
    const parsed = parseWebhookPayload({
      id: 1,
      overallStatus: 'COMPLETED',
      publications: [{ platformResponse: { permalink: 'https://x.com/i/status/1' } }],
    })
    expect(parsed.permalink).toBe('https://x.com/i/status/1')
  })

  it('captures the error message on failure', () => {
    const parsed = parseWebhookPayload({
      id: 1,
      overallStatus: 'FAILED',
      publications: [{ error: 'Caption exceeds 280 characters' }],
    })
    expect(parsed.errorMessage).toBe('Caption exceeds 280 characters')
  })

  it('tolerates a non-object payload', () => {
    expect(parseWebhookPayload(null)).toEqual({
      postPulsePostId: null,
      overallStatus: null,
      permalink: null,
      errorMessage: null,
    })
  })
})
