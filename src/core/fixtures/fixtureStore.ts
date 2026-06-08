import { ProviderName, ScenarioName } from "../scenarioEngine";

export type FixtureRecord<T = unknown> = {
  provider: ProviderName;
  endpoint: string;
  scenario: ScenarioName;
  name?: string;
  data: T;
};

export class FixtureStore {
  private readonly fixtures = new Map<string, FixtureRecord>();

  register<T>(fixture: FixtureRecord<T>): FixtureRecord<T> {
    this.fixtures.set(fixtureKey(fixture), fixture as FixtureRecord);
    return fixture;
  }

  get<T>(
    provider: ProviderName,
    endpoint: string,
    scenario: ScenarioName,
    name = "default"
  ): FixtureRecord<T> | undefined {
    return this.fixtures.get(fixtureKey({ provider, endpoint, scenario, name })) as
      | FixtureRecord<T>
      | undefined;
  }

  list(provider?: ProviderName): FixtureRecord[] {
    const records = Array.from(this.fixtures.values());
    return provider ? records.filter((record) => record.provider === provider) : records;
  }

  clear(): void {
    this.fixtures.clear();
  }
}

export function fixtureKey(input: {
  provider: ProviderName;
  endpoint: string;
  scenario: ScenarioName;
  name?: string;
}): string {
  return [input.provider, input.endpoint, input.scenario, input.name || "default"].join(":");
}
