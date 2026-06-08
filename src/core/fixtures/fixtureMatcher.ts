import { ProviderName, ScenarioName } from "../scenarioEngine";
import { FixtureRecord, FixtureStore } from "./fixtureStore";

export type FixtureMatchInput = {
  provider: ProviderName;
  endpoint: string;
  scenario: ScenarioName;
  name?: string;
};

export function matchFixture<T>(
  store: FixtureStore,
  input: FixtureMatchInput
): FixtureRecord<T> | undefined {
  return (
    store.get<T>(input.provider, input.endpoint, input.scenario, input.name) ||
    store.get<T>(input.provider, input.endpoint, "simple_text", input.name)
  );
}
