import { ProviderName } from "../scenarioEngine";
import {
  buildProviderError,
  InjectableErrorStatus,
  isInjectableErrorStatus,
  ProviderError,
} from "./providerErrors";

export type ErrorInjectionInput = {
  provider: ProviderName;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  message?: string;
};

export function getInjectedProviderError(input: ErrorInjectionInput): ProviderError | undefined {
  const status = getInjectedErrorStatus(input.headers, input.query);

  return status ? buildProviderError(input.provider, status, input.message) : undefined;
}

export function getInjectedErrorStatus(
  headers: Record<string, string | string[] | undefined>,
  query: Record<string, unknown>
): InjectableErrorStatus | undefined {
  const value = readHeader(headers, "x-mock-error") || readQueryString(query, "mock_error");
  const status = Number(value);

  return Number.isInteger(status) && isInjectableErrorStatus(status) ? status : undefined;
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;

  return Array.isArray(value) ? value[0] : value;
}

function readQueryString(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const firstScalar = value.find((item) => typeof item === "string" || typeof item === "number");
    if (typeof firstScalar === "string") return firstScalar;
    if (typeof firstScalar === "number") return String(firstScalar);
  }

  return undefined;
}
