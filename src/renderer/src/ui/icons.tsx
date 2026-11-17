import type { ReactNode } from 'react'

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const dot = (cx: number, cy: number, r = 1) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />

export const IconPlus = () => (
  <Svg>
    <path d="M8 3v10M3 8h10" />
  </Svg>
)
export const IconX = () => (
  <Svg>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
)
export const IconCheck = () => (
  <Svg>
    <path d="M3 8.5l3.2 3.2L13 5" />
  </Svg>
)
export const IconChevronLeft = () => (
  <Svg>
    <path d="M10 3L5 8l5 5" />
  </Svg>
)
export const IconMore = () => <Svg>{[dot(3.5, 8, 1.15), dot(8, 8, 1.15), dot(12.5, 8, 1.15)]}</Svg>
export const IconTrash = () => (
  <Svg>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Svg>
)
export const IconCopy = () => (
  <Svg>
    <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" />
    <path d="M10.5 5.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5" />
  </Svg>
)
export const IconDoc = () => (
  <Svg>
    <path d="M4 2h5.5l3 3v9H4z" />
    <path d="M9.5 2v3h3M6 8.5h4.5M6 11h4.5" />
  </Svg>
)
export const IconTemplate = () => (
  <Svg>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M2.5 6h11M6.5 6v7.5" />
  </Svg>
)
export const IconSettings = () => (
  <Svg>
    <path d="M3 5h10M3 11h10" />
    <circle cx="6" cy="5" r="1.7" fill="var(--icon-fill, #fff)" />
    <circle cx="10" cy="11" r="1.7" fill="var(--icon-fill, #fff)" />
  </Svg>
)
export const IconSearch = () => (
  <Svg>
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10l3.5 3.5" />
  </Svg>
)
export const IconDownload = () => (
  <Svg>
    <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />
  </Svg>
)
export const IconUpload = () => (
  <Svg>
    <path d="M8 11V3M4.5 6L8 2.5 11.5 6M3 13.5h10" />
  </Svg>
)
export const IconImage = () => (
  <Svg>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <circle cx="6" cy="6.5" r="1" />
    <path d="M3 11.5l3-3 2.5 2.5 2-2 2.5 2.5" />
  </Svg>
)
export const IconAlignLeft = () => (
  <Svg>
    <path d="M3 4h10M3 8h6M3 12h8" />
  </Svg>
)
export const IconAlignCenter = () => (
  <Svg>
    <path d="M3 4h10M5 8h6M4 12h8" />
  </Svg>
)
export const IconAlignRight = () => (
  <Svg>
    <path d="M3 4h10M7 8h6M5 12h8" />
  </Svg>
)
export const IconAlignJustify = () => (
  <Svg>
    <path d="M3 4h10M3 8h10M3 12h10" />
  </Svg>
)
export const IconRefresh = () => (
  <Svg>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M13 2.8v2.7h-2.7" />
  </Svg>
)
export const IconBank = () => (
  <Svg>
    <path d="M2.5 6.5L8 3l5.5 3.5M3.5 6.5h9M4.5 7v4.5M8 7v4.5M11.5 7v4.5M3 13h10" />
  </Svg>
)
export const IconLock = () => (
  <Svg>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
  </Svg>
)
export const IconFolder = () => (
  <Svg>
    <path d="M2.5 4.5h4l1.2 1.5h5.8v7h-11z" />
  </Svg>
)
export const IconArrowUp = () => (
  <Svg>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
)
export const IconArrowDown = () => (
  <Svg>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Svg>
)
export const IconMinus = () => (
  <Svg>
    <path d="M3 8h10" />
  </Svg>
)
export const IconInfo = () => (
  <Svg>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 7.3v3.6" />
    {dot(8, 5.2, 0.8)}
  </Svg>
)
