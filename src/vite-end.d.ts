/// <reference types="vite/client" />

interface SparkKV {
  get<T = unknown>(key: string): Promise<T | undefined>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

interface SparkRuntime {
  kv: SparkKV
  llmPrompt: (strings: TemplateStringsArray, ...values: unknown[]) => string
  llm: (prompt: string, model?: string, jsonMode?: boolean) => Promise<string>
}

declare global {
  const GITHUB_RUNTIME_PERMANENT_NAME: string
  const BASE_KV_SERVICE_URL: string
  interface Window {
    spark?: SparkRuntime
  }

  const spark: SparkRuntime
}

export {}
