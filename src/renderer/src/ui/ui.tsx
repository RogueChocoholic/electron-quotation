import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import type { MenuItem } from '../doc/context'
import { cx } from '../doc/util'
import { IconCheck, IconX } from './icons'

// ------------------------------------------------------------------ buttons

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  icon?: ReactNode
  small?: boolean
}

export function Button({ variant = 'default', icon, small, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={cx('btn', `btn-${variant}`, small && 'btn-small', className)} {...rest}>
      {icon}
      {children && <span>{children}</span>}
    </button>
  )
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={cx('icon-btn', active && 'is-active', className)}
      title={label}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  )
}

// -------------------------------------------------------------- form fields

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-name">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  invalid,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string
  onChange(value: string): void
  invalid?: boolean
}) {
  return (
    <input
      type="text"
      className={cx('input', invalid && 'is-invalid', className)}
      value={value}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  )
}

/** A number box that lets the user type freely and only reports valid, clamped numbers. */
export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix
}: {
  value: number
  onChange(value: number): void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  const format = (n: number): string => String(Math.round(n * 100) / 100)
  const [text, setText] = useState(format(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(format(value))
  }, [value, focused])

  return (
    <span className="input-wrap">
      <input
        type="number"
        className="input"
        value={text}
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        step={step}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
      />
      {suffix && <span className="input-suffix">{suffix}</span>}
    </span>
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  invalid
}: {
  value: T
  onChange(value: T): void
  options: { value: T; label: string }[]
  invalid?: boolean
}) {
  return (
    <select className={cx('input', invalid && 'is-invalid')} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange(checked: boolean): void
  label: string
  hint?: ReactNode
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange(value: T): void
  options: { value: T; label: ReactNode; title?: string }[]
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          className={cx(o.value === value && 'is-active')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// -------------------------------------------------------------------- modal

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 440
}: {
  title: string
  onClose(): void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <IconX />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

// ----------------------------------------------------------- popup menu host

interface OpenMenu {
  rect: DOMRect
  items: MenuItem[]
}

type MenuOpener = (anchor: Element, items: MenuItem[]) => void
const MenuContext = createContext<MenuOpener>(() => undefined)
export const useMenu = (): MenuOpener => useContext(MenuContext)

function MenuPopup({ menu, onClose }: { menu: OpenMenu; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Position below the anchor, flipping or shifting to stay inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    let left = menu.rect.left
    let top = menu.rect.bottom + 4
    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - width - margin)
    if (top + height > window.innerHeight - margin) top = Math.max(margin, menu.rect.top - height - 4)
    setPos({ left, top })
  }, [menu])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div className="menu-layer" onMouseDown={onClose} onWheel={onClose}>
      <div
        ref={ref}
        className="menu"
        role="menu"
        style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {menu.items.map((item, i) => {
          if (item.separator) return <div key={i} className="menu-sep" />
          if (item.heading) {
            return (
              <div key={i} className="menu-heading">
                {item.label}
              </div>
            )
          }
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={cx('menu-item', item.danger && 'is-danger')}
              disabled={item.disabled}
              onClick={() => {
                onClose()
                item.onSelect?.()
              }}
            >
              <span className="menu-check">{item.checked && <IconCheck />}</span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>,
    document.body
  )
}

// ------------------------------------------------------------------- toasts

export interface ToastAction {
  label: string
  onClick(): void
}

export interface ToastOptions {
  message: string
  kind?: 'info' | 'success' | 'error'
  actions?: ToastAction[]
  /** Milliseconds before the toast disappears. Errors stay longer by default. */
  duration?: number
}

interface ToastEntry extends ToastOptions {
  id: number
}

type Toaster = (options: ToastOptions) => void
const ToastContext = createContext<Toaster>(() => undefined)
export const useToast = (): Toaster => useContext(ToastContext)

// ------------------------------------------------------------------ confirm

export interface ConfirmOptions {
  title: string
  body: ReactNode
  confirmLabel: string
  /** Label of the other button; "Cancel" unless given. */
  cancelLabel?: string
  danger?: boolean
}

type Confirmer = (options: ConfirmOptions) => Promise<boolean>
const ConfirmContext = createContext<Confirmer>(async () => false)
export const useConfirm = (): Confirmer => useContext(ConfirmContext)

// ----------------------------------------------------------------- provider

/** Hosts the app-wide popup menu, toast stack and confirmation dialog. */
export function UiProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve(ok: boolean): void }) | null>(null)
  const nextId = useRef(1)

  const openMenu = useCallback<MenuOpener>((anchor, items) => {
    setMenu({ rect: anchor.getBoundingClientRect(), items })
  }, [])
  const closeMenu = useCallback(() => setMenu(null), [])

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const toast = useCallback<Toaster>(
    (options) => {
      const id = nextId.current++
      setToasts((list) => [...list.slice(-3), { ...options, id }])
      const duration = options.duration ?? (options.kind === 'error' ? 9000 : options.actions ? 8000 : 4000)
      window.setTimeout(() => dismiss(id), duration)
    },
    [dismiss]
  )

  const confirm = useCallback<Confirmer>(
    (options) => new Promise<boolean>((resolve) => setConfirmState({ ...options, resolve })),
    []
  )
  const answer = (ok: boolean): void => {
    confirmState?.resolve(ok)
    setConfirmState(null)
  }

  return (
    <MenuContext.Provider value={openMenu}>
      <ToastContext.Provider value={toast}>
        <ConfirmContext.Provider value={confirm}>
          {children}
          {menu && <MenuPopup menu={menu} onClose={closeMenu} />}
          {confirmState && (
            <Modal
              title={confirmState.title}
              onClose={() => answer(false)}
              footer={
                <>
                  <Button onClick={() => answer(false)}>{confirmState.cancelLabel ?? 'Cancel'}</Button>
                  <Button variant={confirmState.danger ? 'danger' : 'primary'} autoFocus onClick={() => answer(true)}>
                    {confirmState.confirmLabel}
                  </Button>
                </>
              }
            >
              <div className="modal-text">{confirmState.body}</div>
            </Modal>
          )}
          {createPortal(
            <div className="toasts" aria-live="polite">
              {toasts.map((t) => (
                <div key={t.id} className={cx('toast', `toast-${t.kind ?? 'info'}`)}>
                  <span className="toast-message">{t.message}</span>
                  {t.actions?.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      className="toast-action"
                      onClick={() => {
                        a.onClick()
                        dismiss(t.id)
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                  <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                    <IconX />
                  </button>
                </div>
              ))}
            </div>,
            document.body
          )}
        </ConfirmContext.Provider>
      </ToastContext.Provider>
    </MenuContext.Provider>
  )
}
