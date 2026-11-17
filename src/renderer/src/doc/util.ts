import type { AssetId } from '@shared/types'

/** CSS pixels per millimetre at 100% zoom. */
export const PX_PER_MM = 96 / 25.4

export const mm = (value: number): string => `${value}mm`
export const pt = (value: number): string => `${value}pt`

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function assetUrl(id: AssetId): string {
  return `qasset://a/${encodeURIComponent(id)}`
}

export const round1 = (n: number): number => Math.round(n * 10) / 10
