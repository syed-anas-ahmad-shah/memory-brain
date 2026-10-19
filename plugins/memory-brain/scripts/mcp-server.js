#!/usr/bin/env node
'use strict';
// Memory Brain MCP server: four tools over the memory folder, spoken as JSON-RPC (one message per line) on stdin/stdout.
// No dependencies. Logs go to stderr only; stdout carries nothing but protocol messages.
const path = require('path');
const readline = require('readline');
const { TOOLS, call } = require('./lib/memory-tools');
const VERSION = (() => { try { return require('../.claude-plugin/plugin.json').version; } catch { return '0.0.0'; } })();

function brainDir() {
  const env = process.env.MEMORY_BRAIN_DIR;
  if (env && !env.startsWith('${')) return path.resolve(env);
  try { return require('./lib/config').load().brain_dir; } catch { return ''; }
}

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  if (method === 'initialize') {
    return reply(id, { protocolVersion: (params && params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'memory-brain', version: VERSION } });
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return;
  if (method === 'ping') return isRequest ? reply(id, {}) : undefined;
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params && params.name;
    if (!TOOLS.some((t) => t.name === name)) return reply(id, { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true });
    const r = call(name, (params && params.arguments) || {}, { brain: brainDir(), cwd: process.cwd() });
    return reply(id, { content: [{ type: 'text', text: r.text }], ...(r.isError ? { isError: true } : {}) });
  }
  if (isRequest) error(id, -32601, `method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return error(null, -32700, 'parse error'); }
  try { for (const m of Array.isArray(msg) ? msg : [msg]) handle(m); } catch (e) { console.error('memory-brain: ' + e.message); }
});
rl.on('close', () => process.exit(0));
