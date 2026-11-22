import { describe, expect, it, vi } from 'vitest'
import { AuthError, SessionController, emailProblem, passwordProblem } from './auth'
import { readCloudConfig } from './config'
import { FakeAuthServer } from './fake-auth.test-support'
import { toAuthError, toAuthUser } from './supabase-backend'
import type { User } from '@supabase/supabase-js'

const REDIRECT = 'https://webtown.example/'

describe('SessionController', () => {
  it('signs a first-time player in as a guest without asking anything', async () => {
    const server = new FakeAuthServer()
    const state = await new SessionController(server.port(), REDIRECT).start()
    expect(state.status).toBe('signed-in')
    if (state.status !== 'signed-in') return
    expect(state.user).toMatchObject({ isAnonymous: true, email: null })
    expect(server.users.size).toBe(1)
  })

  it('restores the same guest after a reload, and never makes a second one', async () => {
    const server = new FakeAuthServer()
    const first = await new SessionController(server.port(), REDIRECT).start()
    const again = await new SessionController(server.port(), REDIRECT).start()
    expect(again).toEqual(first)
    expect(server.users.size).toBe(1)
    expect(server.calls.filter(c => c === 'signInAnonymously')).toHaveLength(1)
  })

  it('upgrades a guest by linking an email, keeping the same user id', async () => {
    const server = new FakeAuthServer()
    const c = new SessionController(server.port(), REDIRECT)
    const start = await c.start()
    const guestId = start.status === 'signed-in' ? start.user.id : ''
    const linked = await c.linkEmail(' ada@example.com ')
    expect(linked).toMatchObject({ id: guestId, isAnonymous: true, pendingEmail: 'ada@example.com' })
    server.confirm('ada@example.com')
    const confirmed = await c.refresh()
    expect(confirmed).toMatchObject({ id: guestId, isAnonymous: false, email: 'ada@example.com', pendingEmail: null })
    await c.setPassword('correct horse')
    expect(c.current).toMatchObject({ status: 'signed-in', user: { id: guestId, isAnonymous: false } })
    // And now it is a normal account: log out, log back in, same id.
    await c.signOut()
    const back = await c.signIn('ada@example.com', 'correct horse')
    expect(back).toMatchObject({ status: 'signed-in', user: { id: guestId } })
  })

  it('refuses to link an email that already has an account, and changes nothing', async () => {
    const server = new FakeAuthServer()
    const existing = server.addAccount('taken@example.com', 'secret123')
    const c = new SessionController(server.port(), REDIRECT)
    const start = await c.start()
    const error = await c.linkEmail('taken@example.com').catch(e => e as AuthError)
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).code).toBe('email_exists')
    expect(c.current).toEqual(start)
    expect(server.users.get(existing)).toMatchObject({ email: 'taken@example.com', password: 'secret123' })
  })

  it('waits on the start screen after logging out, instead of making a new guest', async () => {
    const server = new FakeAuthServer()
    const c = new SessionController(server.port(), REDIRECT)
    await c.start()
    expect(await c.signOut()).toEqual({ status: 'signed-out', notice: null })
    expect(server.users.size).toBe(1)
    const guest = await c.playAsGuest()
    expect(guest.status).toBe('signed-in')
    expect(server.users.size).toBe(2)
  })

  it('logs in and creates permanent accounts, with email confirmation', async () => {
    const server = new FakeAuthServer()
    const c = new SessionController(server.port(), REDIRECT)
    await c.start()
    await c.signOut()
    expect(await c.signUp('new@example.com', 'password1')).toMatchObject({ confirmationSent: true, state: { status: 'signed-out' } })
    await expect(c.signIn('new@example.com', 'password1')).rejects.toMatchObject({ code: 'email_not_confirmed' })
    server.confirm('new@example.com')
    expect((await c.signIn('new@example.com', 'password1')).status).toBe('signed-in')
    await c.signOut()
    await expect(c.signIn('new@example.com', 'wrong')).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(c.current.status).toBe('signed-out')
  })

  it('signs up straight in when the server needs no confirmation', async () => {
    const server = new FakeAuthServer()
    server.confirmations = false
    const c = new SessionController(server.port(), REDIRECT)
    await c.start()
    await c.signOut()
    expect(await c.signUp('quick@example.com', 'password1')).toMatchObject({ confirmationSent: false, state: { status: 'signed-in' } })
  })

  it('reports a network failure on start, and a guest server setting that is off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const offline = new FakeAuthServer()
    offline.offline = true
    expect((await new SessionController(offline.port(), REDIRECT).start()).status).toBe('failed')
    const noGuests = new FakeAuthServer()
    noGuests.guestsEnabled = false
    expect(await new SessionController(noGuests.port(), REDIRECT).start()).toMatchObject({ status: 'signed-out', notice: expect.stringContaining('Guest play is turned off') })
  })

  it('follows sign-outs made in another tab', async () => {
    const server = new FakeAuthServer()
    const c = new SessionController(server.port(), REDIRECT)
    await c.start()
    server.savedSession = null
    server.emit()
    expect(c.current).toMatchObject({ status: 'signed-out', notice: expect.stringContaining('another tab') })
  })
})

