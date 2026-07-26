import type { Page } from '@playwright/test'

export interface ReplicaRow {
  table: string
  json: string
}

export interface Replica {
  /** Everything persisted, verbatim — for "this string is nowhere in the replica". */
  raw: string
  /** The same bytes decomposed into synced rows, each tagged with the table it belongs to. */
  rows: ReplicaRow[]
}

// The client's ACTUAL replica, read out of IndexedDB rather than inferred from the DOM: a DOM
// assertion cannot tell "not rendered" from "not received", and the guarantees this reads for —
// retro anonymity, inbox privacy — are about what a client is allowed to hold, not about what it
// draws. Zero persists its whole replica as a handful of B-tree chunks, so a per-record check
// would be meaningless (everything co-occurs inside one chunk) — the walk therefore descends into
// the chunks and lifts out each `e/<table>/<id>` entry as its own row, which is the granularity
// the guarantee is about.
export async function readReplica(page: Page): Promise<Replica> {
  return await page.evaluate(async () => {
    const chunks: string[] = []
    const rows: { table: string; json: string }[] = []

    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        const [key, value] = node
        if (
          typeof key === 'string' &&
          key.startsWith('e/') &&
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value)
        ) {
          rows.push({ table: key.slice(2).split('/')[0] ?? '', json: JSON.stringify(value) })
          return
        }
        for (const child of node) visit(child)
        return
      }
      if (typeof node === 'object' && node !== null) {
        for (const child of Object.values(node)) visit(child)
      }
    }

    for (const info of await indexedDB.databases()) {
      const name = info.name
      if (name === undefined) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const stores = [...db.objectStoreNames]
      if (stores.length > 0) {
        const transaction = db.transaction(stores, 'readonly')
        for (const store of stores) {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const request = transaction.objectStore(store).getAll()
            request.onsuccess = () => resolve(request.result as unknown[])
            request.onerror = () => reject(request.error)
          })
          for (const value of values) {
            chunks.push(JSON.stringify(value))
            visit(value)
          }
        }
      }
      db.close()
    }
    for (const key of Object.keys(window.localStorage)) {
      chunks.push(`${key}:${window.localStorage.getItem(key) ?? ''}`)
    }
    return { raw: chunks.join('\n'), rows }
  })
}

export async function replicaHolds(page: Page, needle: string): Promise<boolean> {
  const { raw } = await readReplica(page)
  return raw.includes(needle)
}
