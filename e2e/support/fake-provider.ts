/**
 * Offline fake model for the Electron E2E specs: an OpenAI-compatible chat
 * completions server on an ephemeral 127.0.0.1 port. No real provider is
 * ever contacted.
 *
 * The fake reads each request the way a model would — from its messages and
 * the app's turn hint — and answers deterministically by model name:
 * - `e2e-vote-*`: fixed vote ballots.
 * - Private reply hints: `e2e-whisper-b` answers the first reply of a thread;
 *   on a later reply hint ("they answered you", spec 2026-10-01 F2-5)
 *   `e2e-whisper-a` answers once more and every other model answers null, so
 *   an A→B whisper thread is exactly three rows long.
 * - `e2e-silent-*`: stays silent on every room turn (spec 2026-10-01 F3).
 * - A pass-round hint (spec 2026-10-01 F1-4): a public line naming the model.
 * - `e2e-whisper-a` with the root marker: whispers to the configured name,
 *   picking that participant's opaque alias from the hint (spec 2026-09-29 §C).
 * - Anything else: a fixed public or plain reply.
 *
 * `hold(model)` keeps every response of that model pending until the
 * returned release runs, so a spec can watch a turn in progress.
 *
 * It also answers Ollama's own `GET /api/version` and `GET /api/tags`, so
 * local AI detection — pointed here through `OLLAMA_HOST` — sees a running
 * Ollama. `/api/tags` lists {@link FAKE_OLLAMA_MODEL} plus every model a
 * spec offered with `offerOllamaModel` (`support/local-ai.ts` adds AIs that
 * way, the only way a local AI can be added).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface ChatRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
}

export interface CapturedChatRequest extends ChatRequest {
  reply: string;
  authorization: string | undefined;
  /** The request body exactly as the app sent it to the model. */
  rawBody: string;
}

export interface FakeProvider {
  baseUrl: string;
  requests: CapturedChatRequest[];
  /** Display name the whispering fake model picks from its room-turn hint. */
  setWhisperRecipientName: (name: string) => void;
  /** Holds every response of `model` until the returned function runs. */
  hold: (model: string) => () => void;
  /** Lists `model` in the fake Ollama's `/api/tags` from now on. */
  offerOllamaModel: (model: string) => void;
  close: () => Promise<void>;
}

/** Hint markers the fake reads, as written by `src/main/channels/chat-whisper-output.ts`. */
const ROOM_TURN_MARKER = 'Room turn:';
const PRIVATE_REPLY_MARKER = 'Private reply to ';
const THREAD_CONTINUATION_MARKER = 'they answered you.';
const PASS_ROUND_MARKER = 'The user passed without adding anything.';
const HINT_PARTICIPANTS_MARKER = 'at most once each: ';

/** The one model the fake Ollama lists in `/api/tags`. */
export const FAKE_OLLAMA_MODEL = 'chat-first-model';
const FAKE_OLLAMA_VERSION = '0.0.0-e2e';

/** Thread texts the whisper spec asserts on. */
export const E2E_WHISPER_TEXT = {
  root: 'E2E_SECRET_A_TO_B',
  firstReply: 'E2E_PRIVATE_REPLY',
  secondReply: 'E2E_PRIVATE_A_AGAIN',
} as const;

/** Public line of a pass round for one model. */
export function passPublicLine(model: string): string {
  return `E2E_PASS_PUBLIC_${model}`;
}

/**
 * The `[{"id":"p-…","name":"…"}]` participant list of the latest room-turn
 * hint in this request, read the way a model reads it. Models only ever see
 * opaque aliases there, so the fake model addresses a whisper by picking the
 * alias listed for a display name (spec 2026-09-29 §C).
 */
function hintParticipants(messages: ChatRequest['messages']): Array<{ id: string; name: string }> {
  const hint = messages.map((message) => message.content).reverse()
    .find((content) => content.includes(ROOM_TURN_MARKER) && content.includes(HINT_PARTICIPANTS_MARKER));
  if (hint === undefined) throw new Error('Room-turn hint with a participant list is missing');
  const list = hint.slice(hint.indexOf(HINT_PARTICIPANTS_MARKER) + HINT_PARTICIPANTS_MARKER.length);
  return JSON.parse(list.slice(0, list.indexOf(']. ') + 1)) as Array<{ id: string; name: string }>;
}

const VOTE_REPLIES: Record<string, string> = {
  'e2e-vote-agree': JSON.stringify({ opinion: 'The plan is practical.', vote: 'agree' }),
  'e2e-vote-oppose': JSON.stringify({ opinion: 'The cost is too high.', vote: 'oppose' }),
  'e2e-vote-abstain': JSON.stringify({ opinion: 'More evidence is needed.', vote: 'abstain' }),
  'e2e-vote-invalid': 'This is not a vote JSON response.',
};

