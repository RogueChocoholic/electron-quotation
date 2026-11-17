import { useState } from 'react'
import { peekNumber, uid } from '@shared/calc'
import type { Account, Numbering, UpdateStatus } from '@shared/types'
import { formatWhen, useApp } from '../app/context'
import { IconBank, IconFolder, IconPlus, IconRefresh } from '../ui/icons'
import { Button, Field, Modal, NumberInput, TextInput, Toggle, useConfirm } from '../ui/ui'

export function updateText(u: UpdateStatus): string {
  switch (u.state) {
    case 'dev':
      return 'Updates are only checked in the installed app, not in development mode.'
    case 'idle':
      return 'Not checked yet.'
    case 'checking':
      return 'Checking for updates...'
    case 'downloading':
      return `Downloading version ${u.version ?? ''}${u.percent ? ` (${u.percent}%)` : ''}...`
    case 'ready':
      return `Version ${u.version ?? ''} is downloaded and ready to install.`
    case 'none':
      return u.message ?? 'You have the latest version.'
    case 'error':
      return u.message ?? 'The update check failed.'
  }
}

function AccountDialog({
  initial,
  onSave,
  onClose
}: {
  initial: Account
  onSave(account: Account): void
  onClose(): void
}) {
  const [a, setA] = useState(initial)
  const set = (patch: Partial<Account>): void => setA((prev) => ({ ...prev, ...patch }))
  const filled = [a.holder, a.number, a.bank].some((v) => v.trim() !== '')

  const save = (): void => {
    const fallback = [a.bank.trim(), a.branch.trim()].filter(Boolean).join(' - ') || a.holder.trim() || 'Bank account'
    onSave({ ...a, name: a.name.trim() || fallback })
  }

  return (
    <Modal
      title={initial.holder || initial.number ? 'Edit bank account' : 'Add bank account'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!filled} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="form">
        <Field label="Account holder">
          <TextInput value={a.holder} autoFocus onChange={(holder) => set({ holder })} />
        </Field>
        <Field label="Account number">
          <TextInput value={a.number} onChange={(number) => set({ number })} />
        </Field>
        <div className="form-row">
          <Field label="Bank">
            <TextInput value={a.bank} onChange={(bank) => set({ bank })} />
          </Field>
          <Field label="Branch">
            <TextInput value={a.branch} onChange={(branch) => set({ branch })} />
          </Field>
        </div>
        <Field label="Name in the app" hint="Only shown when choosing an account. Left empty, the bank and branch are used.">
          <TextInput value={a.name} onChange={(name) => set({ name })} />
        </Field>
      </div>
    </Modal>
  )
}

