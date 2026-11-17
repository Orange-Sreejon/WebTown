import { describe, expect, it } from 'vitest'
import { createDefaultSite } from './default-site'
import { SITE_LIMITS, type SiteContent } from './site-types'
import { errorMessages, isIsoUtc, validateSite, type FieldError } from './site-validation'

const NOW = '2026-11-16T12:00:00.000Z'

/** A valid site to damage one field at a time. */
function site(): SiteContent {
  return createDefaultSite('house-a', NOW)
}

/** Runs `change` on a fresh valid site and validates the result. */
function check(change: (s: SiteContent) => void): ReturnType<typeof validateSite> {
  const s = site()
  change(s)
  return validateSite(s)
}

function errorsOf(change: (s: SiteContent) => void): FieldError[] {
  const result = check(change)
  if (result.ok) throw new Error('expected the site to be refused')
  return result.errors
}

const at = (errors: FieldError[], path: string): FieldError | undefined =>
  errors.find(e => e.path === path)

/** A loose view for damaging fields the types would not allow. */
type Loose = Record<string, unknown>
const loose = (s: SiteContent): Loose => s as unknown as Loose

describe('a valid site', () => {
  it('passes unchanged, with the same content', () => {
    const result = validateSite(site())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(site())
  })

  it('allows the optional fields to be empty', () => {
    const result = check(s => {
      s.profile.tagline = ''
      s.about.body = ''
      s.projects = []
      s.links = []
      s.projects.push({ id: 'p', title: 'Bare', description: '', url: null })
    })
    expect(result.ok).toBe(true)
  })

  it('allows a site with no projects and no links', () => {
    expect(check(s => { s.projects = []; s.links = [] }).ok).toBe(true)
  })
})

describe('input that is not a site', () => {
  it.each([null, undefined, 'site', 42, true, [], [site()]])('refuses %j', input => {
    const result = validateSite(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([{ path: '', message: 'The website data is missing or damaged.' }])
    }
  })

  it('refuses another schema version', () => {
    const e = errorsOf(s => { loose(s)['schemaVersion'] = 2 })
    expect(at(e, 'schemaVersion')?.message).toContain('different version')
    expect(errorsOf(s => { delete loose(s)['schemaVersion'] }).length).toBeGreaterThan(0)
  })
})

describe('required fields', () => {
  it.each([
    ['title', (s: SiteContent) => { s.title = '' }, 'The site title is required.'],
    ['title', (s: SiteContent) => { s.title = '   \n\t ' }, 'The site title is required.'],
    ['title', (s: SiteContent) => { delete loose(s)['title'] }, 'The site title is required.'],
    ['profile.displayName', (s: SiteContent) => { s.profile.displayName = '' }, 'Your name is required.'],
    ['home.welcome', (s: SiteContent) => { s.home.welcome = ' ' }, 'The welcome message is required.'],
  ])('reports a missing %s', (path, change, message) => {
    expect(at(errorsOf(change), path)?.message).toBe(message)
  })

  it('reports a project without a title and a link without a name or address', () => {
    const e = errorsOf(s => {
      s.projects[0]!.title = ''
      s.links[0]!.label = ''
      s.links[0]!.url = ''
    })
    expect(at(e, 'projects[0].title')?.message).toBe('Project 1 title is required.')
    expect(at(e, 'links[0].label')?.message).toBe('Link 1 name is required.')
    expect(at(e, 'links[0].url')?.message).toContain('Enter a web address.')
  })

  it.each(['profile', 'home', 'about', 'theme', 'projects', 'links'])('reports a missing %s section', key => {
    const e = errorsOf(s => { delete loose(s)[key] })
    expect(e.some(x => x.path === key || x.path.startsWith(`${key}.`))).toBe(true)
  })

  it('reports a field of the wrong type instead of throwing', () => {
    const e = errorsOf(s => {
      loose(s)['title'] = 42
      s.profile.displayName = { text: 'x' } as unknown as string
      s.about.body = ['a'] as unknown as string
    })
    expect(at(e, 'title')?.message).toBe('The site title must be text.')
    expect(at(e, 'profile.displayName')?.message).toBe('Your name must be text.')
    expect(at(e, 'about.body')?.message).toBe('The About text must be text.')
  })

  it('reports damaged list entries', () => {
    const e = errorsOf(s => {
      s.projects = [null as unknown as SiteContent['projects'][0]]
      s.links = ['x' as unknown as SiteContent['links'][0]]
    })
    expect(at(e, 'projects[0]')?.message).toBe('Project 1 is damaged.')
    expect(at(e, 'links[0]')?.message).toBe('Link 1 is damaged.')
  })

  it('reports every problem in one pass', () => {
    const e = errorsOf(s => {
      s.title = ''
      s.profile.displayName = ''
      s.home.welcome = ''
      s.theme.text = 'red'
      s.links[0]!.url = 'http://example.com'
    })
    expect(e.map(x => x.path)).toEqual(
      expect.arrayContaining(['title', 'profile.displayName', 'home.welcome', 'theme.text', 'links[0].url']),
    )
  })
})

