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
 */

export function getRemoteWebClientHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>AI Chat Arena — Remote</title>
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
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function render() {
    const app = $('#app');
    if (view === 'auth') {
      app.innerHTML = \`
        <div class="header"><h1>AI Chat Arena</h1></div>
        <div class="container">
          <div class="card">
            <p style="margin-bottom:12px;font-size:14px;color:#555">
              \${token ? '저장된 토큰이 있습니다. 다시 입력하거나 연결하세요.' : '접속 토큰을 입력하세요.'}
            </p>
            <input id="token-input" type="password" placeholder="토큰 입력..."
              value="\${esc(token)}">
            <button class="btn" id="connect-btn">연결</button>
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
          tabContent = '<div class="loading">불러오는 중...</div>';
        } else if (conversations.length === 0) {
          tabContent = '<div class="empty">대화가 없습니다.</div>';
        } else {
          tabContent = conversations.map((c, i) => \`
            <div class="conv-item" data-idx="\${i}">
              <div class="conv-title">\${esc(c.title || '(제목 없음)')}</div>
              <div class="conv-mode">\${esc(c.mode)}</div>
            </div>\`).join('');
        }
        content = '<div class="card">' + tabContent + '</div>';
      } else {
        content = \`
          <div class="card">
            <div class="search-row">
              <input id="mem-query" placeholder="검색어 입력...">
              <button class="btn btn-sm" id="mem-search-btn">검색</button>
            </div>
            \${loading ? '<div class="loading">검색 중...</div>' :
              memResults.length === 0 ? '<div class="empty">검색 결과가 없습니다.</div>' :
              memResults.map(r => \`
                <div class="mem-item">
                  <div class="mem-score">관련도: \${(r.score * 100).toFixed(0)}%</div>
                  <div class="mem-content">\${esc(r.content)}</div>
                </div>\`).join('')}
          </div>\`;
      }

      app.innerHTML = \`
        <div class="header">
          <h1>AI Chat Arena</h1>
          <button id="logout-btn">로그아웃</button>
        </div>
        <div class="container">
          <div class="tab-bar">
            <button class="\${tab === 'conversations' ? 'active' : ''}" data-tab="conversations">대화</button>
            <button class="\${tab === 'memory' ? 'active' : ''}" data-tab="memory">메모리</button>
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
      const msgs = (currentConv.messages || []).map(m => \`
        <div class="msg msg-\${m.role === 'user' ? 'user' : 'assistant'}">
          <div class="msg-role">\${esc(m.participantId || m.role)}</div>
          <div class="msg-content">\${esc(m.content)}</div>
        </div>\`).join('');

      app.innerHTML = \`
        <div class="header">
          <h1>\${esc(currentConv.title || '(제목 없음)')}</h1>
        </div>
        <div class="container">
          <button class="back-btn" id="back-btn">&larr; 목록으로</button>
          \${loading ? '<div class="loading">불러오는 중...</div>' :
            currentConv.messages?.length === 0 ? '<div class="empty">메시지가 없습니다.</div>' : msgs}
        </div>\`;
      $('#back-btn').onclick = () => { view = 'list'; currentConv = null; render(); };
    }
  }

  async function doConnect() {
    const input = $('#token-input');
    if (input) token = input.value.trim();
    if (!token) { error = '토큰을 입력하세요.'; render(); return; }
    error = '';
    try {
      await api('GET', '/remote/conversations');
      sessionStorage.setItem(TOKEN_KEY, token);
      view = 'list';
      render();
      loadConversations();
    } catch (e) {
      error = '인증 실패: ' + e.message;
      render();
    }
  }

  async function loadConversations() {
    loading = true; render();
    try {
      const data = await api('GET', '/remote/conversations');
      conversations = data.conversations || [];
    } catch (e) {
      error = e.message;
    }
    loading = false; render();
  }

  async function openConversation(conv) {
    view = 'detail'; currentConv = { ...conv, messages: [] }; loading = true; render();
    try {
      const data = await api('POST', '/remote/conversation', { conversationId: conv.id });
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
      memResults = data.results || [];
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
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // Init
  if (token) { view = 'list'; render(); loadConversations(); }
  else { render(); }
})();
</script>
</body>
</html>`;
}
