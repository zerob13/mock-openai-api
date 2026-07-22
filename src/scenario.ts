export type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages';

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool'
  | 'content_filter'
  | 'error'
  | 'other';

interface EventBase {
  atUs: number;
}

export type ScenarioEvent =
  | (EventBase & {
      type: 'message.start';
      messageId: string;
      role: 'assistant';
    })
  | (EventBase & {
      type: 'text.start';
      textId?: string;
      format?: 'plain' | 'markdown';
    })
  | (EventBase & {
      type: 'text.delta';
      textId?: string;
      delta: string;
      format?: 'plain' | 'markdown';
    })
  | (EventBase & { type: 'text.end'; textId?: string })
  | (EventBase & {
      type: 'tool.start';
      toolCallId: string;
      name: string;
    })
  | (EventBase & {
      type: 'tool.arguments.delta';
      toolCallId: string;
      delta: string;
    })
  | (EventBase & {
      type: 'tool.end';
      toolCallId: string;
    })
  | (EventBase & {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      totalTokens?: number;
    })
  | (EventBase & {
      type: 'finish';
      reason: FinishReason;
      sourceValue?: string;
    })
  | (EventBase & {
      type: 'error';
      message: string;
      code?: string;
      status?: number;
    })
  | (EventBase & { type: 'ping' });

export interface ScenarioV1 {
  schema: 'mock-openai-api.scenario';
  kind: 'scenario';
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  source:
    | { kind: 'builtin' }
    | { kind: 'capture'; protocol: Protocol; captureId?: string }
    | { kind: 'editor'; protocol?: Protocol };
  match: {
    protocols: Protocol[];
    stream?: boolean;
  };
  response: {
    status: number;
    headers?: Record<string, string>;
  };
  timeline: ScenarioEvent[];
}

export interface CompileOptions {
  stream: boolean;
  model?: string;
  includeUsage?: boolean;
  invocationId?: string;
  createdAt?: number;
}

export interface CompiledFrame {
  atMs: number;
  data: string;
}

export type CompiledResponse =
  | {
      protocol: Protocol;
      stream: false;
      status: number;
      headers: Record<string, string>;
      body: string;
    }
  | {
      protocol: Protocol;
      stream: true;
      status: number;
      headers: Record<string, string>;
      frames: CompiledFrame[];
    };

export interface ParseCaptureOptions {
  contentType?: string;
  status?: number;
  id?: string;
  title?: string;
  captureId?: string;
}

interface ToolState {
  logicalId: string;
  name: string;
  fragments: Array<{ atUs: number; delta: string }>;
  startAtUs: number;
  endAtUs?: number;
}

interface ScenarioState {
  messageId: string;
  messageAtUs: number;
  text: string;
  textFragments: Array<{ atUs: number; delta: string }>;
  textStartAtUs?: number;
  textEndAtUs?: number;
  tools: ToolState[];
  usage?: Extract<ScenarioEvent, { type: 'usage' }>;
  finish?: Extract<ScenarioEvent, { type: 'finish' }>;
  error?: Extract<ScenarioEvent, { type: 'error' }>;
  pings: Array<Extract<ScenarioEvent, { type: 'ping' }>>;
  lastAtUs: number;
}

const ALL_PROTOCOLS: Protocol[] = [
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
];

export const BUILTIN_SCENARIOS: ReadonlyArray<ScenarioV1> = [
  {
    schema: 'mock-openai-api.scenario',
    kind: 'scenario',
    schemaVersion: 1,
    id: 'builtin-text',
    title: 'Plain text',
    description: 'A portable plain-text response.',
    source: { kind: 'builtin' },
    match: { protocols: [...ALL_PROTOCOLS], stream: true },
    response: { status: 200 },
    timeline: [
      { type: 'message.start', atUs: 0, messageId: 'message', role: 'assistant' },
      { type: 'text.start', atUs: 0, format: 'plain' },
      { type: 'text.delta', atUs: 10_000, delta: 'Hello from ' },
      { type: 'text.delta', atUs: 25_000, delta: 'mock-openai-api.' },
      { type: 'text.end', atUs: 30_000 },
      { type: 'finish', atUs: 30_000, reason: 'stop' },
      { type: 'usage', atUs: 30_000, inputTokens: 8, outputTokens: 7, totalTokens: 15 },
    ],
  },
  {
    schema: 'mock-openai-api.scenario',
    kind: 'scenario',
    schemaVersion: 1,
    id: 'builtin-markdown',
    title: 'Markdown',
    description: 'Markdown is transported as ordinary text.',
    source: { kind: 'builtin' },
    match: { protocols: [...ALL_PROTOCOLS], stream: true },
    response: { status: 200 },
    timeline: [
      { type: 'message.start', atUs: 0, messageId: 'message', role: 'assistant' },
      { type: 'text.start', atUs: 0, format: 'markdown' },
      { type: 'text.delta', atUs: 10_000, delta: '## Result\n\n', format: 'markdown' },
      { type: 'text.delta', atUs: 25_000, delta: '- Recorded\n- Replayable', format: 'markdown' },
      { type: 'text.end', atUs: 30_000 },
      { type: 'finish', atUs: 30_000, reason: 'stop' },
      { type: 'usage', atUs: 30_000, inputTokens: 8, outputTokens: 12, totalTokens: 20 },
    ],
  },
  {
    schema: 'mock-openai-api.scenario',
    kind: 'scenario',
    schemaVersion: 1,
    id: 'builtin-tool-call',
    title: 'Function tool call',
    description: 'A portable function call with argument fragments.',
    source: { kind: 'builtin' },
    match: { protocols: [...ALL_PROTOCOLS], stream: true },
    response: { status: 200 },
    timeline: [
      { type: 'message.start', atUs: 0, messageId: 'message', role: 'assistant' },
      { type: 'tool.start', atUs: 10_000, toolCallId: 'weather', name: 'get_weather' },
      { type: 'tool.arguments.delta', atUs: 20_000, toolCallId: 'weather', delta: '{"city":' },
      { type: 'tool.arguments.delta', atUs: 30_000, toolCallId: 'weather', delta: '"Shanghai"}' },
      { type: 'tool.end', atUs: 35_000, toolCallId: 'weather' },
      { type: 'finish', atUs: 40_000, reason: 'tool' },
      { type: 'usage', atUs: 40_000, inputTokens: 12, outputTokens: 9, totalTokens: 21 },
    ],
  },
];

