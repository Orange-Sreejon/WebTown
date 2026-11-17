import { describe, expect, it } from 'vitest'
import { validateExternalUrl } from './url-policy'

const accepted = (input: unknown): { href: string; hostname: string } => {
  const result = validateExternalUrl(input)
  if (!result.ok) throw new Error(`expected ${JSON.stringify(input)} to be accepted: ${result.reason}`)
  return result
}

const refusal = (input: unknown): string => {
  const result = validateExternalUrl(input)
  if (result.ok) throw new Error(`expected ${JSON.stringify(input)} to be refused`)
  return result.reason
}

describe('accepted addresses', () => {
  it('accepts a plain https address and normalises it', () => {
    expect(accepted('https://example.com')).toMatchObject({
      href: 'https://example.com/',
      hostname: 'example.com',
    })
  })

  it('keeps paths, queries and fragments', () => {
    expect(accepted('https://example.com/a/b/c.html').href).toBe('https://example.com/a/b/c.html')
    expect(accepted('https://example.com/search?q=web+town&page=2').href)
      .toBe('https://example.com/search?q=web+town&page=2')
    expect(accepted('https://example.com/docs#section-2').href).toBe('https://example.com/docs#section-2')
    expect(accepted('https://www.example.com/a/b?x=1&y=2#top').href)
      .toBe('https://www.example.com/a/b?x=1&y=2#top')
  })

  it('treats the scheme and host case-insensitively', () => {
    expect(accepted('HTTPS://Example.COM/Path').href).toBe('https://example.com/Path')
  })

  it('accepts subdomains, hyphens and digits in names', () => {
    expect(accepted('https://my-site.sub.example.co.uk/').hostname).toBe('my-site.sub.example.co.uk')
    expect(accepted('https://site2.example.org/').hostname).toBe('site2.example.org')
  })

  it('accepts the default port written out, and a trailing dot', () => {
    expect(accepted('https://example.com:443/x').href).toBe('https://example.com/x')
    expect(accepted('https://example.com./x').hostname).toBe('example.com')
  })

  it('shows international names in the form the browser connects to', () => {
    expect(accepted('https://bücher.de/').hostname).toBe('xn--bcher-kva.de')
  })

  it('lets the URL parser repair a missing slash instead of guessing', () => {
    // Browsers read "https:example.com" as https://example.com/, so the stored form is the normalised one.
    expect(accepted('https:example.com').href).toBe('https://example.com/')
  })

  it('ignores spaces around the address', () => {
    expect(accepted('  https://example.com/x  ').href).toBe('https://example.com/x')
  })

  it('does not judge a scheme-looking string inside the query', () => {
    expect(accepted('https://example.com/?next=javascript:alert(1)').hostname).toBe('example.com')
  })

  it('accepts an address right at the length limit', () => {
    const prefix = 'https://example.com/'
    expect(accepted(prefix + 'a'.repeat(2048 - prefix.length)).hostname).toBe('example.com')
  })
})

describe('unsafe and unsupported schemes', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'javascript://example.com/%0Aalert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'http://example.com',
    'HTTP://example.com',
    'ftp://example.com/file',
    'file:///etc/passwd',
    'blob:https://example.com/1234',
    'mailto:me@example.com',
    'tel:+15555550123',
    'about:blank',
    'chrome://settings',
    'ws://example.com',
    'wss://example.com',
  ])('refuses %s', input => {
    expect(refusal(input).length).toBeGreaterThan(0)
  })

  it('says why for the common case of http', () => {
    expect(refusal('http://example.com')).toBe('Only https:// addresses are allowed.')
    expect(refusal('javascript:alert(1)')).toBe('Only https:// addresses are allowed.')
  })
})

describe('malformed addresses', () => {
  it.each([
    'example.com',
    'www.example.com/page',
    '//example.com',
    '/relative/path',
    'https://',
    'https:///',
    'https//example.com',
    'htp://example.com',
    '://example.com',
  ])('refuses %j', input => {
    expect(refusal(input).length).toBeGreaterThan(0)
  })

  it('asks for https:// when the address is not an address at all', () => {
    expect(refusal('example.com')).toContain('https://')
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
  ])('refuses an %s string with a clear prompt', (_name, input) => {
    expect(refusal(input)).toBe('Enter a web address.')
  })

  it.each([null, undefined, 42, true, {}, [], ['https://example.com']])('refuses the non-string %j', input => {
    expect(refusal(input)).toBe('Enter a web address.')
  })

  it('refuses spaces, line breaks, tabs and control characters inside the address', () => {
    for (const input of [
      'https://exa mple.com',
      'https://example.com/a b',
      'https://exa\nmple.com',
      'https://example.com/\tx',
      'https://example.com/\u0000',
      'https://example.com/a\u0085b',
      'https://example.com/a\u2028b',
      'https://example.com/\rx',
    ]) {
      expect(refusal(input), JSON.stringify(input)).toContain('cannot contain')
    }
  })

  it('refuses backslashes, which browsers treat as slashes', () => {
    expect(refusal('https:\\\\example.com')).toContain('cannot contain')
    expect(refusal('https://example.com\\@evil.com')).toContain('cannot contain')
  })

  it('refuses an address over 2048 characters', () => {
    const long = 'https://example.com/' + 'a'.repeat(2048)
    expect(refusal(long)).toContain('too long')
  })

  it('refuses empty labels and numeric top-level domains', () => {
    for (const input of ['https://example..com/', 'https://.example.com/', 'https://example.123/']) {
      expect(refusal(input).length, input).toBeGreaterThan(0)
    }
  })
})

