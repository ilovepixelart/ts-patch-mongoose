declare module 'power-assign' {
  export function assign<T, U>(object1: T, object2: U): T & U
}