export function validateScenario(value: unknown): asserts value is ScenarioV1 {
  if (!value || typeof value !== 'object') throw new Error('Scenario must be an object');
  const scenario = value as Partial<ScenarioV1>;
  if (scenario.schema !== 'mock-openai-api.scenario' || scenario.kind !== 'scenario') {
    throw new Error('Unsupported scenario schema');
  }
  if (scenario.schemaVersion !== 1) {
    throw new Error(`Unsupported scenario version: ${String(scenario.schemaVersion)}`);
  }
  if (!scenario.id || !scenario.title) throw new Error('Scenario id and title are required');
  if (!scenario.source || !['builtin', 'capture', 'editor'].includes(scenario.source.kind)) {
    throw new Error('Scenario source is invalid');
  }
  if (scenario.source.kind === 'capture' && !ALL_PROTOCOLS.includes(scenario.source.protocol)) {
    throw new Error('Scenario source protocol is invalid');
  }
  if (!scenario.match || !Array.isArray(scenario.match.protocols) || !scenario.match.protocols.length
    || scenario.match.protocols.some((protocol) => !ALL_PROTOCOLS.includes(protocol))) {
    throw new Error('Scenario match protocols are invalid');
  }
  if (!scenario.response || !Number.isInteger(scenario.response.status)
    || scenario.response.status < 100 || scenario.response.status > 599) {
    throw new Error('Scenario response.status must be an integer');
  }
  if (scenario.response.headers
    && Object.entries(scenario.response.headers).some(([name, content]) =>
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      || typeof content !== 'string'
      || /[\r\n]/.test(content),
    )) {
    throw new Error('Scenario response headers are invalid');
  }
  if (!Array.isArray(scenario.timeline)) throw new Error('Scenario timeline must be an array');

  let previous = -1;
  const openTools = new Set<string>();
  let finishes = 0;
  let errors = 0;
  let terminal: 'finish' | 'error' | undefined;
  for (const event of scenario.timeline) {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
      throw new Error('Scenario event is invalid');
    }
    if (!Number.isFinite(event.atUs) || event.atUs < previous || event.atUs < 0) {
      throw new Error('Scenario event times must be finite, non-negative, and monotonic');
    }
    previous = event.atUs;
    if (terminal && !(terminal === 'finish' && event.type === 'usage')) {
      throw new Error(`Scenario event ${event.type} occurs after ${terminal}`);
    }
    if (event.type === 'message.start') {
      if (!event.messageId || event.role !== 'assistant') throw new Error('Message start is invalid');
    } else if (event.type === 'text.start') {
      if (event.format && event.format !== 'plain' && event.format !== 'markdown') {
        throw new Error('Text format is invalid');
      }
    } else if (event.type === 'text.delta') {
      if (typeof event.delta !== 'string') throw new Error('Text delta is invalid');
    } else if (event.type === 'text.end' || event.type === 'ping') {
      // These events have no payload.
    } else if (event.type === 'tool.start') {
      if (!event.toolCallId || !event.name) throw new Error('Tool id and name are required');
      if (openTools.has(event.toolCallId)) throw new Error(`Duplicate tool id: ${event.toolCallId}`);
      openTools.add(event.toolCallId);
    } else if (event.type === 'tool.arguments.delta' || event.type === 'tool.end') {
      if (!openTools.has(event.toolCallId)) {
        throw new Error(`Tool event references unknown id: ${event.toolCallId}`);
      }
      if (event.type === 'tool.end') openTools.delete(event.toolCallId);
    } else if (event.type === 'usage') {
      if (![event.inputTokens, event.outputTokens, event.totalTokens ?? 0].every(validTokenCount)) {
        throw new Error('Usage token counts must be non-negative integers');
      }
    } else if (event.type === 'finish') {
      if (!['stop', 'length', 'tool', 'content_filter', 'error', 'other'].includes(event.reason)) {
        throw new Error('Finish reason is invalid');
      }
      finishes += 1;
      terminal = 'finish';
    } else if (event.type === 'error') {
      if (!event.message || (event.status !== undefined && !Number.isInteger(event.status))) {
        throw new Error('Error event is invalid');
      }
      errors += 1;
      terminal = 'error';
    } else {
      throw new Error(`Unsupported scenario event type: ${String((event as { type: unknown }).type)}`);
    }
  }
  if (finishes > 1 || errors > 1 || (finishes && errors)) {
    throw new Error('Scenario must have exactly one terminal outcome');
  }
  if (!finishes && !errors) throw new Error('Scenario requires a finish or error event');
  if (openTools.size && !errors) throw new Error(`Unfinished tool call: ${[...openTools][0]}`);
}