function plainReplyFor(latestUserMessage: string, model: string | undefined): string {
  if (latestUserMessage.includes('CF4_GENERAL_FIRST')) return 'CF4_REPLY_GENERAL_1';
  if (latestUserMessage.includes('CF4_GENERAL_SECOND')) return 'CF4_REPLY_GENERAL_2';
  if (latestUserMessage.includes('CF4_DM_MESSAGE')) return 'CF4_REPLY_DM_1';
  if (latestUserMessage.includes('E2E_WHISPER_FOLLOWUP')) return `E2E_PUBLIC_FOLLOWUP_${model ?? 'unknown'}`;
  if (latestUserMessage.includes('E2E_WHISPER_ROOT')) return `E2E_PUBLIC_${model ?? 'unknown'}`;
  return 'CF4_REPLY_OTHER';
}

function decideReply(body: ChatRequest, whisperRecipientName: string | null): string {
  const has = (marker: string): boolean => body.messages.some((message) => message.content.includes(marker));
  const latestUserMessage = body.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '';
  if (body.model && VOTE_REPLIES[body.model] !== undefined &&
    has('Respond with only JSON {"opinion"')) return VOTE_REPLIES[body.model]!;
  const isPrivateReply = has(PRIVATE_REPLY_MARKER);
  const isGroup = isPrivateReply || has(ROOM_TURN_MARKER);
  const plainReply = plainReplyFor(latestUserMessage, body.model);
  if (isPrivateReply) {
    if (has(THREAD_CONTINUATION_MARKER)) {
      return JSON.stringify({ reply: body.model === 'e2e-whisper-a' ? E2E_WHISPER_TEXT.secondReply : null });
    }
    return JSON.stringify({ reply: body.model === 'e2e-whisper-b' ? E2E_WHISPER_TEXT.firstReply : plainReply });
  }
  if (isGroup && body.model?.startsWith('e2e-silent-')) return JSON.stringify({ public: null, whispers: [] });
  if (isGroup && has(PASS_ROUND_MARKER)) {
    return JSON.stringify({ public: passPublicLine(body.model ?? 'unknown'), whispers: [] });
  }
  if (isGroup && body.model === 'e2e-whisper-a' && latestUserMessage.includes('E2E_WHISPER_ROOT')) {
    if (!whisperRecipientName) throw new Error('Whisper E2E recipient was not configured');
    const recipientId = hintParticipants(body.messages).find((item) => item.name === whisperRecipientName)?.id;
    if (!recipientId) throw new Error(`Room-turn hint does not list ${whisperRecipientName}`);
    return JSON.stringify({ public: null, whispers: [{ recipientId, content: E2E_WHISPER_TEXT.root }] });
  }
  return isGroup ? JSON.stringify({ public: plainReply, whispers: [] }) : plainReply;
}

interface FakeState {
  requests: CapturedChatRequest[];
  whisperRecipientName: string | null;
  holds: Map<string, Promise<void>>;
  /** Models the fake Ollama lists, in the order they were offered. */
  ollamaModels: string[];
}

function captureChatRequest(request: IncomingMessage, response: ServerResponse, state: FakeState): void {
  request.setEncoding('utf8');
  const chunks: string[] = [];
  request.on('data', (chunk: string) => chunks.push(chunk));
  request.on('end', () => {
    void (async () => {
      const rawBody = chunks.join('');
      let body: ChatRequest;
      try {
        body = JSON.parse(rawBody) as ChatRequest;
      } catch {
        response.writeHead(400).end('Invalid JSON');
        return;
      }
      const reply = decideReply(body, state.whisperRecipientName);
      state.requests.push({ ...body, reply, authorization: request.headers.authorization, rawBody });
      const hold = body.model ? state.holds.get(body.model) : undefined;
      if (hold) await hold;
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    })();
  });
}

export async function startFakeProvider(): Promise<FakeProvider> {
  const state: FakeState = {
    requests: [], whisperRecipientName: null, holds: new Map(), ollamaModels: [FAKE_OLLAMA_MODEL],
  };
  const server: Server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'chat-first-model', object: 'model' }] }));
      return;
    }
    if (request.method === 'GET' && request.url === '/api/version') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ version: FAKE_OLLAMA_VERSION }));
      return;
    }
    if (request.method === 'GET' && request.url === '/api/tags') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ models: state.ollamaModels.map((name) => ({ name })) }));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      captureChatRequest(request, response, state);
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Fake provider did not bind an ephemeral TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: state.requests,
    setWhisperRecipientName: (name) => { state.whisperRecipientName = name; },
    offerOllamaModel: (model) => {
      if (!state.ollamaModels.includes(model)) state.ollamaModels.push(model);
    },
    hold: (model) => {
      let release: () => void = () => undefined;
      state.holds.set(model, new Promise<void>((resolveHold) => { release = resolveHold; }));
      return () => {
        state.holds.delete(model);
        release();
      };
    },
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
  };
}
