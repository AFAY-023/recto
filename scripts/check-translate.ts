// Offline check of the Claude request shape and response parsing (no network).
import { ClaudeTranslator } from '../src/lib/translate';

let captured: any = null;
globalThis.fetch = (async (url: any, init: any) => {
  captured = { url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(init.body) };
  const ids = JSON.parse(captured.body.messages[0].content.split('Segments:\n')[1]).map((s: any) => s.id);
  const message = {
    id: 'msg_test', type: 'message', role: 'assistant', model: captured.body.model,
    content: [{ type: 'text', text: JSON.stringify({ segments: ids.map((id: string) => ({ id, translation: `译:${id}` })) }) }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
  };
  return new Response(JSON.stringify(message), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
}) as typeof fetch;

const t = new ClaudeTranslator('sk-ant-test', 'claude-opus-5-5');
const out = await t.translate(
  [{ id: 'p1-r1', text: 'Press the switch.' }, { id: 'p1-r2', text: 'Lid button' }],
  { sourceLang: 'en', targetLang: 'zh-CN', glossary: 'lid = 壶盖', context: [] },
);
console.log('result', Object.fromEntries(out));
console.log('url', captured.url);
console.log('beta header', captured.headers['anthropic-beta'], '| browser header', captured.headers['anthropic-dangerous-direct-browser-access']);
const { messages, system, output_config, ...rest } = captured.body;
console.log('body', JSON.stringify(rest), JSON.stringify({ effort: output_config.effort, format: output_config.format?.type }));
const haiku = new ClaudeTranslator('sk-ant-test', 'claude-haiku-5-5');
await haiku.translate([{ id: 'x', text: 'Hi there' }], { sourceLang: 'auto', targetLang: 'ja', glossary: '', context: [] });
console.log('haiku body keys', Object.keys(captured.body).join(','), '| beta', captured.headers['anthropic-beta'] ?? '(none)');

// ---- DeepSeek (OpenAI-compatible) ----
import { DeepSeekTranslator } from '../src/lib/translate';
let dsCalls = 0;
globalThis.fetch = (async (url: any, init: any) => {
  dsCalls++;
  captured = { url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(init.body) };
  // First reply is empty (a documented DeepSeek quirk) to exercise the retry.
  const content =
    dsCalls === 1
      ? ''
      : JSON.stringify({ segments: [{ id: 'p1-r1', translation: '按下开关。' }] });
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;
const ds = new DeepSeekTranslator('sk-test', 'deepseek-flash');
const dsOut = await ds.translate([{ id: 'p1-r1', text: 'Press the switch.' }], { sourceLang: 'en', targetLang: 'zh-CN', glossary: '', context: [] });
console.log('deepseek result', Object.fromEntries(dsOut), 'calls', dsCalls);
const { messages: dm, ...drest } = captured.body;
console.log('deepseek url', captured.url, '| auth', captured.headers.authorization);
console.log('deepseek body', JSON.stringify(drest), '| system mentions json:', /json/i.test(dm[0].content));

globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 })) as typeof fetch;
await ds.translate([{ id: 'x', text: 'Hi' }], { sourceLang: 'en', targetLang: 'zh-CN', glossary: '', context: [] }).catch((e) => console.log('401 ->', e.message));

// ---- AI reading (vision OCR) request shapes ----
import { createAiReader } from '../src/lib/aiocr';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
let visionBody: any = null;
globalThis.fetch = (async (url: any, init: any) => {
  visionBody = { url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(init.body) };
  const lines = [{ n: 1, text: 'わたしは マイク・ミラーです。', kind: 'text' }, { n: 2, text: '5', kind: 'number' }];
  if (String(url).includes('deepseek')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines }) }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(
    JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: visionBody.body.model, content: [{ type: 'text', text: JSON.stringify({ lines }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
    { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req' } },
  );
}) as typeof fetch;
for (const provider of ['anthropic', 'deepseek'] as const) {
  const reader = createAiReader({ ...DEFAULT_SETTINGS, provider, claudeKey: 'sk-ant-test', deepseekKey: 'sk-test', deepseekModel: 'deepseek-v4-pro', aiOcr: true })!;
  const result = await reader.read('AAAA', [1, 2], { sourceLang: 'ja' });
  const msgs = visionBody.body.messages;
  const user = msgs.find((m: any) => m.role === 'user');
  console.log(provider, '→', reader.label, '| model', visionBody.body.model, '| image block', user.content[0].type, '| result', JSON.stringify(Object.fromEntries(result)));
}