export function compileScenario(
  protocol: Protocol,
  scenario: ScenarioV1,
  options: CompileOptions,
): CompiledResponse {
  validateScenario(scenario);
  if (!scenario.match.protocols.includes(protocol)) {
    throw new Error(`Scenario ${scenario.id} does not allow ${protocol}`);
  }
  const state = collectState(scenario);
  if (state.finish?.reason === 'error') {
    state.error = {
      type: 'error',
      atUs: state.finish.atUs,
      code: state.finish.sourceValue ?? 'model_error',
      message: 'The model response failed',
    };
    state.finish = undefined;
  }
  const headers = Object.fromEntries(
    Object.entries(scenario.response.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const errorStatus = state.error?.status ?? (scenario.response.status >= 400 ? scenario.response.status : 500);
  const hasOutputBeforeError = state.error
    ? scenario.timeline.some((event) =>
        (event.type === 'text.delta' || event.type === 'tool.start') && event.atUs < state.error!.atUs,
      )
    : false;

  if (state.error && (!options.stream || (!hasOutputBeforeError && errorStatus >= 400))) {
    return {
      protocol,
      stream: false,
      status: errorStatus,
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(compileError(protocol, state.error)),
    };
  }

  if (!options.stream) {
    const body = protocol === 'openai-chat'
      ? compileChatObject(scenario, state, options)
      : protocol === 'openai-responses'
        ? compileResponsesObject(scenario, state, options)
        : compileAnthropicObject(scenario, state, options);
    return {
      protocol,
      stream: false,
      status: scenario.response.status,
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  const frames = protocol === 'openai-chat'
    ? compileChatStream(scenario, state, options)
    : protocol === 'openai-responses'
      ? compileResponsesStream(scenario, state, options)
      : compileAnthropicStream(scenario, state, options);
  return {
    protocol,
    stream: true,
    status: scenario.response.status,
    headers: {
      ...headers,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': headers['cache-control'] ?? 'no-cache',
    },
    frames,
  };
}

export function parseCaptureBody(
  protocol: Protocol,
  body: string | Uint8Array,
  options: ParseCaptureOptions = {},
): ScenarioV1 {
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Capture body is empty');
  const isSse = options.contentType?.toLowerCase().includes('text/event-stream')
    ?? /^(?:\ufeff)?(?:event|data|id|retry):/m.test(trimmed);
  const timeline = (isSse
    ? parseStream(protocol, parseSse(text))
    : parseJson(protocol, parseJsonValue(trimmed)))
    .sort((left, right) => left.atUs - right.atUs);
  const parsedError = timeline.find((event) => event.type === 'error');
  if (parsedError?.type === 'error' && options.status !== undefined) parsedError.status = options.status;
  const scenario: ScenarioV1 = {
    schema: 'mock-openai-api.scenario',
    kind: 'scenario',
    schemaVersion: 1,
    id: options.id ?? `capture-${protocol}-${shortHash(text)}`,
    title: options.title ?? `Imported ${protocol} capture`,
    source: { kind: 'capture', protocol, captureId: options.captureId },
    match: { protocols: [...ALL_PROTOCOLS], stream: isSse },
    response: { status: options.status ?? (parsedError ? 500 : 200) },
    timeline,
  };
  validateScenario(scenario);
  return scenario;
}

function validTokenCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function collectState(scenario: ScenarioV1): ScenarioState {
  const first = scenario.timeline[0]?.atUs ?? 0;
  const state: ScenarioState = {
    messageId: 'message',
    messageAtUs: first,
    text: '',
    textFragments: [],
    tools: [],
    pings: [],
    lastAtUs: scenario.timeline.at(-1)?.atUs ?? 0,
  };
  const tools = new Map<string, ToolState>();
  for (const event of scenario.timeline) {
    switch (event.type) {
      case 'message.start':
        state.messageId = event.messageId;
        state.messageAtUs = event.atUs;
        break;
      case 'text.start':
        state.textStartAtUs ??= event.atUs;
        break;
      case 'text.delta':
        state.textStartAtUs ??= event.atUs;
        state.text += event.delta;
        state.textFragments.push({ atUs: event.atUs, delta: event.delta });
        break;
      case 'text.end':
        state.textEndAtUs = event.atUs;
        break;
      case 'tool.start': {
        const tool: ToolState = {
          logicalId: event.toolCallId,
          name: event.name,
          fragments: [],
          startAtUs: event.atUs,
        };
        state.tools.push(tool);
        tools.set(event.toolCallId, tool);
        break;
      }
      case 'tool.arguments.delta':
        tools.get(event.toolCallId)!.fragments.push({ atUs: event.atUs, delta: event.delta });
        break;
      case 'tool.end':
        tools.get(event.toolCallId)!.endAtUs = event.atUs;
        break;
      case 'usage':
        state.usage = event;
        break;
      case 'finish':
        state.finish = event;
        break;
      case 'error':
        state.error = event;
        break;
      case 'ping':
        state.pings.push(event);
        break;
    }
  }
  return state;
}

function compileError(protocol: Protocol, error: Extract<ScenarioEvent, { type: 'error' }>): unknown {
  if (protocol === 'anthropic-messages') {
    return { type: 'error', error: { type: error.code ?? 'api_error', message: error.message } };
  }
  return {
    error: {
      message: error.message,
      type: error.code ?? 'server_error',
      param: null,
      code: error.code ?? null,
    },
  };
}

function compileChatObject(scenario: ScenarioV1, state: ScenarioState, options: CompileOptions): unknown {
  const finish = chatFinish(state.finish?.reason ?? (state.tools.length ? 'tool' : 'stop'));
  const message: Record<string, unknown> = { role: 'assistant', content: state.text || null };
  if (state.tools.length) {
    message.tool_calls = state.tools.map((tool) => ({
      id: targetId('call', scenario, options, tool.logicalId),
      type: 'function',
      function: { name: tool.name, arguments: tool.fragments.map((part) => part.delta).join('') },
    }));
  }
  return {
    id: targetId('chatcmpl', scenario, options, 'response'),
    object: 'chat.completion',
    created: options.createdAt ?? 0,
    model: options.model ?? 'mock-model',
    choices: [{ index: 0, message, logprobs: null, finish_reason: finish }],
    usage: chatUsage(state.usage),
  };
}

function compileChatStream(
  scenario: ScenarioV1,
  state: ScenarioState,
  options: CompileOptions,
): CompiledFrame[] {
  const id = targetId('chatcmpl', scenario, options, 'response');
  const model = options.model ?? 'mock-model';
  const created = options.createdAt ?? 0;
  const frames: Array<CompiledFrame & { order: number }> = [];
  let order = 0;
  const chunk = (atUs: number, delta: unknown, finishReason: string | null = null, usage?: unknown) => {
    const payload: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
    };
    if (usage !== undefined) payload.usage = usage;
    frames.push({ atMs: atUs / 1000, data: dataSse(payload), order: order++ });
  };

  chunk(state.messageAtUs, { role: 'assistant', content: '' });
  for (const part of state.textFragments) chunk(part.atUs, { content: part.delta });
  state.tools.forEach((tool, index) => {
    chunk(tool.startAtUs, {
      tool_calls: [{
        index,
        id: targetId('call', scenario, options, tool.logicalId),
        type: 'function',
        function: { name: tool.name, arguments: '' },
      }],
    });
    for (const part of tool.fragments) {
      chunk(part.atUs, { tool_calls: [{ index, function: { arguments: part.delta } }] });
    }
  });

  if (state.error) {
    frames.push({
      atMs: state.error.atUs / 1000,
      data: dataSse(compileError('openai-chat', state.error)),
      order: order++,
    });
    return sortedFrames(frames);
  }

  const finishAt = state.finish?.atUs ?? state.lastAtUs;
  chunk(finishAt, {}, chatFinish(state.finish?.reason ?? (state.tools.length ? 'tool' : 'stop')));
  const terminalAt = Math.max(finishAt, state.usage?.atUs ?? finishAt);
  if (options.includeUsage && state.usage) {
    const payload = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [],
      usage: chatUsage(state.usage),
    };
    frames.push({ atMs: terminalAt / 1000, data: dataSse(payload), order: order++ });
  }
  frames.push({ atMs: terminalAt / 1000, data: 'data: [DONE]\n\n', order: order++ });
  return sortedFrames(frames);
}

function compileResponsesObject(
  scenario: ScenarioV1,
  state: ScenarioState,
  options: CompileOptions,
): unknown {
  return responseObject(scenario, state, options, responseStatus(state.finish?.reason), true);
}

function responseObject(
  scenario: ScenarioV1,
  state: ScenarioState,
  options: CompileOptions,
  status: 'in_progress' | 'completed' | 'incomplete' | 'failed',
  includeOutput: boolean,
): Record<string, unknown> {
  const output: Array<Record<string, unknown> & { _atUs?: number }> = [];
  if (includeOutput && state.textFragments.length) {
    output.push({
      _atUs: state.textStartAtUs ?? state.messageAtUs,
      id: targetId('msg', scenario, options, state.messageId),
      type: 'message',
      status: status === 'in_progress' ? 'in_progress' : 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: state.text, annotations: [] }],
    });
  }
  if (includeOutput) {
    for (const tool of state.tools) {
      output.push({
        _atUs: tool.startAtUs,
        id: targetId('fc', scenario, options, tool.logicalId),
        type: 'function_call',
        status: status === 'in_progress' ? 'in_progress' : 'completed',
        call_id: targetId('call', scenario, options, tool.logicalId),
        name: tool.name,
        arguments: tool.fragments.map((part) => part.delta).join(''),
      });
    }
  }
  output.sort((a, b) => (a._atUs ?? 0) - (b._atUs ?? 0));
  output.forEach((item) => delete item._atUs);
  const finishReason = state.finish?.reason;
  return {
    id: targetId('resp', scenario, options, 'response'),
    object: 'response',
    created_at: options.createdAt ?? 0,
    status,
    error: state.error
      ? { code: state.error.code ?? 'server_error', message: state.error.message }
      : null,
    incomplete_details: status === 'incomplete'
      ? { reason: finishReason === 'content_filter' ? 'content_filter' : 'max_output_tokens' }
      : null,
    model: options.model ?? 'mock-model',
    output,
    parallel_tool_calls: state.tools.length > 1,
    tool_choice: 'auto',
    tools: [],
    usage: status === 'in_progress' ? null : responsesUsage(state.usage),
  };
}