export function SettingsView() {
  const { settings, saveSettings, info, update } = useApp()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Account | null>(null)
  const [checking, setChecking] = useState(false)

  const n = settings.numbering
  const setNumbering = (patch: Partial<Numbering>): void =>
    saveSettings({ ...settings, numbering: { ...settings.numbering, ...patch } })

  const saveAccount = (account: Account): void => {
    const exists = settings.accounts.some((a) => a.id === account.id)
    const accounts = exists
      ? settings.accounts.map((a) => (a.id === account.id ? account : a))
      : [...settings.accounts, account]
    saveSettings({ ...settings, accounts, defaultAccountId: settings.defaultAccountId ?? account.id })
    setEditing(null)
  }

  const removeAccount = async (account: Account): Promise<void> => {
    const ok = await confirm({
      title: 'Delete bank account',
      body: (
        <>
          Delete <strong>{account.name}</strong>? Quotations and templates that use it will show no bank details until
          another account is chosen.
        </>
      ),
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    const accounts = settings.accounts.filter((a) => a.id !== account.id)
    saveSettings({
      ...settings,
      accounts,
      defaultAccountId:
        settings.defaultAccountId === account.id ? (accounts[0]?.id ?? null) : settings.defaultAccountId
    })
  }

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      await window.api.update.check()
    } finally {
      setChecking(false)
    }
  }

  const busy = checking || update.state === 'checking' || update.state === 'downloading'

  return (
    <div className="view view-narrow">
      <header className="view-head">
        <div>
          <h1>Settings</h1>
        </div>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Bank accounts</h2>
            <p>
              Account details are entered once here. On a quotation you only choose which account to show; the details
              cannot be typed over on the page.
            </p>
          </div>
          <Button
            icon={<IconPlus />}
            onClick={() => setEditing({ id: uid(), name: '', holder: '', number: '', bank: '', branch: '' })}
          >
            Add account
          </Button>
        </div>
        {settings.accounts.length === 0 ? (
          <div className="panel muted">No bank accounts yet.</div>
        ) : (
          <div className="panel rows">
            {settings.accounts.map((a) => (
              <div className="row" key={a.id}>
                <span className="row-icon">
                  <IconBank />
                </span>
                <div className="row-main">
                  <div className="row-title">
                    {a.name}
                    {settings.defaultAccountId === a.id && <span className="badge">Default</span>}
                  </div>
                  <div className="row-sub">{[a.holder, a.number, a.bank, a.branch].filter(Boolean).join(' · ')}</div>
                </div>
                {settings.defaultAccountId !== a.id && (
                  <Button small variant="ghost" onClick={() => saveSettings({ ...settings, defaultAccountId: a.id })}>
                    Make default
                  </Button>
                )}
                <Button small variant="ghost" onClick={() => setEditing(a)}>
                  Edit
                </Button>
                <Button small variant="ghost" onClick={() => void removeAccount(a)}>
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Quotation numbering</h2>
            <p>These can also be changed when creating a quotation.</p>
          </div>
        </div>
        <div className="panel form">
          <Toggle
            checked={n.auto}
            onChange={(auto) => setNumbering({ auto })}
            label="Generate quotation numbers automatically"
            hint={
              n.auto
                ? 'A new quotation gets the next number. You can still change it by hand.'
                : 'Off: a number must be typed for every new quotation.'
            }
          />
          {n.auto && (
            <>
              <div className="form-row">
                <Field label="Prefix">
                  <TextInput value={n.prefix} maxLength={24} onChange={(prefix) => setNumbering({ prefix })} />
                </Field>
                <Field label="Digits in the counter">
                  <NumberInput
                    value={n.digits}
                    min={1}
                    max={12}
                    onChange={(digits) => setNumbering({ digits: Math.round(digits) })}
                  />
                </Field>
                <Field label="Next counter value">
                  <NumberInput
                    value={peekNumber(n).seq}
                    min={1}
                    max={999999999}
                    onChange={(seq) => setNumbering({ nextSeq: Math.round(seq), seqYear: new Date().getFullYear() })}
                  />
                </Field>
              </div>
              <Toggle
                checked={n.includeYear}
                onChange={(includeYear) => setNumbering({ includeYear })}
                label="Put the 2-digit year after the prefix"
              />
              {n.includeYear && (
                <Toggle
                  checked={n.yearlyReset}
                  onChange={(yearlyReset) => setNumbering({ yearlyReset })}
                  label="Restart the counter at 1 each year"
                />
              )}
              <div className="callout">
                The next quotation will be numbered <strong>{peekNumber(n).number}</strong>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Updates</h2>
            <p>
              The app checks for a new release shortly after it starts and every few hours. A new version downloads in
              the background and is installed the next time the app restarts.
            </p>
          </div>
        </div>
        <div className="panel rows">
          <div className="row">
            <div className="row-main">
              <div className="row-title">Version {info?.version ?? ''}</div>
              <div className="row-sub">
                {updateText(update)}
                {update.checkedAt ? ` Last checked ${formatWhen(update.checkedAt)}.` : ''}
              </div>
            </div>
            {update.state === 'ready' ? (
              <Button variant="primary" onClick={() => void window.api.update.install()}>
                Restart and install
              </Button>
            ) : (
              <Button icon={<IconRefresh />} disabled={busy || update.state === 'dev'} onClick={() => void check()}>
                Check now
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Data</h2>
            <p>Quotations, templates, images and settings are stored on this PC and are kept when the app updates.</p>
          </div>
        </div>
        <div className="panel rows">
          <div className="row">
            <div className="row-main">
              <div className="row-title">Data folder</div>
              <div className="row-sub mono">{info?.dataPath ?? ''}</div>
            </div>
            <Button icon={<IconFolder />} onClick={() => void window.api.app.openDataFolder()}>
              Open folder
            </Button>
          </div>
        </div>
      </section>

      {editing && <AccountDialog initial={editing} onSave={saveAccount} onClose={() => setEditing(null)} />}
    </div>
  )
}
