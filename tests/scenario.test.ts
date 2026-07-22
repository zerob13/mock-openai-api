import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  BUILTIN_SCENARIOS,
  compileScenario,
  parseCaptureBody,
  type CompiledResponse,
  type Protocol,
  type ScenarioV1,
} from '../src/scenario.ts';

const toolScenario = BUILTIN_SCENARIOS.find((scenario) => scenario.id === 'builtin-tool-call')!;
const textScenario = BUILTIN_SCENARIOS.find((scenario) => scenario.id === 'builtin-text')!;

function streamText(response: CompiledResponse): string {
  assert.equal(response.stream, true);
  return response.frames.map((frame) => frame.data).join('');
}

function eventNames(response: CompiledResponse): string[] {
  return [...streamText(response).matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
}

function textOf(scenario: ScenarioV1): string {
  return scenario.timeline
    .filter((event) => event.type === 'text.delta')
    .map((event) => event.delta)
    .join('');
}

function toolArguments(scenario: ScenarioV1): string {
  return scenario.timeline
    .filter((event) => event.type === 'tool.arguments.delta')
    .map((event) => event.delta)
    .join('');
}

test('ships versioned text, markdown, and tool-call built-ins', () => {
  assert.deepEqual(BUILTIN_SCENARIOS.map((scenario) => scenario.id), [
    'builtin-text',
    'builtin-markdown',
    'builtin-tool-call',
  ]);
  for (const scenario of BUILTIN_SCENARIOS) {
    assert.equal(scenario.schemaVersion, 1);
    assert.equal(scenario.schema, 'mock-openai-api.scenario');
  }
});

test('compiles OpenAI Chat stream with fragments, usage, and one DONE marker', () => {
  const response = compileScenario('openai-chat', toolScenario, {
    stream: true,
    includeUsage: true,
    model: 'test-model',
  });
  const body = streamText(response);
  assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(body.match(/data: \[DONE\]/g)?.length, 1);
  assert.match(body, /"name":"get_weather"/);
  assert.match(body, /"arguments":"\{\\"city\\":"/);
  assert.match(body, /"arguments":"\\"Shanghai\\"\}"/);
  assert.ok(body.indexOf('"choices":[]') < body.indexOf('data: [DONE]'));
  const roundTrip = parseCaptureBody('openai-chat', body, { contentType: 'text/event-stream' });
  assert.equal(toolArguments(roundTrip), '{"city":"Shanghai"}');
  assert.equal(roundTrip.timeline.find((event) => event.type === 'finish')?.reason, 'tool');
});

test('compiles OpenAI Responses with a named lifecycle and no Chat terminator', () => {
  const response = compileScenario('openai-responses', toolScenario, { stream: true });
  const names = eventNames(response);
  assert.equal(names[0], 'response.created');
  assert.ok(names.includes('response.function_call_arguments.delta'));
  assert.ok(names.includes('response.function_call_arguments.done'));
  assert.equal(names.at(-1), 'response.completed');
  assert.doesNotMatch(streamText(response), /\[DONE\]/);
  assert.match(streamText(response), /"input_tokens":12/);
  assert.match(streamText(response), /"output_tokens":9/);

  const sequences = [...streamText(response).matchAll(/"sequence_number":(\d+)/g)]
    .map((match) => Number(match[1]));
  assert.deepEqual(sequences, sequences.map((_, index) => index));

  const roundTrip = parseCaptureBody('openai-responses', streamText(response), {
    contentType: 'text/event-stream',
  });
  assert.equal(toolArguments(roundTrip), '{"city":"Shanghai"}');
  assert.equal(roundTrip.timeline.find((event) => event.type === 'finish')?.reason, 'tool');
});

test('compiles Anthropic stream with complete content-block and message lifecycles', () => {
  const response = compileScenario('anthropic-messages', toolScenario, { stream: true });
  const names = eventNames(response);
  assert.deepEqual(names, [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ]);
  assert.match(streamText(response), /"type":"input_json_delta"/);
  assert.match(streamText(response), /"stop_reason":"tool_use"/);
  assert.match(streamText(response), /"output_tokens":9/);

  const roundTrip = parseCaptureBody('anthropic-messages', streamText(response), {
    contentType: 'text/event-stream',
  });
  assert.equal(toolArguments(roundTrip), '{"city":"Shanghai"}');
  assert.equal(roundTrip.timeline.find((event) => event.type === 'finish')?.reason, 'tool');
});

test('transcodes JSON captures among all three protocols', () => {
  const protocols: Protocol[] = ['openai-chat', 'openai-responses', 'anthropic-messages'];
  for (const source of protocols) {
    const compiled = compileScenario(source, textScenario, { stream: false, model: 'source-model' });
    assert.equal(compiled.stream, false);
    const parsed = parseCaptureBody(source, compiled.body, { contentType: 'application/json' });
    assert.equal(textOf(parsed), 'Hello from mock-openai-api.');
    for (const target of protocols) {
      const targetResponse = compileScenario(target, parsed, { stream: false, model: 'target-model' });
      assert.equal(targetResponse.stream, false);
      assert.equal(targetResponse.status, 200);
      assert.equal(targetResponse.headers['content-type'], 'application/json');
    }
  }
});

test('transcodes a captured function call into each non-stream tool shape', () => {
  const source = compileScenario('openai-chat', toolScenario, { stream: false });
  assert.equal(source.stream, false);
  const parsed = parseCaptureBody('openai-chat', source.body, { contentType: 'application/json' });

  const chat = compileScenario('openai-chat', parsed, { stream: false });
  assert.equal(chat.stream, false);
  assert.equal(JSON.parse(chat.body).choices[0].message.tool_calls[0].function.arguments, '{"city":"Shanghai"}');

  const responses = compileScenario('openai-responses', parsed, { stream: false });
  assert.equal(responses.stream, false);
  assert.equal(JSON.parse(responses.body).output[0].arguments, '{"city":"Shanghai"}');

  const anthropic = compileScenario('anthropic-messages', parsed, { stream: false });
  assert.equal(anthropic.stream, false);
  assert.deepEqual(JSON.parse(anthropic.body).content[0].input, { city: 'Shanghai' });
});

test('preserves multiline SSE data and rejects a Chat stream without DONE', () => {
  const incomplete = [
    'data: {"id":"chat-1",',
    'data: "choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}',
    '',
    '',
  ].join('\n');
  const parsed = parseCaptureBody('openai-chat', incomplete, { contentType: 'text/event-stream' });
  assert.equal(textOf(parsed), 'partial');
  const error = parsed.timeline.find((event) => event.type === 'error');
  assert.equal(error?.code, 'incomplete_stream');
});

test('maps in-stream errors without adding success terminal events', () => {
  const scenario: ScenarioV1 = {
    schema: 'mock-openai-api.scenario',
    kind: 'scenario',
    schemaVersion: 1,
    id: 'stream-error',
    title: 'Stream error',
    source: { kind: 'builtin' },
    match: { protocols: ['openai-chat', 'openai-responses', 'anthropic-messages'] },
    response: { status: 200 },
    timeline: [
      { type: 'message.start', atUs: 0, messageId: 'message', role: 'assistant' },
      { type: 'text.delta', atUs: 1_000, delta: 'partial' },
      { type: 'error', atUs: 2_000, code: 'overloaded_error', message: 'Busy' },
    ],
  };

  const chat = streamText(compileScenario('openai-chat', scenario, { stream: true }));
  assert.match(chat, /"overloaded_error"/);
  assert.doesNotMatch(chat, /\[DONE\]/);

  const responses = compileScenario('openai-responses', scenario, { stream: true });
  assert.equal(eventNames(responses).at(-1), 'error');
  assert.ok(!eventNames(responses).includes('response.completed'));

  const anthropic = compileScenario('anthropic-messages', scenario, { stream: true });
  assert.equal(eventNames(anthropic).at(-1), 'error');
  assert.ok(!eventNames(anthropic).includes('message_stop'));
});

test('returns protocol-shaped JSON for errors before streaming starts', () => {
  const scenario: ScenarioV1 = {
    schema: 'mock-openai-api.scenario',
    kind: 'scenario',
    schemaVersion: 1,
    id: 'http-error',
    title: 'HTTP error',
    source: { kind: 'builtin' },
    match: { protocols: ['anthropic-messages'] },
    response: { status: 429 },
    timeline: [{ type: 'error', atUs: 0, status: 429, code: 'rate_limit_error', message: 'Slow down' }],
  };
  const response = compileScenario('anthropic-messages', scenario, { stream: true });
  assert.equal(response.stream, false);
  assert.equal(response.status, 429);
  assert.deepEqual(JSON.parse(response.body), {
    type: 'error',
    error: { type: 'rate_limit_error', message: 'Slow down' },
  });
});