function compileResponsesStream(
  scenario: ScenarioV1,
  state: ScenarioState,
  options: CompileOptions,
): CompiledFrame[] {
  type Pending = { atUs: number; order: number; event: string; payload: Record<string, unknown> };
  const pending: Pending[] = [];
  let order = 0;
  const add = (atUs: number, event: string, payload: Record<string, unknown>) => {
    pending.push({ atUs, order: order++, event, payload: { type: event, ...payload } });
  };
  const startAt = state.messageAtUs;
  add(startAt, 'response.created', {
    response: responseObject(scenario, state, options, 'in_progress', false),
  });
  add(startAt, 'response.in_progress', {
    response: responseObject(scenario, state, options, 'in_progress', false),
  });

  const items: Array<{ kind: 'text' | 'tool'; atUs: number; tool?: ToolState }> = [];
  if (state.textFragments.length) items.push({ kind: 'text', atUs: state.textStartAtUs ?? startAt });
  for (const tool of state.tools) items.push({ kind: 'tool', atUs: tool.startAtUs, tool });
  items.sort((a, b) => a.atUs - b.atUs);

  items.forEach((entry, outputIndex) => {
    if (entry.kind === 'text') {
      const itemId = targetId('msg', scenario, options, state.messageId);
      const item = { id: itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] };
      add(entry.atUs, 'response.output_item.added', { output_index: outputIndex, item });
      add(entry.atUs, 'response.content_part.added', {
        item_id: itemId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      });
      for (const part of state.textFragments) {
        add(part.atUs, 'response.output_text.delta', {
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          delta: part.delta,
        });
      }
      if (!state.error) {
        const doneAt = state.textEndAtUs ?? state.finish?.atUs ?? state.lastAtUs;
        const content = { type: 'output_text', text: state.text, annotations: [] };
        add(doneAt, 'response.output_text.done', {
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          text: state.text,
        });
        add(doneAt, 'response.content_part.done', {
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          part: content,
        });
        add(doneAt, 'response.output_item.done', {
          output_index: outputIndex,
          item: { ...item, status: 'completed', content: [content] },
        });
      }
      return;
    }

    const tool = entry.tool!;
    const itemId = targetId('fc', scenario, options, tool.logicalId);
    const callId = targetId('call', scenario, options, tool.logicalId);
    const item = {
      id: itemId,
      type: 'function_call',
      status: 'in_progress',
      call_id: callId,
      name: tool.name,
      arguments: '',
    };
    add(tool.startAtUs, 'response.output_item.added', { output_index: outputIndex, item });
    for (const part of tool.fragments) {
      add(part.atUs, 'response.function_call_arguments.delta', {
        item_id: itemId,
        output_index: outputIndex,
        delta: part.delta,
      });
    }
    if (!state.error) {
      const doneAt = tool.endAtUs ?? state.finish?.atUs ?? state.lastAtUs;
      const args = tool.fragments.map((part) => part.delta).join('');
      add(doneAt, 'response.function_call_arguments.done', {
        item_id: itemId,
        output_index: outputIndex,
        arguments: args,
      });
      add(doneAt, 'response.output_item.done', {
        output_index: outputIndex,
        item: { ...item, status: 'completed', arguments: args },
      });
    }
  });

  if (state.error) {
    add(state.error.atUs, 'error', {
      code: state.error.code ?? 'server_error',
      message: state.error.message,
      param: null,
    });
  } else {
    const status = responseStatus(state.finish?.reason);
    const terminal = status === 'incomplete' ? 'response.incomplete' : status === 'failed' ? 'response.failed' : 'response.completed';
    add(Math.max(state.finish?.atUs ?? state.lastAtUs, state.usage?.atUs ?? 0), terminal, {
      response: responseObject(scenario, state, options, status, true),
    });
  }

  pending.sort((a, b) => a.atUs - b.atUs || a.order - b.order);
  return pending.map((frame, sequenceNumber) => ({
    atMs: frame.atUs / 1000,
    data: namedSse(frame.event, { ...frame.payload, sequence_number: sequenceNumber }),
  }));
}

function compileAnthropicObject(
  scenario: ScenarioV1,
  state: ScenarioState,
  options: CompileOptions,
): unknown {
  const content: unknown[] = [];
  if (state.textFragments.length) content.push({ type: 'text', text: state.text });
  for (const tool of state.tools) {
    content.push({
      type: 'tool_use',
      id: targetId('toolu', scenario, options, tool.logicalId),
      name: tool.name,
      input: parseToolInput(tool),
    });
  }
  return {
    id: targetId('msg', scenario, options, state.messageId),
    type: 'message',
    role: 'assistant',
    model: options.model ?? 'mock-model',
    content,
    stop_reason: anthropicFinish(state.finish?.reason ?? (state.tools.length ? 'tool' : 'stop')),
    stop_sequence: null,
    usage: anthropicUsage(state.usage),
  };
}

