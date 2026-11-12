/** Phaser scene keys. Use these instead of raw strings in new code. */
export const SceneKeys = {
  BOOT: 'BootScene',
  TOWN: 'TownScene',
  INTERIOR: 'InteriorScene',
} as const

export type SceneKey = (typeof SceneKeys)[keyof typeof SceneKeys]