describe('validation', () => {
  it('checks emails and passwords before sending them', () => {
    expect(emailProblem('')).toMatch(/Type/)
    expect(emailProblem('nope')).toMatch(/does not look/)
    expect(emailProblem(' ada@example.com ')).toBeNull()
    expect(passwordProblem('short')).toMatch(/at least 8/)
    expect(passwordProblem('x'.repeat(73))).toMatch(/at most/)
    expect(passwordProblem('longenough', 'different')).toMatch(/different/)
    expect(passwordProblem('longenough', 'longenough')).toBeNull()
  })
})

describe('Supabase mapping', () => {
  it("turns Supabase's error codes into messages for players", () => {
    expect(toAuthError({ code: 'email_exists' }).code).toBe('email_exists')
    expect(toAuthError({ code: 'user_already_exists' }).code).toBe('email_exists')
    expect(toAuthError({ code: 'invalid_credentials' }).message).toMatch(/do not match/)
    expect(toAuthError({ code: 'over_email_send_rate_limit' }).code).toBe('rate_limited')
    expect(toAuthError({ code: 'anonymous_provider_disabled' }).code).toBe('guests_disabled')
    expect(toAuthError({ name: 'AuthRetryableFetchError', status: 0 }).code).toBe('network')
    expect(toAuthError({ code: 'something_new' }).code).toBe('unknown')
  })

  it('reads guests, pending emails and confirmed emails from Supabase users', () => {
    const base = { id: 'u1', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' }
    expect(toAuthUser({ ...base, is_anonymous: true } as User)).toEqual({ id: 'u1', isAnonymous: true, email: null, pendingEmail: null })
    expect(toAuthUser({ ...base, is_anonymous: true, new_email: 'a@b.co' } as User)).toMatchObject({ isAnonymous: true, pendingEmail: 'a@b.co' })
    expect(toAuthUser({ ...base, is_anonymous: false, email: 'a@b.co', email_confirmed_at: 'x' } as User)).toMatchObject({ isAnonymous: false, email: 'a@b.co', pendingEmail: null })
  })
})

describe('readCloudConfig', () => {
  it('is "not configured" without settings, and needs both', () => {
    expect(readCloudConfig({})).toEqual({ ok: false, reason: 'not configured' })
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' }).ok).toBe(false)
  })

  it('accepts a project URL and a publishable key', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_123' }))
      .toEqual({ ok: true, config: { url: 'https://abc.supabase.co', publishableKey: 'sb_publishable_123' } })
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }).ok).toBe(true)
  })

  it('refuses plain http and secret keys', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'http://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }).ok).toBe(false)
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('secret') })
    const serviceJwt = `x.${btoa(JSON.stringify({ role: 'service_role' }))}.y`
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: serviceJwt }).ok).toBe(false)
  })
})