function compileAnthropicStream(
  scenario: ScenarioV1,
  state: ScenarioState,
  options: CompileOptions,
): CompiledFrame[] {
  type Pending = { atUs: number; order: number; event: string; payload: Record<string, unknown> };
  const pending: Pending[] = [];
  let order = 0;
  const add = (atUs: number, event: string, payload: Record<string, unknown>) => {
    pending.push({ atUs, order: order++, event, payload: { type: event, ...payload } });
  };
  const inputTokens = state.usage?.inputTokens ?? 0;
  add(state.messageAtUs, 'message_start', {
    message: {
      id: targetId('msg', scenario, options, state.messageId),
      type: 'message',
      role: 'assistant',
      model: options.model ?? 'mock-model',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  });

  const blocks: Array<{ kind: 'text' | 'tool'; atUs: number; tool?: ToolState }> = [];
  if (state.textFragments.length) blocks.push({ kind: 'text', atUs: state.textStartAtUs ?? state.messageAtUs });
  for (const tool of state.tools) blocks.push({ kind: 'tool', atUs: tool.startAtUs, tool });
  blocks.sort((a, b) => a.atUs - b.atUs);

  blocks.forEach((block, index) => {
    if (block.kind === 'text') {
      add(block.atUs, 'content_block_start', { index, content_block: { type: 'text', text: '' } });
      for (const part of state.textFragments) {
        add(part.atUs, 'content_block_delta', {
          index,
          delta: { type: 'text_delta', text: part.delta },
        });
      }
      if (!state.error) {
        add(state.textEndAtUs ?? state.finish?.atUs ?? state.lastAtUs, 'content_block_stop', { index });
      }
      return;
    }
    const tool = block.tool!;
    add(tool.startAtUs, 'content_block_start', {
      index,
      content_block: {
        type: 'tool_use',
        id: targetId('toolu', scenario, options, tool.logicalId),
        name: tool.name,
        input: {},
      },
    });
    for (const part of tool.fragments) {
      add(part.atUs, 'content_block_delta', {
        index,
        delta: { type: 'input_json_delta', partial_json: part.delta },
      });
    }
    if (!state.error) add(tool.endAtUs ?? state.finish?.atUs ?? state.lastAtUs, 'content_block_stop', { index });
  });

  for (const ping of state.pings) add(ping.atUs, 'ping', {});
  if (state.error) {
    add(state.error.atUs, 'error', {
      error: { type: state.error.code ?? 'api_error', message: state.error.message },
    });
  } else {
    const terminalAt = Math.max(state.finish?.atUs ?? state.lastAtUs, state.usage?.atUs ?? 0);
    add(terminalAt, 'message_delta', {
      delta: {
        stop_reason: anthropicFinish(state.finish?.reason ?? (state.tools.length ? 'tool' : 'stop')),
        stop_sequence: null,
      },
      usage: { output_tokens: state.usage?.outputTokens ?? 0 },
    });
    add(terminalAt, 'message_stop', {});
  }
  pending.sort((a, b) => a.atUs - b.atUs || a.order - b.order);
  return pending.map((frame) => ({ atMs: frame.atUs / 1000, data: namedSse(frame.event, frame.payload) }));
}

function chatUsage(usage?: Extract<ScenarioEvent, { type: 'usage' }>): unknown {
  if (!usage) return null;
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
  };
}

function responsesUsage(usage?: Extract<ScenarioEvent, { type: 'usage' }>): unknown {
  if (!usage) return null;
  return {
    input_tokens: usage.inputTokens,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: usage.outputTokens,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
  };
}

function anthropicUsage(usage?: Extract<ScenarioEvent, { type: 'usage' }>): unknown {
  return { input_tokens: usage?.inputTokens ?? 0, output_tokens: usage?.outputTokens ?? 0 };
}

function chatFinish(reason: FinishReason): string {
  if (reason === 'tool') return 'tool_calls';
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'content_filter';
  return 'stop';
}

function anthropicFinish(reason: FinishReason): string {
  if (reason === 'tool') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return 'end_turn';
}

function responseStatus(reason?: FinishReason): 'completed' | 'incomplete' | 'failed' {
  if (reason === 'length' || reason === 'content_filter') return 'incomplete';
  if (reason === 'error') return 'failed';
  return 'completed';
}

function parseToolInput(tool: ToolState): Record<string, unknown> {
  const raw = tool.fragments.map((part) => part.delta).join('');
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Anthropic tool input must be a JSON object: ${tool.logicalId}`);
  }
}

function targetId(prefix: string, scenario: ScenarioV1, options: CompileOptions, logicalId: string): string {
  return `${prefix}_${shortHash(`${scenario.id}:${options.invocationId ?? 'default'}:${logicalId}`)}`;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function dataSse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function namedSse(event: string, value: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
}

function sortedFrames(frames: Array<CompiledFrame & { order: number }>): CompiledFrame[] {
  return frames
    .sort((a, b) => a.atMs - b.atMs || a.order - b.order)
    .map(({ atMs, data }) => ({ atMs, data }));
}

interface SseMessage {
  event?: string;
  data: string;
}

function parseSse(input: string): SseMessage[] {
  const messages: SseMessage[] = [];
  let event: string | undefined;
  let data: string[] = [];
  const dispatch = () => {
    if (data.length) messages.push({ event, data: data.join('\n') });
    event = undefined;
    data = [];
  };
  for (const rawLine of input.replace(/^\ufeff/, '').split(/\r\n|\n|\r/)) {
    if (rawLine === '') {
      dispatch();
      continue;
    }
    if (rawLine.startsWith(':')) continue;
    const colon = rawLine.indexOf(':');
    const field = colon < 0 ? rawLine : rawLine.slice(0, colon);
    let value = colon < 0 ? '' : rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  dispatch();
  if (!messages.length) throw new Error('Capture body is not valid SSE');
  return messages;
}

function parseJsonValue(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Capture body is not valid JSON: ${(error as Error).message}`);
  }
}

function parseJson(protocol: Protocol, value: unknown): ScenarioEvent[] {
  const object = asObject(value, 'response');
  const error = readError(object);
  if (error) return [{ type: 'error', atUs: 0, ...error }];
  if (protocol === 'openai-chat') return parseChatObject(object);
  if (protocol === 'openai-responses') return parseResponsesObject(object);
  return parseAnthropicObject(object);
}

function parseStream(protocol: Protocol, messages: SseMessage[]): ScenarioEvent[] {
  if (protocol === 'openai-chat') return parseChatStream(messages);
  if (protocol === 'openai-responses') return parseResponsesStream(messages);
  return parseAnthropicStream(messages);
}

