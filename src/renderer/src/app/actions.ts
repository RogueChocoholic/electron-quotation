import { todayStr, uid } from '@shared/calc'
import { buildBlankTemplate } from '@shared/seed'
import type { QDoc } from '@shared/types'

async function load(id: string): Promise<QDoc> {
  const doc = await window.api.docs.get(id)
  if (!doc) throw new Error('The document could not be found. It may have been deleted.')
  return doc
}

function fresh(): Pick<QDoc, 'id' | 'createdAt' | 'updatedAt'> {
  const now = new Date().toISOString()
  return { id: uid(), createdAt: now, updatedAt: now }
}

/** Creates a quotation from a template, or as a copy of another quotation. */
export async function createQuotation(sourceId: string, number: string, accountId: string | null): Promise<QDoc> {
  const source = await load(sourceId)
  return window.api.docs.save({
    ...source,
    ...fresh(),
    kind: 'quotation',
    name: '',
    number,
    date: todayStr(),
    accountId
  })
}

export async function duplicateTemplate(id: string): Promise<QDoc> {
  const source = await load(id)
  return window.api.docs.save({ ...source, ...fresh(), kind: 'template', name: `${source.name || 'Template'} copy` })
}

export async function saveAsTemplate(doc: QDoc): Promise<QDoc> {
  return window.api.docs.save({
    ...doc,
    ...fresh(),
    kind: 'template',
    name: doc.number ? `Template from ${doc.number}` : 'New template',
    number: '',
    date: ''
  })
}

export async function createBlankTemplate(accountId: string | null): Promise<QDoc> {
  return window.api.docs.save(buildBlankTemplate(accountId))
}
