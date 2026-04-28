/**
 * Inline web client HTML for remote access.
 *
 * Returns a self-contained HTML string (no external dependencies)
 * that provides a mobile-friendly viewer for:
 * - Token-based authentication
 * - Conversation list browsing
 * - Conversation message reading
 * - Memory search
 *
 * Served at GET / by the remote HTTP server.
 *
 * F5-T4 (D5): UI 라벨은 main-process 사전 (NotificationDictionary 와 동일
 * 패턴) 으로 분리한다. main bundle 은 의도적으로 i18next 를 import 하지 않
 * 으므로 정적 dictionary 로 ko/en 을 보유하고, 호출자 (remote-server) 가
 * 현재 OS 알림 locale 을 그대로 전달한다. dictionary 는 client-side JS 로
 * 직렬화돼 LABELS 전역으로 주입된다.
 */

import {
  getNotificationLocale,
  type NotificationLocale,
} from '../notifications/notification-labels';

/** Re-export for caller readability — same locale union as notifications. */
export type RemoteWebClientLocale = NotificationLocale;

/**
 * UI label dictionary mirrored across `ko` / `en`. Keys are intentionally
 * flat (no nesting) because the entire object is JSON-serialised into
 * the page so the client JS reads `LABELS.key` directly. Adding a key
 * here requires populating both locale entries — the test pins parity.
 */
export interface RemoteWebClientDictionary {
  pageTitle: string;
  brandName: string;
  tokenSavedHint: string;
  tokenPrompt: string;
  tokenPlaceholder: string;
  tokenRequired: string;
  authFailedPrefix: string;
  connectButton: string;
  loading: string;
  searching: string;
  emptyConversations: string;
  emptyResults: string;
  emptyMessages: string;
  untitledConversation: string;
  memQueryPlaceholder: string;
  searchButton: string;
  relevanceLabel: string;
  logoutButton: string;
  tabConversations: string;
  tabMemory: string;
  backToList: string;
}

const KO: RemoteWebClientDictionary = {
  pageTitle: 'AI Chat Arena — 원격',
  brandName: 'AI Chat Arena',
  tokenSavedHint: '저장된 토큰이 있습니다. 다시 입력하거나 연결하세요.',
  tokenPrompt: '접속 토큰을 입력하세요.',
  tokenPlaceholder: '토큰 입력...',
  tokenRequired: '토큰을 입력하세요.',
  authFailedPrefix: '인증 실패: ',
  connectButton: '연결',
  loading: '불러오는 중...',
  searching: '검색 중...',
  emptyConversations: '대화가 없습니다.',
  emptyResults: '검색 결과가 없습니다.',
  emptyMessages: '메시지가 없습니다.',
  untitledConversation: '(제목 없음)',
  memQueryPlaceholder: '검색어 입력...',
  searchButton: '검색',
  relevanceLabel: '관련도:',
  logoutButton: '로그아웃',
  tabConversations: '대화',
  tabMemory: '메모리',
  backToList: '← 목록으로',
};

const EN: RemoteWebClientDictionary = {
  pageTitle: 'AI Chat Arena — Remote',
  brandName: 'AI Chat Arena',
  tokenSavedHint: 'A saved token is on file. Re-enter it or connect.',
  tokenPrompt: 'Enter your access token.',
  tokenPlaceholder: 'Enter token...',
  tokenRequired: 'Please enter a token.',
  authFailedPrefix: 'Authentication failed: ',
  connectButton: 'Connect',
  loading: 'Loading...',
  searching: 'Searching...',
  emptyConversations: 'No conversations.',
  emptyResults: 'No results.',
  emptyMessages: 'No messages.',
  untitledConversation: '(untitled)',
  memQueryPlaceholder: 'Enter query...',
  searchButton: 'Search',
  relevanceLabel: 'Relevance:',
  logoutButton: 'Sign out',
  tabConversations: 'Conversations',
  tabMemory: 'Memory',
  backToList: '← Back to list',
};

const DICTIONARIES: Record<RemoteWebClientLocale, RemoteWebClientDictionary> = {
  ko: KO,
  en: EN,
};

function dictionaryFor(
  locale: RemoteWebClientLocale,
): RemoteWebClientDictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES.ko;
}

/**
 * Escapes string content destined for an HTML attribute or PCDATA so a
 * pathological dictionary entry never injects markup. The dictionaries
 * shipped here are static, but escaping keeps the contract local and
 * survives a future translator-supplied entry without re-auditing.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns the remote web-client HTML for the given locale. When omitted,
 * the active OS-notification locale is used so the remote viewer matches
 * the desktop UI without a separate setting.
 */