function parseChatObject(object: Record<string, unknown>): ScenarioEvent[] {
  const choices = asArray(object.choices, 'choices');
  if (choices.length !== 1) throw new Error('Multiple OpenAI Chat choices cannot be transcoded');
  const choice = asObject(choices[0], 'choices[0]');
  const message = asObject(choice.message, 'choices[0].message');
  if (message.refusal) throw new Error('OpenAI Chat refusal content cannot be transcoded');
  const events: ScenarioEvent[] = [messageStart(0, stringValue(object.id) ?? 'message')];
  let atUs = 1_000;
  const content = readTextContent(message.content);
  if (content) {
    events.push({ type: 'text.start', atUs }, { type: 'text.delta', atUs: atUs += 1_000, delta: content });
    events.push({ type: 'text.end', atUs: atUs += 1_000 });
  }
  for (const [index, rawTool] of optionalArray(message.tool_calls).entries()) {
    const tool = asObject(rawTool, `tool_calls[${index}]`);
    if (tool.type !== undefined && tool.type !== 'function') {
      throw new Error(`Unsupported OpenAI Chat tool type: ${String(tool.type)}`);
    }
    const fn = asObject(tool.function, `tool_calls[${index}].function`);
    const id = stringValue(tool.id) ?? `tool-${index}`;
    events.push({ type: 'tool.start', atUs: atUs += 1_000, toolCallId: id, name: stringValue(fn.name) ?? `tool_${index}` });
    events.push({ type: 'tool.arguments.delta', atUs: atUs += 1_000, toolCallId: id, delta: stringValue(fn.arguments) ?? '' });
    events.push({ type: 'tool.end', atUs: atUs += 1_000, toolCallId: id });
  }
  const usage = readOpenAiUsage(object.usage, atUs += 1_000);
  if (usage) events.push(usage);
  events.push({ type: 'finish', atUs: atUs += 1_000, reason: chatReason(stringValue(choice.finish_reason)), sourceValue: stringValue(choice.finish_reason) });
  return events;
}

function parseChatStream(messages: SseMessage[]): ScenarioEvent[] {
  const events: ScenarioEvent[] = [];
  const tools = new Map<number, Extract<ScenarioEvent, { type: 'tool.start' }>>();
  let messageAdded = false;
  let done = false;
  let failed = false;
  let pendingFinish: Extract<ScenarioEvent, { type: 'finish' }> | undefined;
  let lastAtUs = 0;
  messages.forEach((message, index) => {
    if (done || failed) return;
    const atUs = index * 1_000;
    lastAtUs = atUs;
    if (message.data.trim() === '[DONE]') {
      done = true;
      return;
    }
    const object = asObject(parseJsonValue(message.data), `SSE event ${index}`);
    const error = readError(object);
    if (error) {
      events.push({ type: 'error', atUs, ...error });
      failed = true;
      return;
    }
    const usage = readOpenAiUsage(object.usage, atUs);
    if (usage) events.push(usage);
    const choices = optionalArray(object.choices);
    if (choices.length > 1) throw new Error('Multiple OpenAI Chat choices cannot be transcoded');
    for (const rawChoice of choices) {
      const choice = asObject(rawChoice, 'choice');
      const delta = asObject(choice.delta ?? {}, 'choice.delta');
      if (delta.refusal || delta.audio) {
        throw new Error('OpenAI Chat refusal or audio deltas cannot be transcoded');
      }
      if (!messageAdded) {
        events.push(messageStart(atUs, stringValue(object.id) ?? 'message'));
        messageAdded = true;
      }
      const content = stringValue(delta.content);
      if (content !== undefined) events.push({ type: 'text.delta', atUs, delta: content });
      for (const rawTool of optionalArray(delta.tool_calls)) {
        const tool = asObject(rawTool, 'delta.tool_calls[]');
        if (tool.type !== undefined && tool.type !== 'function') {
          throw new Error(`Unsupported OpenAI Chat tool type: ${String(tool.type)}`);
        }
        const toolIndex = numberValue(tool.index) ?? 0;
        const fn = asObject(tool.function ?? {}, 'delta.tool_calls[].function');
        let start = tools.get(toolIndex);
        if (!start) {
          start = {
            type: 'tool.start',
            atUs,
            toolCallId: stringValue(tool.id) ?? `tool-${toolIndex}`,
            name: stringValue(fn.name) ?? `tool_${toolIndex}`,
          };
          tools.set(toolIndex, start);
          events.push(start);
        } else if (stringValue(fn.name)) {
          start.name = start.name === `tool_${toolIndex}`
            ? stringValue(fn.name)!
            : start.name + stringValue(fn.name);
        }
        const fragment = stringValue(fn.arguments);
        if (fragment !== undefined) {
          events.push({ type: 'tool.arguments.delta', atUs, toolCallId: start.toolCallId, delta: fragment });
        }
      }
      const reason = stringValue(choice.finish_reason);
      if (reason) {
        for (const start of tools.values()) {
          events.push({ type: 'tool.end', atUs, toolCallId: start.toolCallId });
        }
        pendingFinish = { type: 'finish', atUs, reason: chatReason(reason), sourceValue: reason };
      }
    }
  });
  if (!messageAdded && !failed) events.unshift(messageStart(0, 'message'));
  if (!failed) {
    if (done) {
      events.push(pendingFinish ?? { type: 'finish', atUs: lastAtUs, reason: tools.size ? 'tool' : 'stop' });
    } else {
      events.push(incompleteStream(lastAtUs, 'OpenAI Chat SSE ended before [DONE]'));
    }
  }
  return events;
}

function parseResponsesObject(object: Record<string, unknown>): ScenarioEvent[] {
  const events: ScenarioEvent[] = [messageStart(0, stringValue(object.id) ?? 'message')];
  let atUs = 0;
  let hasTool = false;
  for (const [index, rawItem] of optionalArray(object.output).entries()) {
    const item = asObject(rawItem, `output[${index}]`);
    if (item.type === 'message') {
      for (const rawPart of optionalArray(item.content)) {
        const part = asObject(rawPart, 'output content');
        if (part.type === 'output_text' && typeof part.text === 'string') {
          events.push({ type: 'text.delta', atUs: atUs += 1_000, delta: part.text });
        } else {
          throw new Error(`Unsupported OpenAI Responses content type: ${String(part.type)}`);
        }
      }
    } else if (item.type === 'function_call') {
      hasTool = true;
      const id = stringValue(item.call_id) ?? stringValue(item.id) ?? `tool-${index}`;
      events.push({ type: 'tool.start', atUs: atUs += 1_000, toolCallId: id, name: stringValue(item.name) ?? `tool_${index}` });
      events.push({ type: 'tool.arguments.delta', atUs: atUs += 1_000, toolCallId: id, delta: stringValue(item.arguments) ?? '' });
      events.push({ type: 'tool.end', atUs: atUs += 1_000, toolCallId: id });
    } else {
      throw new Error(`Unsupported OpenAI Responses output type: ${String(item.type)}`);
    }
  }
  const usage = readResponsesUsage(object.usage, atUs += 1_000);
  if (usage) events.push(usage);
  const status = stringValue(object.status);
  if (status === 'failed' || object.error) {
    const error = readError(object) ?? { message: 'Response failed', code: 'response_failed' };
    events.push({ type: 'error', atUs: atUs += 1_000, ...error });
  } else {
    const incomplete = asOptionalObject(object.incomplete_details);
    events.push({
      type: 'finish',
      atUs: atUs += 1_000,
      reason: responsesReason(status, stringValue(incomplete?.reason), hasTool),
      sourceValue: status,
    });
  }
  return events;
}

