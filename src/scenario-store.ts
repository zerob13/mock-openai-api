import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BUILTIN_SCENARIOS, validateScenario, type ScenarioV1 } from './scenario.js'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const FILE_SUFFIX = '.scenario.json'

function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error('Scenario id must contain only letters, numbers, underscores, or hyphens')
}

function cloneScenario(scenario: ScenarioV1): ScenarioV1 {
  const clone = structuredClone(scenario)
  let activeTextId: string | undefined
  let textIndex = 0
  clone.timeline = clone.timeline.map((event) => {
    if (event.type === 'text.start') {
      activeTextId = event.textId ?? `text_${textIndex++}`
      return { ...event, textId: activeTextId }
    }
    if (event.type === 'text.delta' || event.type === 'text.end') {
      activeTextId ??= `text_${textIndex++}`
      const normalized = { ...event, textId: event.textId ?? activeTextId }
      if (event.type === 'text.end') activeTextId = undefined
      return normalized
    }
    return event
  })
  return clone
}

export class ScenarioStore {
  readonly directory: string

  constructor(directory: string) {
    this.directory = path.resolve(directory)
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const stats = await lstat(this.directory)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Scenario directory must be a real directory')
    }
    await chmod(this.directory, 0o700)
  }

  async list(): Promise<ScenarioV1[]> {
    await this.initialize()
    const entries = await readdir(this.directory, { withFileTypes: true })
    const custom = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(FILE_SUFFIX))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => this.readFile(path.join(this.directory, entry.name))))
    return [...BUILTIN_SCENARIOS.map(cloneScenario), ...custom]
  }

  async read(id: string): Promise<ScenarioV1> {
    assertId(id)
    const builtin = BUILTIN_SCENARIOS.find((scenario) => scenario.id === id)
    if (builtin) return cloneScenario(builtin)
    return this.readFile(this.filePath(id))
  }

  async save(value: unknown): Promise<ScenarioV1> {
    validateScenario(value)
    assertId(value.id)
    if (BUILTIN_SCENARIOS.some((scenario) => scenario.id === value.id)) {
      throw new Error('Built-in scenarios are read-only')
    }
    await this.initialize()
    const scenario = cloneScenario(value)
    const destination = this.filePath(scenario.id)
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(scenario, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      })
      await rename(temporary, destination)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
    return scenario
  }

  async delete(id: string): Promise<void> {
    assertId(id)
    if (BUILTIN_SCENARIOS.some((scenario) => scenario.id === id)) {
      throw new Error('Built-in scenarios are read-only')
    }
    const filename = this.filePath(id)
    const stats = await lstat(filename)
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Scenario target must be a regular file')
    await unlink(filename)
  }

  private filePath(id: string): string {
    assertId(id)
    return path.join(this.directory, `${id}${FILE_SUFFIX}`)
  }

  private async readFile(filename: string): Promise<ScenarioV1> {
    const stats = await lstat(filename)
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Scenario source must be a regular file')
    const value: unknown = JSON.parse(await readFile(filename, 'utf8'))
    validateScenario(value)
    return value
  }
}