describe('length limits', () => {
  const limitCases: Array<[string, string, number, (s: SiteContent, text: string) => void]> = [
    ['title', 'title', SITE_LIMITS.title.max, (s, t) => { s.title = t }],
    ['profile.displayName', 'displayName', SITE_LIMITS.displayName.max, (s, t) => { s.profile.displayName = t }],
    ['profile.tagline', 'tagline', SITE_LIMITS.tagline.max, (s, t) => { s.profile.tagline = t }],
    ['home.welcome', 'welcome', SITE_LIMITS.welcome.max, (s, t) => { s.home.welcome = t }],
    ['about.body', 'aboutBody', SITE_LIMITS.aboutBody.max, (s, t) => { s.about.body = t }],
    ['projects[0].title', 'projectTitle', SITE_LIMITS.projectTitle.max, (s, t) => { s.projects[0]!.title = t }],
    [
      'projects[0].description', 'projectDescription', SITE_LIMITS.projectDescription.max,
      (s, t) => { s.projects[0]!.description = t },
    ],
    ['links[0].label', 'linkLabel', SITE_LIMITS.linkLabel.max, (s, t) => { s.links[0]!.label = t }],
  ]

  it.each(limitCases)('%s accepts exactly its maximum and refuses one more', (path, _key, max, set) => {
    expect(check(s => set(s, 'x'.repeat(max))).ok).toBe(true)

    const e = errorsOf(s => set(s, 'x'.repeat(max + 1)))
    const message = at(e, path)?.message ?? ''
    expect(message).toContain('too long')
    expect(message).toContain(String(max + 1))
    expect(message).toContain(`limit is ${max}`)
  })

  it('counts an emoji as one character', () => {
    expect(check(s => { s.title = '😀'.repeat(SITE_LIMITS.title.max) }).ok).toBe(true)
    expect(check(s => { s.title = '😀'.repeat(SITE_LIMITS.title.max + 1) }).ok).toBe(false)
  })

  it('measures the cleaned text, not the raw text', () => {
    // 60 visible characters padded with spaces and a control character.
    expect(check(s => { s.title = `   ${'x'.repeat(59)}\u0000x   ` }).ok).toBe(true)
  })

  it('accepts one project over the count limit as an error, and exactly the limit as fine', () => {
    const project = (i: number): SiteContent['projects'][0] =>
      ({ id: `p-${i}`, title: `P${i}`, description: '', url: null })
    expect(check(s => { s.projects = Array.from({ length: SITE_LIMITS.maxProjects }, (_, i) => project(i)) }).ok)
      .toBe(true)
    const e = errorsOf(s => { s.projects = Array.from({ length: SITE_LIMITS.maxProjects + 1 }, (_, i) => project(i)) })
    expect(at(e, 'projects')?.message).toBe('Too many projects: 13, the limit is 12.')
  })

  it('does the same for links', () => {
    const link = (i: number): SiteContent['links'][0] =>
      ({ id: `l-${i}`, label: `L${i}`, url: 'https://example.com/' })
    expect(check(s => { s.links = Array.from({ length: SITE_LIMITS.maxLinks }, (_, i) => link(i)) }).ok).toBe(true)
    const e = errorsOf(s => { s.links = Array.from({ length: SITE_LIMITS.maxLinks + 1 }, (_, i) => link(i)) })
    expect(at(e, 'links')?.message).toBe('Too many links: 21, the limit is 20.')
  })

  it('does not return entries beyond the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `p-${i}`, title: `P${i}`, description: '', url: null }))
    const result = check(s => { s.projects = many })
    expect(result.ok).toBe(false)
  })
})

