import { useCallback, useEffect, useRef, useState } from 'react'

type KVSetter<T> = (newValue: T | ((oldValue: T) => T)) => void

function listStoredKeys(): string[] {
  if (typeof window === 'undefined') return []

  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key) keys.push(key)
  }

  return keys
}

function readStoredValue<T>(key: string, initialValue: T): T {
  if (typeof window === 'undefined') return initialValue

  const stored = window.localStorage.getItem(key)
  if (stored === null) return initialValue

  try {
    return JSON.parse(stored) as T
  } catch {
    return stored as T
  }
}

function writeStoredValue<T>(key: string, value: T) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent('local-kv-change', { detail: { key } }))
}

function deleteStoredValue(key: string) {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(key)
  window.dispatchEvent(new CustomEvent('local-kv-change', { detail: { key } }))
}

export function ensureLocalSparkFallback() {
  if (typeof window === 'undefined') return

  const existingSpark = window.spark
  window.spark = {
    ...existingSpark,
    llmPrompt: existingSpark?.llmPrompt ?? ((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '')
    ),
    llm: existingSpark?.llm ?? (() => Promise.resolve(JSON.stringify({ insights: [] }))),
    kv: {
      ...existingSpark?.kv,
      get: existingSpark?.kv?.get ?? ((key: string) => Promise.resolve(readStoredValue(key, undefined))),
      set: existingSpark?.kv?.set ?? ((key: string, value: unknown) => {
        writeStoredValue(key, value)
        return Promise.resolve()
      }),
      delete: existingSpark?.kv?.delete ?? ((key: string) => {
        deleteStoredValue(key)
        return Promise.resolve()
      }),
      keys: existingSpark?.kv?.keys ?? (() => Promise.resolve(listStoredKeys())),
    },
  }
}

export function useKV<T = string>(
  key: string,
  initialValue?: T
): readonly [T, KVSetter<T>, () => void] {
  const defaultValueRef = useRef(initialValue as T)
  const [value, setValue] = useState<T>(() => readStoredValue(key, defaultValueRef.current))
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    ensureLocalSparkFallback()

    const syncValue = () => {
      const storedValue = readStoredValue(key, defaultValueRef.current)
      valueRef.current = storedValue
      setValue(storedValue)
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) syncValue()
    }
    const handleLocalChange = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === key) syncValue()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('local-kv-change', handleLocalChange)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('local-kv-change', handleLocalChange)
    }
  }, [key])

  const setStoredValue = useCallback<KVSetter<T>>(
    (newValue) => {
      const resolvedValue = typeof newValue === 'function'
        ? (newValue as (oldValue: T) => T)(valueRef.current)
        : newValue

      valueRef.current = resolvedValue
      setValue(resolvedValue)
      writeStoredValue(key, resolvedValue)
    },
    [key]
  )

  const deleteValue = useCallback(() => {
    deleteStoredValue(key)
    valueRef.current = defaultValueRef.current
    setValue(defaultValueRef.current)
  }, [key])

  return [value, setStoredValue, deleteValue] as const
}