function parseResponsesStream(messages: SseMessage[]): ScenarioEvent[] {
  const events: ScenarioEvent[] = [];
  const tools = new Map<string, { id: string; ended: boolean; hasDelta: boolean }>();
  let messageAdded = false;
  let terminal = false;
  let lastAtUs = 0;
  messages.forEach((message, index) => {
    if (terminal) return;
    const atUs = index * 1_000;
    lastAtUs = atUs;
    const object = asObject(parseJsonValue(message.data), `SSE event ${index}`);
    const type = message.event ?? stringValue(object.type) ?? '';
    if (type === 'response.created' || type === 'response.in_progress') {
      const response = asOptionalObject(object.response);
      if (!messageAdded) {
        events.push(messageStart(atUs, stringValue(response?.id) ?? 'message'));
        messageAdded = true;
      }
    } else if (type === 'response.output_item.added') {
      const item = asObject(object.item, 'response.output_item.added.item');
      if (item.type === 'function_call') {
        const key = stringValue(item.id) ?? String(numberValue(object.output_index) ?? tools.size);
        const id = stringValue(item.call_id) ?? key;
        tools.set(key, { id, ended: false, hasDelta: false });
        events.push({ type: 'tool.start', atUs, toolCallId: id, name: stringValue(item.name) ?? 'tool' });
      } else if (item.type !== 'message') {
        throw new Error(`Unsupported OpenAI Responses output type: ${String(item.type)}`);
      }
    } else if (type === 'response.output_text.delta') {
      events.push({ type: 'text.delta', atUs, delta: stringValue(object.delta) ?? '' });
    } else if (type === 'response.function_call_arguments.delta') {
      const key = stringValue(object.item_id) ?? String(numberValue(object.output_index) ?? 0);
      const tool = tools.get(key);
      if (!tool) throw new Error(`Responses tool delta references unknown item: ${key}`);
      tool.hasDelta = true;
      events.push({ type: 'tool.arguments.delta', atUs, toolCallId: tool.id, delta: stringValue(object.delta) ?? '' });
    } else if (type === 'response.function_call_arguments.done') {
      const key = stringValue(object.item_id) ?? String(numberValue(object.output_index) ?? 0);
      const tool = tools.get(key);
      if (!tool) throw new Error(`Responses tool completion references unknown item: ${key}`);
      if (!tool.hasDelta && typeof object.arguments === 'string') {
        events.push({ type: 'tool.arguments.delta', atUs, toolCallId: tool.id, delta: object.arguments });
      }
      events.push({ type: 'tool.end', atUs, toolCallId: tool.id });
      tool.ended = true;
    } else if (type === 'response.output_item.done') {
      const item = asObject(object.item, 'response.output_item.done.item');
      if (item.type === 'function_call') {
        const key = stringValue(item.id) ?? String(numberValue(object.output_index) ?? 0);
        const tool = tools.get(key);
        if (!tool) throw new Error(`Responses tool completion references unknown item: ${key}`);
        if (!tool.hasDelta && typeof item.arguments === 'string') {
          events.push({ type: 'tool.arguments.delta', atUs, toolCallId: tool.id, delta: item.arguments });
        }
        if (!tool.ended) events.push({ type: 'tool.end', atUs, toolCallId: tool.id });
        tool.ended = true;
      } else if (item.type !== 'message') {
        throw new Error(`Unsupported OpenAI Responses output type: ${String(item.type)}`);
      }
    } else if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.failed') {
      const response = asObject(object.response, `${type}.response`);
      const usage = readResponsesUsage(response.usage, atUs);
      if (usage) events.push(usage);
      for (const tool of tools.values()) {
        if (!tool.ended) events.push({ type: 'tool.end', atUs, toolCallId: tool.id });
      }
      if (type === 'response.failed') {
        const error = readError(response) ?? { message: 'Response failed', code: 'response_failed' };
        events.push({ type: 'error', atUs, ...error });
      } else {
        const incomplete = asOptionalObject(response.incomplete_details);
        events.push({
          type: 'finish',
          atUs,
          reason: responsesReason(stringValue(response.status), stringValue(incomplete?.reason), tools.size > 0),
          sourceValue: stringValue(response.status),
        });
      }
      terminal = true;
    } else if (type === 'error') {
      const error = readError(object) ?? {
        message: stringValue(object.message) ?? 'Response stream error',
        code: stringValue(object.code) ?? 'stream_error',
      };
      events.push({ type: 'error', atUs, ...error });
      terminal = true;
    } else if (type === 'ping') {
      events.push({ type: 'ping', atUs });
    } else if (![
      'response.content_part.added',
      'response.content_part.done',
      'response.output_text.done',
    ].includes(type)) {
      throw new Error(`Unsupported OpenAI Responses stream event: ${type || '(missing type)'}`);
    }
  });
  if (!messageAdded && !terminal) events.unshift(messageStart(0, 'message'));
  if (!terminal) events.push(incompleteStream(lastAtUs, 'OpenAI Responses SSE ended before a terminal event'));
  return events;
}

function parseAnthropicObject(object: Record<string, unknown>): ScenarioEvent[] {
  const events: ScenarioEvent[] = [messageStart(0, stringValue(object.id) ?? 'message')];
  let atUs = 0;
  for (const [index, rawBlock] of optionalArray(object.content).entries()) {
    const block = asObject(rawBlock, `content[${index}]`);
    if (block.type === 'text') {
      events.push({ type: 'text.delta', atUs: atUs += 1_000, delta: stringValue(block.text) ?? '' });
    } else if (block.type === 'tool_use') {
      const id = stringValue(block.id) ?? `tool-${index}`;
      events.push({ type: 'tool.start', atUs: atUs += 1_000, toolCallId: id, name: stringValue(block.name) ?? `tool_${index}` });
      events.push({ type: 'tool.arguments.delta', atUs: atUs += 1_000, toolCallId: id, delta: JSON.stringify(block.input ?? {}) });
      events.push({ type: 'tool.end', atUs: atUs += 1_000, toolCallId: id });
    } else {
      throw new Error(`Unsupported Anthropic content block: ${String(block.type)}`);
    }
  }
  const usage = readAnthropicUsage(object.usage, atUs += 1_000);
  if (usage) events.push(usage);
  const reason = stringValue(object.stop_reason);
  events.push({ type: 'finish', atUs: atUs += 1_000, reason: anthropicReason(reason), sourceValue: reason });
  return events;
}

