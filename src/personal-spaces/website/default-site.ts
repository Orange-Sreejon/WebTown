import { DEFAULT_PRESET_ID, themeFromPreset } from './theme-presets'
import { SITE_SCHEMA_VERSION, type SiteContent } from './site-types'

/** "house-a" → "House A". Only used to word the default site. */
export function defaultDisplayName(houseId: string): string {
  const words = houseId.split('-').filter(word => word.length > 0)
  if (words.length === 0) return 'Resident'
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * The website a house has before its owner changes anything.
 *
 * It is complete and valid (a test runs it through `validateSite`) and reads
 * like a late-1990s home page, so every house has something to browse. The
 * sample project and link addresses use `example.com`, which is reserved for
 * documentation and never belongs to anyone.
 *
 * Pure: the clock is passed in. Returns a fresh object on every call.
 */
export function createDefaultSite(houseId: string, updatedAt: string): SiteContent {
  const name = defaultDisplayName(houseId)

  return {
    schemaVersion: SITE_SCHEMA_VERSION,
    houseId,
    updatedAt,
    title: `Welcome to ${name}!`,
    profile: {
      displayName: name,
      tagline: 'Best viewed in WebTown. Thanks for stopping by!',
    },
    home: {
      welcome:
        `Hello, and welcome to my corner of WebTown!\n\n` +
        `Pull up a chair. This is my home page, where I keep the things I am working on ` +
        `and the places on the web I like best. Have a look around, then say hi if you ` +
        `see me in town.\n\n` +
        `This page is still growing, so check back soon.`,
    },
    about: {
      body:
        `My name is ${name}, and I live in WebTown.\n\n` +
        `I like quiet mornings, new ideas and small projects that get finished. ` +
        `I made this page with the computer in my house.\n\n` +
        `Open the sketchbook next to the computer to see what I have been drawing.`,
    },
    projects: [
      {
        id: 'project-1',
        title: 'My first web page',
        description: 'You are looking at it! A home page built one piece at a time.',
        url: null,
      },
      {
        id: 'project-2',
        title: 'Sketchbook doodles',
        description: 'A growing pile of drawings made in WebTown Paint, one pixel at a time.',
        url: null,
      },
      {
        id: 'project-3',
        title: 'A project with a link',
        description: 'A project can point to a page elsewhere on the web. Edit this one.',
        url: 'https://example.com/',
      },
    ],
    links: [
      { id: 'link-1', label: 'An example link (replace me)', url: 'https://example.com/' },
      { id: 'link-2', label: 'Another favourite place', url: 'https://example.org/' },
    ],
    theme: { ...themeFromPreset(DEFAULT_PRESET_ID), underConstruction: true },
  }
}
