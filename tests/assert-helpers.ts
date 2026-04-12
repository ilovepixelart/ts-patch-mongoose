import { expect } from 'vitest'

type PatchOp = { op: string; path: string; value?: unknown }
type PatchLike = { patch?: PatchOp[] } | null | undefined

const requirePatch = (entry: PatchLike): PatchOp[] => {
  if (!entry?.patch) throw new Error('history entry has no patch')
  return entry.patch
}

export const patchPaths = (entry: PatchLike): string[] => requirePatch(entry).map((p) => p.path)

export const findPatch = (entry: PatchLike, path: string, op = 'replace'): PatchOp | undefined => requirePatch(entry).find((p) => p.path === path && p.op === op)

export const assertPatchPath = (entry: PatchLike, path: string): void => {
  expect(patchPaths(entry)).toContain(path)
}

export const assertPatchValue = (entry: PatchLike, path: string, value: unknown, op = 'replace'): void => {
  const hit = findPatch(entry, path, op)
  expect(hit, `no ${op} patch at ${path}`).toBeDefined()
  expect(hit?.value).toEqual(value)
}

export const assertPatchPathPrefix = (entry: PatchLike, prefix: string): void => {
  const hit = requirePatch(entry).some((p) => p.path === prefix || p.path.startsWith(`${prefix}/`))
  expect(hit, `no patch under ${prefix}`).toBe(true)
}