describe('credentials', () => {
  it('refuses a user name or password', () => {
    expect(refusal('https://user@example.com/')).toContain('user name or password')
    expect(refusal('https://user:secret@example.com/')).toContain('user name or password')
    expect(refusal('https://:secret@example.com/')).toContain('user name or password')
  })

  it('refuses the look-alike trick where the real host follows an @', () => {
    // The browser connects to evil.example, not to bank.example.
    expect(refusal('https://bank.example@evil.example/')).toContain('user name or password')
  })
})

describe('ports', () => {
  it.each([1, 80, 8080, 8443, 9443, 65535])('accepts the explicit port %i', port => {
    const result = accepted(`https://example.com:${port}/app?x=1#top`)
    expect(result.href).toBe(`https://example.com:${port}/app?x=1#top`)
    expect(result.hostname).toBe('example.com')
  })

  it('accepts a port on a subdomain, without a path, and keeps it in the stored address', () => {
    expect(accepted('https://app.example.org:8443').href).toBe('https://app.example.org:8443/')
  })

  it('drops the default port, so the stored address is the same either way', () => {
    expect(accepted('https://example.com:443/').href).toBe('https://example.com/')
    expect(accepted('https://example.com:00443/').href).toBe('https://example.com/')
  })

  it('refuses port 0, which cannot be connected to', () => {
    expect(refusal('https://example.com:0/')).toBe('A port number must be between 1 and 65535.')
  })

  it.each(['65536', '70000', '99999999', '-1', '8443x', 'abc', '8 443', '1e3'])(
    'refuses the invalid port %s',
    port => {
      expect(refusal(`https://example.com:${port}/`).length).toBeGreaterThan(0)
    },
  )

  it('does not let a port rescue an address the policy otherwise refuses', () => {
    expect(refusal('http://example.com:8443/')).toBe('Only https:// addresses are allowed.')
    expect(refusal('https://127.0.0.1:8443/')).toContain('IP addresses')
    expect(refusal('https://[::1]:8443/')).toContain('IP addresses')
    expect(refusal('https://localhost:8443/')).toContain('private network')
    expect(refusal('https://nas.local:8443/')).toContain('private network')
    expect(refusal('https://user:pw@example.com:8443/')).toContain('user name or password')
    expect(refusal('https://intranet:8443/')).toContain('public website name')
  })

  it('is stable: a stored address with a port passes again unchanged', () => {
    const first = accepted('HTTPS://Example.com:8443/A?b=1#c')
    expect(accepted(first.href)).toEqual(first)
  })
})
describe('hosts visitors cannot or should not reach', () => {
  it.each([
    'https://localhost/',
    'https://LOCALHOST/',
    'https://app.localhost/',
    'https://printer.local/',
    'https://wiki.internal/',
    'https://nas.lan/',
    'https://box.localdomain/',
  ])('refuses the private name %s', input => {
    expect(refusal(input)).toContain('private network')
  })

  it.each([
    'https://127.0.0.1/',
    'https://0.0.0.0/',
    'https://10.0.0.1/',
    'https://192.168.1.1/admin',
    'https://169.254.169.254/latest/meta-data/',
    'https://8.8.8.8/',
    'https://[::1]/',
    'https://[2001:db8::1]/',
    'https://[::ffff:127.0.0.1]/',
  ])('refuses the IP address %s', input => {
    expect(refusal(input)).toContain('IP addresses')
  })

  it('sees through other spellings of an IP address', () => {
    expect(refusal('https://2130706433/')).toContain('IP addresses') // decimal 127.0.0.1
    expect(refusal('https://0x7f.1/')).toContain('IP addresses')
    expect(refusal('https://0177.0.0.1/')).toContain('IP addresses') // octal
  })

  it('refuses a single-label name', () => {
    expect(refusal('https://intranet/')).toContain('public website name')
    expect(refusal('https://example/')).toContain('public website name')
  })
})

describe('the result', () => {
  it('gives the host the browser will connect to', () => {
    const result = accepted('https://Sub.Example.com/page')
    expect(result.hostname).toBe('sub.example.com')
  })

  it('is stable: a stored href passes again unchanged', () => {
    const first = accepted('HTTPS://Example.com/A?b=1#c')
    expect(accepted(first.href)).toEqual(first)
  })
})
