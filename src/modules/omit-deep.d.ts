declare module 'omit-deep' {
  export default function omitDeep<T>(value: T, keys: string[]): Partial<T>
}