export function getRemoteWebClientHtml(
  locale: RemoteWebClientLocale = getNotificationLocale(),
): string {
  const labels = dictionaryFor(locale);
  // Serialise the dictionary into the page so the client-side JS can do
  // simple `LABELS.key` lookups. JSON.stringify already produces a valid
  // JS literal — no XSS surface because the dictionary is static, but the
  // </script> sequence is escaped defensively in case a future entry
  // contains it.
  const labelsJson = JSON.stringify(labels).replace(/<\/script/gi, '<\\/script');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>${escapeHtml(labels.pageTitle)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f5f5f5; color: #333; line-height: 1.5;
  }
  .header {
    background: #1a73e8; color: #fff; padding: 12px 16px;
    display: flex; align-items: center; justify-content: space-between;
    position: sticky; top: 0; z-index: 10;
  }
  .header h1 { font-size: 16px; font-weight: 600; }
  .header button {
    background: rgba(255,255,255,0.2); color: #fff; border: none;
    padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;
  }
  .container { max-width: 720px; margin: 0 auto; padding: 16px; }
  .card {
    background: #fff; border-radius: 10px; padding: 16px; margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  input, select {
    width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px;
    font-size: 15px; margin-bottom: 8px; -webkit-appearance: none;
  }
  input:focus { outline: none; border-color: #1a73e8; }
  .btn {
    display: inline-block; padding: 10px 20px; background: #1a73e8; color: #fff;
    border: none; border-radius: 8px; font-size: 15px; cursor: pointer;
    font-weight: 600; width: 100%; text-align: center;
  }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-outline {
    background: #fff; color: #1a73e8; border: 1px solid #1a73e8;
  }
  .btn-sm { padding: 6px 14px; font-size: 13px; width: auto; }
  .conv-item {
    padding: 12px 0; border-bottom: 1px solid #f0f0f0; cursor: pointer;
  }
  .conv-item:last-child { border-bottom: none; }
  .conv-item:active { background: #f0f7ff; }
  .conv-title { font-weight: 600; font-size: 15px; }
  .conv-mode { font-size: 12px; color: #888; margin-top: 2px; }
  .msg { padding: 10px 14px; margin-bottom: 8px; border-radius: 10px; font-size: 14px; }
  .msg-user { background: #e3f2fd; margin-left: 24px; }
  .msg-assistant { background: #fff; border: 1px solid #e0e0e0; margin-right: 24px; }
  .msg-role { font-size: 11px; color: #888; margin-bottom: 4px; font-weight: 600; }
  .msg-content { white-space: pre-wrap; word-break: break-word; }
  .back-btn {
    background: none; border: none; color: #1a73e8; cursor: pointer;
    font-size: 14px; padding: 8px 0; margin-bottom: 8px; display: inline-block;
  }
  .tab-bar {
    display: flex; gap: 0; margin-bottom: 16px; background: #fff;
    border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .tab-bar button {
    flex: 1; padding: 10px; border: none; background: #fff; cursor: pointer;
    font-size: 14px; color: #888; font-weight: 500;
    border-bottom: 2px solid transparent;
  }
  .tab-bar button.active {
    color: #1a73e8; border-bottom-color: #1a73e8; font-weight: 600;
  }
  .search-row { display: flex; gap: 8px; margin-bottom: 12px; }
  .search-row input { flex: 1; margin-bottom: 0; }
  .search-row button { width: auto; white-space: nowrap; }
  .mem-item { padding: 10px; border-bottom: 1px solid #f0f0f0; }
  .mem-score { font-size: 11px; color: #1a73e8; font-weight: 600; }
  .mem-content { font-size: 14px; margin-top: 4px; white-space: pre-wrap; word-break: break-word; }
  .error { color: #c5221f; font-size: 13px; margin-top: 8px; }
  .empty { color: #888; font-size: 14px; text-align: center; padding: 24px 0; }
  .loading { color: #888; text-align: center; padding: 24px 0; }
  .token-display {
    background: #f5f5f5; padding: 8px; border-radius: 6px;
    font-family: monospace; font-size: 12px; word-break: break-all;
  }
  .saved-token { font-size: 13px; color: #137333; margin-top: 4px; }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function() {
  const LABELS = ${labelsJson};
  const $ = (sel) => document.querySelector(sel);
  const TOKEN_KEY = 'arena_remote_token';
  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  let view = token ? 'list' : 'auth';
  let conversations = [];
  let currentConv = null;
  let memResults = [];
  let tab = 'conversations';
  let error = '';
  let loading = false;

  async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) {
      // F2-Task3: structured failure shape from /remote/memory/search
      // is { ok: false, code, message }. Surface the code so the user
      // can distinguish "service down" from "bad input" instead of a
      // generic 500 message.
      if (data && data.ok === false) {
        const codeText = data.code ? '[' + data.code + '] ' : '';
        throw new Error(codeText + (data.message || data.error || 'Request failed'));
      }
      throw new Error(data && data.error ? data.error : 'Request failed');
    }
    return data;
  }

  // F2-Task6: lightweight runtime shape guards. Server is trusted but
  // contract drift between releases would otherwise turn into a silent
  // empty list — throw with the offending field name so the user (or
  // logs) sees the mismatch.
  function expectArray(value, name) {
    if (!Array.isArray(value)) {
      throw new Error('Server response: "' + name + '" is not an array');
    }
    return value;
  }
  function expectObject(value, name) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Server response: "' + name + '" is not an object');
    }
    return value;
  }
  function expectString(value, name) {
    if (typeof value !== 'string') {
      throw new Error('Server response: "' + name + '" is not a string');
    }
    return value;
  }
  function expectNumber(value, name) {
    if (typeof value !== 'number' || !isFinite(value)) {
      throw new Error('Server response: "' + name + '" is not a finite number');
    }
    return value;
  }
  function validateConversation(c, prefix) {
    expectObject(c, prefix);
    expectString(c.id, prefix + '.id');
    expectString(c.mode, prefix + '.mode');
    if (c.title !== null && c.title !== undefined && typeof c.title !== 'string') {
      throw new Error('Server response: "' + prefix + '.title" must be string or null');
    }
    return c;
  }
  function validateMessage(m, prefix) {
    expectObject(m, prefix);
    expectString(m.id, prefix + '.id');
    expectString(m.content, prefix + '.content');
    expectString(m.role, prefix + '.role');
    return m;
  }
  function validateMemHit(r, prefix) {
    expectObject(r, prefix);
    expectString(r.id, prefix + '.id');
    expectString(r.content, prefix + '.content');
    expectNumber(r.score, prefix + '.score');
    return r;
  }

  function render() {
    const app = $('#app');
    if (view === 'auth') {
      app.innerHTML = \`
        <div class="header"><h1>\${esc(LABELS.brandName)}</h1></div>
        <div class="container">
          <div class="card">
            <p style="margin-bottom:12px;font-size:14px;color:#555">
              \${token ? esc(LABELS.tokenSavedHint) : esc(LABELS.tokenPrompt)}
            </p>
            <input id="token-input" type="password" placeholder="\${esc(LABELS.tokenPlaceholder)}"
              value="\${esc(token)}">
            <button class="btn" id="connect-btn">\${esc(LABELS.connectButton)}</button>
            \${error ? '<p class="error">' + esc(error) + '</p>' : ''}
          </div>
        </div>\`;
      $('#connect-btn').onclick = doConnect;
      $('#token-input').onkeydown = (e) => { if (e.key === 'Enter') doConnect(); };
      return;
    }

    let content = '';
    if (view === 'list') {
      let tabContent = '';
      if (tab === 'conversations') {
        if (loading) {
          tabContent = '<div class="loading">' + esc(LABELS.loading) + '</div>';
        } else if (conversations.length === 0) {
          tabContent = '<div class="empty">' + esc(LABELS.emptyConversations) + '</div>';
        } else {
          tabContent = conversations.map((c, i) => \`
            <div class="conv-item" data-idx="\${i}">
              <div class="conv-title">\${esc(c.title || LABELS.untitledConversation)}</div>
              <div class="conv-mode">\${esc(c.mode)}</div>
            </div>\`).join('');
        }
        content = '<div class="card">' + tabContent + '</div>';
      } else {
        content = \`
          <div class="card">
            <div class="search-row">
              <input id="mem-query" placeholder="\${esc(LABELS.memQueryPlaceholder)}">
              <button class="btn btn-sm" id="mem-search-btn">\${esc(LABELS.searchButton)}</button>
            </div>
            \${loading ? '<div class="loading">' + esc(LABELS.searching) + '</div>' :
              memResults.length === 0 ? '<div class="empty">' + esc(LABELS.emptyResults) + '</div>' :
              memResults.map(r => \`
                <div class="mem-item">
                  <div class="mem-score">\${esc(LABELS.relevanceLabel)} \${(r.score * 100).toFixed(0)}%</div>
                  <div class="mem-content">\${esc(r.content)}</div>
                </div>\`).join('')}
          </div>\`;
      }

      app.innerHTML = \`
        <div class="header">
          <h1>\${esc(LABELS.brandName)}</h1>
          <button id="logout-btn">\${esc(LABELS.logoutButton)}</button>
        </div>
        <div class="container">
          <div class="tab-bar">
            <button class="\${tab === 'conversations' ? 'active' : ''}" data-tab="conversations">\${esc(LABELS.tabConversations)}</button>
            <button class="\${tab === 'memory' ? 'active' : ''}" data-tab="memory">\${esc(LABELS.tabMemory)}</button>
          </div>
          \${content}
        </div>\`;

      $('#logout-btn').onclick = doLogout;
      document.querySelectorAll('.tab-bar button').forEach(b => {
        b.onclick = () => { tab = b.dataset.tab; render(); if (tab === 'conversations') loadConversations(); };
      });
      document.querySelectorAll('.conv-item').forEach(el => {
        el.onclick = () => openConversation(conversations[parseInt(el.dataset.idx)]);
      });
      if (tab === 'memory') {
        const searchBtn = $('#mem-search-btn');
        const queryInput = $('#mem-query');
        if (searchBtn) searchBtn.onclick = () => doMemSearch(queryInput.value);
        if (queryInput) queryInput.onkeydown = (e) => { if (e.key === 'Enter') doMemSearch(queryInput.value); };
      }
    }

    if (view === 'detail' && currentConv) {
      const msgs = (currentConv.messages || []).map((m, i) => validateMessage(m, 'messages[' + i + ']')).map(m => \`
        <div class="msg msg-\${m.role === 'user' ? 'user' : 'assistant'}">
          <div class="msg-role">\${esc(m.participantId || m.role)}</div>
          <div class="msg-content">\${esc(m.content)}</div>
        </div>\`).join('');

      app.innerHTML = \`
        <div class="header">
          <h1>\${esc(currentConv.title || LABELS.untitledConversation)}</h1>
        </div>
        <div class="container">
          <button class="back-btn" id="back-btn">\${esc(LABELS.backToList)}</button>
          \${loading ? '<div class="loading">' + esc(LABELS.loading) + '</div>' :
            currentConv.messages?.length === 0 ? '<div class="empty">' + esc(LABELS.emptyMessages) + '</div>' : msgs}
        </div>\`;
      $('#back-btn').onclick = () => { view = 'list'; currentConv = null; render(); };
    }
  }

  async function doConnect() {
    const input = $('#token-input');
    if (input) token = input.value.trim();
    if (!token) { error = LABELS.tokenRequired; render(); return; }
    error = '';
    try {
      await api('GET', '/remote/conversations');
      sessionStorage.setItem(TOKEN_KEY, token);
      view = 'list';
      render();
      loadConversations();
    } catch (e) {
      error = LABELS.authFailedPrefix + e.message;
      render();
    }
  }

  async function loadConversations() {
    loading = true; render();
    try {
      const data = await api('GET', '/remote/conversations');
      const list = expectArray(data.conversations, 'conversations');
      conversations = list.map((c, i) => validateConversation(c, 'conversations[' + i + ']'));
    } catch (e) {
      error = e.message;
    }
    loading = false; render();
  }

  async function openConversation(conv) {
    view = 'detail'; currentConv = { ...conv, messages: [] }; loading = true; render();
    try {
      const data = await api('POST', '/remote/conversation', { conversationId: conv.id });
      validateConversation(data, 'conversation');
      const messages = expectArray(data.messages, 'conversation.messages');
      messages.forEach((m, i) => validateMessage(m, 'messages[' + i + ']'));
      currentConv = data;
    } catch (e) {
      error = e.message;
    }
    loading = false; render();
  }

  async function doMemSearch(query) {
    if (!query || !query.trim()) return;
    loading = true; memResults = []; render();
    try {
      const data = await api('POST', '/remote/memory/search', { query: query.trim(), limit: 20 });
      const results = expectArray(data.results, 'results');
      memResults = results.map((r, i) => validateMemHit(r, 'results[' + i + ']'));
    } catch (e) {
      error = e.message;
    }
    loading = false; render();
  }

  function doLogout() {
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    view = 'auth'; error = ''; conversations = []; currentConv = null; memResults = [];
    render();
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // Init
  if (token) { view = 'list'; render(); loadConversations(); }
  else { render(); }
})();
</script>
</body>
</html>`;
}

// Test-only export: exposes the dictionary for parity assertions without
// re-implementing them in test code.
export const __REMOTE_WEB_CLIENT_DICTIONARIES_FOR_TESTS = {
  ko: KO,
  en: EN,
} as const;