describe('plain text, shown literally', () => {
  const HOSTILE = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<b>bold</b>',
    '<a href="javascript:alert(1)">x</a>',
    '<!-- hidden -->',
    '<iframe src="https://example.com"></iframe>',
    '&lt;script&gt;',
    '3 < 5 and 7 > 2',
  ]

  it.each(HOSTILE)('accepts %s and keeps it exactly as typed', text => {
    const result = check(s => { s.title = text })
    expect(result.ok && result.value.title).toBe(text)
  })

  it('does so in every text field, without changing a character', () => {
    const text = '<script>alert(1)</script>'
    const result = check(s => {
      s.profile.displayName = text
      s.profile.tagline = text
      s.home.welcome = text
      s.about.body = text
      s.projects[0]!.title = text
      s.projects[0]!.description = text
      s.links[0]!.label = text
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.profile.displayName).toBe(text)
    expect(result.value.profile.tagline).toBe(text)
    expect(result.value.home.welcome).toBe(text)
    expect(result.value.about.body).toBe(text)
    expect(result.value.projects[0]!.title).toBe(text)
    expect(result.value.projects[0]!.description).toBe(text)
    expect(result.value.links[0]!.label).toBe(text)
  })

  it('counts the literal characters toward the limit', () => {
    // `<b>` and `</b>` are 3 + 4 characters, so 53 more makes exactly 60.
    expect(check(s => { s.title = `<b>${'x'.repeat(53)}</b>` }).ok).toBe(true)
    expect(check(s => { s.title = `<b>${'x'.repeat(54)}</b>` }).ok).toBe(false)
  })

  it('keeps the words javascript: and data: in text; only links are policed', () => {
    const result = check(s => { s.about.body = 'Never click javascript:alert(1) or data:text/html links.' })
    expect(result.ok).toBe(true)
  })

  it('has no field that can carry markup, style or script', () => {
    const result = validateSite({ ...site(), html: '<b>x</b>', style: 'body{}', script: 'alert(1)' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(Object.keys(site()).sort())
    }
  })
})
describe('cleaning', () => {
  it('trims and strips control characters from the result', () => {
    const result = check(s => { s.title = '  Hi\u0000 there\u202E  ' })
    expect(result.ok && result.value.title).toBe('Hi there')
  })

  it('turns line breaks in a single-line field into spaces', () => {
    const result = check(s => { s.title = 'One\nTwo' })
    expect(result.ok && result.value.title).toBe('One Two')
  })

  it('keeps paragraphs in multi-line fields and normalises the breaks', () => {
    const result = check(s => { s.home.welcome = 'One\r\n\r\n\r\n\r\nTwo' })
    expect(result.ok && result.value.home.welcome).toBe('One\n\nTwo')
  })
})

describe('external links', () => {
  it('stores the normalised https address', () => {
    const result = check(s => {
      s.links[0]!.url = 'HTTPS://Example.com/Path?x=1#frag'
      s.projects[2]!.url = 'https://example.org'
    })
    expect(result.ok && result.value.links[0]!.url).toBe('https://example.com/Path?x=1#frag')
    expect(result.ok && result.value.projects[2]!.url).toBe('https://example.org/')
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<b>x</b>'],
    ['http://example.com'],
    ['ftp://example.com'],
    ['example.com'],
    ['https://localhost/'],
    ['https://user:pw@example.com/'],
  ])('refuses the link %s, with its position and a reason', url => {
    const e = errorsOf(s => { s.links[1]!.url = url; s.projects[2]!.url = url })
    expect(at(e, 'links[1].url')?.message).toMatch(/^Link 2 address: /)
    expect(at(e, 'projects[2].url')?.message).toMatch(/^Project 3 link: /)
  })

  it('accepts a link with an explicit https port', () => {
    const result = check(s => { s.links[0]!.url = 'https://example.com:8443/app?x=1#top' })
    expect(result.ok && result.value.links[0]!.url).toBe('https://example.com:8443/app?x=1#top')
    expect(errorsOf(s => { s.links[0]!.url = 'https://example.com:0/' })[0]!.message).toContain('between 1 and 65535')
  })

  it('treats a project with no link as fine, and an empty string as no link', () => {
    const result = check(s => { s.projects[0]!.url = ''; s.projects[1]!.url = '   ' })
    expect(result.ok && result.value.projects.slice(0, 2).map(p => p.url)).toEqual([null, null])
  })

  it('requires an address on every link', () => {
    const e = errorsOf(s => { delete (s.links[0] as unknown as Loose)['url'] })
    expect(at(e, 'links[0].url')?.message).toContain('Enter a web address.')
  })

  it('refuses an overlong address', () => {
    const e = errorsOf(s => { s.links[0]!.url = 'https://example.com/' + 'a'.repeat(2048) })
    expect(at(e, 'links[0].url')?.message).toContain('too long')
  })
})

describe('entry ids', () => {
  it('refuses duplicates', () => {
    const e = errorsOf(s => { s.projects[1]!.id = s.projects[0]!.id; s.links[1]!.id = s.links[0]!.id })
    expect(at(e, 'projects[1].id')?.message).toBe('Project 2 shares an id with another entry.')
    expect(at(e, 'links[1].id')?.message).toBe('Link 2 shares an id with another entry.')
  })

  it('allows the same id in projects and links', () => {
    expect(check(s => { s.projects[0]!.id = 'shared'; s.links[0]!.id = 'shared' }).ok).toBe(true)
  })

  it.each(['', 'Has Space', 'UPPER', '-lead', 'a'.repeat(41), 'x/y', '<b>'])('refuses the id %j', id => {
    const e = errorsOf(s => { s.projects[0]!.id = id })
    expect(at(e, 'projects[0].id')?.message).toBe('Project 1 has a missing or invalid id.')
  })
})

describe('house and date', () => {
  it.each(['', 'House A', 'house_a', 'a'.repeat(41), 'HOUSE-A', 'house a'])('refuses the house id %j', id => {
    expect(at(errorsOf(s => { s.houseId = id }), 'houseId')?.message).toBe(
      'The website is not attached to a valid house.',
    )
  })

  it.each(['house-a', 'h', 'a'.repeat(40), '1-2-3'])('accepts the house id %j', id => {
    expect(check(s => { s.houseId = id }).ok).toBe(true)
  })

  it.each(['yesterday', '', '2026-11-16', '2026-11-16T12:00:00', '2026-11-16T12:00:00+01:00', '2026-13-45T00:00:00Z'])(
    'refuses the date %j',
    value => {
      expect(at(errorsOf(s => { s.updatedAt = value }), 'updatedAt')).toBeDefined()
    },
  )

  it('accepts ISO dates with and without milliseconds', () => {
    expect(isIsoUtc('2026-11-16T12:00:00Z')).toBe(true)
    expect(isIsoUtc('2026-11-16T12:00:00.5Z')).toBe(true)
    expect(isIsoUtc('2026-11-16T12:00:00.123Z')).toBe(true)
    expect(isIsoUtc('2026-02-31T12:00:00Z')).toBe(false)
  })
})

describe('colours', () => {
  const colourFields = ['background', 'text', 'link', 'headerBackground', 'headerText'] as const

  it.each(colourFields)('refuses an invalid %s colour', field => {
    for (const bad of ['red', '#FFF', '#GGGGGG', 'rgb(0,0,0)', '#12345678', '', 7, null]) {
      const e = errorsOf(s => { (s.theme as unknown as Loose)[field] = bad })
      expect(at(e, `theme.${field}`)?.message, `${field}=${String(bad)}`).toContain('#RRGGBB')
    }
  })

  it('reports a missing colour', () => {
    const e = errorsOf(s => { delete (s.theme as unknown as Loose)['link'] })
    expect(at(e, 'theme.link')?.message).toContain('#RRGGBB')
  })

  it('stores colours in upper case', () => {
    const result = check(s => {
      s.theme.background = '#ffffff'
      s.theme.text = '#000000'
      s.theme.link = '#0000ee'
    })
    expect(result.ok && result.value.theme.background).toBe('#FFFFFF')
    expect(result.ok && result.value.theme.link).toBe('#0000EE')
  })

  it('does not also complain about contrast when a colour itself is invalid', () => {
    const e = errorsOf(s => { s.theme.text = 'nope' })
    expect(e.filter(x => x.path === 'theme.text')).toHaveLength(1)
  })
})

describe('contrast rules', () => {
  const withColours = (bg: string, text: string, link: string): ((s: SiteContent) => void) =>
    s => { s.theme.background = bg; s.theme.text = text; s.theme.link = link }

  it('accepts body text at just over 4.5:1', () => {
    expect(check(withColours('#FFFFFF', '#767676', '#0000EE')).ok).toBe(true) // 4.54
  })

  it('refuses body text at just under 4.5:1, naming the numbers', () => {
    const e = errorsOf(withColours('#FFFFFF', '#777777', '#0000EE')) // 4.48
    const message = at(e, 'theme.text')?.message ?? ''
    expect(message).toContain('Text colour')
    expect(message).toContain('4.47:1')
    expect(message).toContain('at least 4.5:1')
  })

  it('applies the 4.5:1 rule to links as well', () => {
    expect(check(withColours('#FFFFFF', '#000000', '#767676')).ok).toBe(true)
    expect(at(errorsOf(withColours('#FFFFFF', '#000000', '#777777')), 'theme.link')).toBeDefined()
  })

  it('refuses identical text and background', () => {
    expect(at(errorsOf(withColours('#336699', '#336699', '#FFFFFF')), 'theme.text')).toBeDefined()
  })

  it('holds the banner title to the large-text 3:1, not 4.5:1', () => {
    const banner = (bg: string, text: string): ((s: SiteContent) => void) =>
      s => { s.theme.headerBackground = bg; s.theme.headerText = text }

    expect(check(banner('#FFFFFF', '#949494')).ok).toBe(true) // 3.03: fine for a large title
    const e = errorsOf(banner('#FFFFFF', '#959595')) // 2.99
    const message = at(e, 'theme.headerText')?.message ?? ''
    expect(message).toContain('2.99:1')
    expect(message).toContain('at least 3:1')
  })

  it('reports all failing pairs together', () => {
    const e = errorsOf(s => {
      s.theme.background = '#FFFFFF'
      s.theme.text = '#EEEEEE'
      s.theme.link = '#EEEEEE'
      s.theme.headerBackground = '#FFFFFF'
      s.theme.headerText = '#EEEEEE'
    })
    expect(e.map(x => x.path)).toEqual(['theme.text', 'theme.link', 'theme.headerText'])
  })

  it('checks the colours even when the preset says otherwise', () => {
    const e = errorsOf(s => { s.theme.preset = 'classic-grey'; s.theme.background = '#FFFFFF'; s.theme.text = '#C0C0C0' })
    expect(at(e, 'theme.text')).toBeDefined()
  })
})

describe('theme choices', () => {
  it('refuses an unknown preset, font or pattern, and lists the choices', () => {
    const e = errorsOf(s => {
      loose(s)['theme'] = { ...s.theme, preset: 'neon', font: 'comic-sans', pattern: 'animated-gif' }
    })
    expect(at(e, 'theme.preset')?.message).toBe('Theme must be one of: classic-grey, starfield, pastel, forest, custom.')
    expect(at(e, 'theme.font')?.message).toBe('Font must be one of: serif, sans, mono.')
    expect(at(e, 'theme.pattern')?.message).toBe('Background pattern must be one of: plain, dots, grid, stars.')
  })

  it('refuses CSS and font stacks smuggled in as a font', () => {
    expect(errorsOf(s => { loose(s)['theme'] = { ...s.theme, font: 'Arial, sans-serif' } }).length).toBeGreaterThan(0)
    expect(errorsOf(s => { loose(s)['theme'] = { ...s.theme, font: 'x; background:url(//evil)' } }).length)
      .toBeGreaterThan(0)
  })

  it('requires "under construction" to be a real boolean', () => {
    for (const bad of ['yes', 1, null, undefined]) {
      const e = errorsOf(s => { loose(s)['theme'] = { ...s.theme, underConstruction: bad } })
      expect(at(e, 'theme.underConstruction')).toBeDefined()
    }
    expect(check(s => { s.theme.underConstruction = false }).ok).toBe(true)
  })

  it('drops unknown theme properties such as custom CSS', () => {
    const result = validateSite({ ...site(), theme: { ...site().theme, customCss: 'body{display:none}' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect('customCss' in result.value.theme).toBe(false)
  })
})

describe('isolation', () => {
  it('never changes the input', () => {
    const input = site()
    input.title = '  padded  '
    input.theme.background = '#ffffff'
    const before = JSON.stringify(input)
    validateSite(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('returns a copy that shares nothing with the input', () => {
    const input = site()
    const result = validateSite(input)
    if (!result.ok) throw new Error('expected a valid site')

    result.value.profile.displayName = 'Changed'
    result.value.projects[0]!.title = 'Changed'
    result.value.links.push({ id: 'new', label: 'New', url: 'https://example.com/' })
    result.value.theme.text = '#123456'

    expect(input).toEqual(site())
    expect(result.value.projects).not.toBe(input.projects)
    expect(result.value.theme).not.toBe(input.theme)
  })

  it('survives hostile input shapes without throwing or polluting prototypes', () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},' +
        '"schemaVersion":1,"title":"x","profile":{"__proto__":{"polluted":true}}}',
    ) as unknown
    expect(() => validateSite(hostile)).not.toThrow()
    expect(({} as Loose)['polluted']).toBeUndefined()
  })
})

describe('error messages', () => {
  it('gives every error a path and a sentence', () => {
    const e = errorsOf(s => { s.title = ''; s.theme.text = 'x'; s.links[0]!.url = 'http://x.com' })
    for (const error of e) {
      expect(typeof error.path).toBe('string')
      expect(error.message.length).toBeGreaterThan(10)
      expect(error.message).toMatch(/[.!]$/)
      expect(error.message).not.toMatch(/undefined|NaN|\[object/)
    }
  })

  it('lists just the messages on request', () => {
    expect(errorMessages([{ path: 'a', message: 'One.' }, { path: 'b', message: 'Two.' }])).toEqual(['One.', 'Two.'])
  })
})
