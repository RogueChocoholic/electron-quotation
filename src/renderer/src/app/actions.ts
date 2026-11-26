import { NEWER_DATA_MESSAGE, isNewerData, todayStr, uid } from '@shared/calc'
import { buildBlankTemplate } from '@shared/seed'
import type { DocType, QDoc } from '@shared/types'

async function load(id: string): Promise<QDoc> {
  const doc = await window.api.docs.get(id)
  if (!doc) throw new Error('The document could not be found. It may have been deleted.')
  // A copy made by an older app would silently lose what that app does not know about.
  if (isNewerData(doc)) throw new Error(NEWER_DATA_MESSAGE)
  return doc
}

function fresh(): Pick<QDoc, 'id' | 'createdAt' | 'updatedAt'> {
  const now = new Date().toISOString()
  return { id: uid(), createdAt: now, updatedAt: now }
}

/**
 * Creates a quotation or an invoice from a template, or as a copy of another document.
 * It is of the same type as what it is made from.
 */
export async function createDocument(sourceId: string, number: string, accountId: string | null): Promise<QDoc> {
  const source = await load(sourceId)
  return window.api.docs.save({
    ...source,
    ...fresh(),
    kind: 'document',
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

export async function createBlankTemplate(accountId: string | null, docType: DocType): Promise<QDoc> {
  return window.api.docs.save(buildBlankTemplate(accountId, docType))
}
