// Bend values as the generated ES modules (laws/generated/) represent them: a datatype value is an
// object tagged by its constructor in `$`, a Nat is a number and a Bool is a boolean.

export type BendList<T> = { $: 'Nil' } | { $: 'Con'; head: T; tail: BendList<T> }

export const toList = <T>(items: T[]): BendList<T> => items.reduceRight<BendList<T>>((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' })

export const fromList = <T>(list: BendList<T>): T[] => {
  const out: T[] = []
  for (let node = list; node.$ === 'Con'; node = node.tail) out.push(node.head)
  return out
}

export type BendMaybe<T> = { $: 'None' } | { $: 'Some'; value: T }

export const fromMaybe = <T>(maybe: BendMaybe<T>): T | undefined => (maybe.$ === 'Some' ? maybe.value : undefined)