function parseAnthropicStream(messages: SseMessage[]): ScenarioEvent[] {
  const events: ScenarioEvent[] = [];
  const blocks = new Map<number, { kind: 'text' | 'tool'; toolId?: string }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let finish: Extract<ScenarioEvent, { type: 'finish' }> | undefined;
  let terminal = false;
  let messageAdded = false;
  let lastAtUs = 0;
  messages.forEach((message, index) => {
    if (terminal) return;
    const atUs = index * 1_000;
    lastAtUs = atUs;
    const object = asObject(parseJsonValue(message.data), `SSE event ${index}`);
    const type = message.event ?? stringValue(object.type) ?? '';
    if (type === 'message_start') {
      const value = asObject(object.message, 'message_start.message');
      events.push(messageStart(atUs, stringValue(value.id) ?? 'message'));
      messageAdded = true;
      const usage = asOptionalObject(value.usage);
      inputTokens = numberValue(usage?.input_tokens) ?? 0;
      outputTokens = numberValue(usage?.output_tokens) ?? 0;
    } else if (type === 'content_block_start') {
      const blockIndex = numberValue(object.index) ?? blocks.size;
      const block = asObject(object.content_block, 'content_block_start.content_block');
      if (block.type === 'tool_use') {
        const toolId = stringValue(block.id) ?? `tool-${blockIndex}`;
        blocks.set(blockIndex, { kind: 'tool', toolId });
        events.push({ type: 'tool.start', atUs, toolCallId: toolId, name: stringValue(block.name) ?? 'tool' });
        const input = asOptionalObject(block.input);
        if (input && Object.keys(input).length) {
          events.push({ type: 'tool.arguments.delta', atUs, toolCallId: toolId, delta: JSON.stringify(input) });
        }
      } else if (block.type === 'text') {
        blocks.set(blockIndex, { kind: 'text' });
        if (typeof block.text === 'string' && block.text) {
          events.push({ type: 'text.delta', atUs, delta: block.text });
        }
      } else {
        throw new Error(`Unsupported Anthropic content block: ${String(block.type)}`);
      }
    } else if (type === 'content_block_delta') {
      const blockIndex = numberValue(object.index) ?? 0;
      const block = blocks.get(blockIndex);
      const delta = asObject(object.delta, 'content_block_delta.delta');
      if (delta.type === 'input_json_delta') {
        if (!block?.toolId) throw new Error(`Anthropic tool delta references unknown block: ${blockIndex}`);
        events.push({ type: 'tool.arguments.delta', atUs, toolCallId: block.toolId, delta: stringValue(delta.partial_json) ?? '' });
      } else if (delta.type === 'text_delta') {
        events.push({ type: 'text.delta', atUs, delta: stringValue(delta.text) ?? '' });
      } else {
        throw new Error(`Unsupported Anthropic delta: ${String(delta.type)}`);
      }
    } else if (type === 'content_block_stop') {
      const block = blocks.get(numberValue(object.index) ?? 0);
      if (block?.kind === 'tool' && block.toolId) {
        events.push({ type: 'tool.end', atUs, toolCallId: block.toolId });
      }
    } else if (type === 'message_delta') {
      const delta = asObject(object.delta ?? {}, 'message_delta.delta');
      const reason = stringValue(delta.stop_reason);
      const usage = asOptionalObject(object.usage);
      outputTokens = numberValue(usage?.output_tokens) ?? outputTokens;
      if (reason) finish = { type: 'finish', atUs, reason: anthropicReason(reason), sourceValue: reason };
    } else if (type === 'ping') {
      events.push({ type: 'ping', atUs });
    } else if (type === 'error') {
      const error = readError(object) ?? { message: 'Anthropic stream error', code: 'api_error' };
      events.push({ type: 'error', atUs, ...error });
      terminal = true;
    } else if (type === 'message_stop') {
      events.push({ type: 'usage', atUs, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens });
      events.push(finish ?? { type: 'finish', atUs, reason: 'stop' });
      terminal = true;
    } else {
      throw new Error(`Unsupported Anthropic stream event: ${type || '(missing type)'}`);
    }
  });
  if (!messageAdded && !terminal) events.unshift(messageStart(0, 'message'));
  if (!terminal) events.push(incompleteStream(lastAtUs, 'Anthropic SSE ended before message_stop'));
  return events;
}

function readTextContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((rawPart) => {
    const part = asObject(rawPart, 'message.content[]');
    if (part.type !== 'text') {
      throw new Error(`Unsupported OpenAI Chat content type: ${String(part.type)}`);
    }
    return stringValue(part.text) ?? '';
  }).join('');
}

function readOpenAiUsage(value: unknown, atUs: number): Extract<ScenarioEvent, { type: 'usage' }> | undefined {
  const usage = asOptionalObject(value);
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.prompt_tokens);
  const outputTokens = numberValue(usage.completion_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return {
    type: 'usage',
    atUs,
    inputTokens,
    outputTokens,
    totalTokens: numberValue(usage.total_tokens) ?? inputTokens + outputTokens,
  };
}

function readResponsesUsage(value: unknown, atUs: number): Extract<ScenarioEvent, { type: 'usage' }> | undefined {
  const usage = asOptionalObject(value);
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return {
    type: 'usage',
    atUs,
    inputTokens,
    outputTokens,
    totalTokens: numberValue(usage.total_tokens) ?? inputTokens + outputTokens,
  };
}

function readAnthropicUsage(value: unknown, atUs: number): Extract<ScenarioEvent, { type: 'usage' }> | undefined {
  const usage = asOptionalObject(value);
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return { type: 'usage', atUs, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function readError(object: Record<string, unknown>): { message: string; code?: string; status?: number } | undefined {
  const nested = asOptionalObject(object.error);
  if (!nested) return undefined;
  return {
    message: stringValue(nested.message) ?? 'Provider error',
    code: stringValue(nested.code) ?? stringValue(nested.type),
  };
}

function messageStart(atUs: number, messageId: string): Extract<ScenarioEvent, { type: 'message.start' }> {
  return { type: 'message.start', atUs, messageId, role: 'assistant' };
}

function incompleteStream(atUs: number, message: string): Extract<ScenarioEvent, { type: 'error' }> {
  return { type: 'error', atUs, code: 'incomplete_stream', message, status: 502 };
}

function chatReason(value?: string): FinishReason {
  if (value === 'tool_calls' || value === 'function_call') return 'tool';
  if (value === 'length') return 'length';
  if (value === 'content_filter') return 'content_filter';
  return 'stop';
}

function responsesReason(status?: string, incompleteReason?: string, hasTool = false): FinishReason {
  if (status === 'failed') return 'error';
  if (status === 'incomplete') {
    return incompleteReason === 'content_filter' ? 'content_filter' : 'length';
  }
  return hasTool ? 'tool' : 'stop';
}

function anthropicReason(value?: string): FinishReason {
  if (value === 'tool_use') return 'tool';
  if (value === 'max_tokens' || value === 'model_context_window_exceeded') return 'length';
  if (value === 'refusal') return 'content_filter';
  if (value === 'pause_turn') return 'other';
  return 'stop';
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asOptionalObject(value: unknown): Record<string, unknown> | undefined {
  return value && !Array.isArray(value) && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${path} must be a non-empty array`);
  return value;
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
