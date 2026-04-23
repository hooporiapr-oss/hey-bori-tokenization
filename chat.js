// chat.js — Hey Bori chat frontend
// Persists conversation across visits via localStorage.

(function () {
  'use strict';

  const ENDPOINT = '/api/chat';
  const STORAGE_KEY = 'heyBoriConversation';

  const messagesEl = document.getElementById('messages');
  const inputEl    = document.getElementById('input');
  const sendBtn    = document.getElementById('send');
  const langEnBtn  = document.getElementById('lang-en');
  const langEsBtn  = document.getElementById('lang-es');
  const newChatBtn = document.getElementById('newChat');

  if (!messagesEl || !inputEl || !sendBtn) {
    console.warn('[Hey Bori] chat markup not found — aborting.');
    return;
  }

  // ── I18N ──────────────────────────────────────────────────────────────────
  const I18N = {
    en: {
      placeholder: 'Ask Bori anything about tokenization…',
      thinking: 'Thinking…',
      error: 'Something went wrong reaching Bori. Please try again in a moment.',
      networkError: "I couldn't reach Bori. Check your connection and try again.",
      clearConfirm: 'Start a new conversation? Your current chat will be cleared.',
      welcomeEyebrow: 'Educational · Independent · Neutral',
      welcomeTitle: 'Ask me anything about tokenization.',
      welcomeSub: "I explain concepts, mechanics, regulation, and risks across tokenized real estate, art, funds, securities, and real-world assets. I don't sell anything. I don't recommend deals. I teach so you can make informed decisions."
    },
    es: {
      placeholder: 'Pregúntale a Bori sobre tokenización…',
      thinking: 'Pensando…',
      error: 'Algo salió mal al conectar con Bori. Por favor intenta de nuevo en un momento.',
      networkError: 'No pude conectar con Bori. Revisa tu conexión y vuelve a intentarlo.',
      clearConfirm: '¿Comenzar una nueva conversación? Tu chat actual será borrado.',
      welcomeEyebrow: 'Educativo · Independiente · Neutral',
      welcomeTitle: 'Pregúntame lo que quieras sobre tokenización.',
      welcomeSub: 'Explico conceptos, mecánica, regulación y riesgos a través de bienes raíces tokenizados, arte, fondos, valores y activos del mundo real. No vendo nada. No recomiendo ofertas. Enseño para que puedas tomar decisiones informadas.'
    }
  };

  // ── LANGUAGE ──────────────────────────────────────────────────────────────
  function currentLang() {
    try {
      const stored = localStorage.getItem('heyBoriLang');
      return stored === 'es' ? 'es' : 'en';
    } catch {
      return 'en';
    }
  }

  function setLang(lang) {
    try { localStorage.setItem('heyBoriLang', lang); } catch {}

    document.querySelectorAll('[data-lang]').forEach(el => {
      el.classList.toggle('show', el.dataset.lang === lang);
    });

    if (langEnBtn) langEnBtn.classList.toggle('active', lang === 'en');
    if (langEsBtn) langEsBtn.classList.toggle('active', lang === 'es');

    document.documentElement.lang = lang === 'es' ? 'es' : 'en';
    inputEl.placeholder = I18N[lang].placeholder;

    // If welcome is currently showing, rebuild it in the new language
    if (!conversationStarted) renderWelcome();
  }

  if (langEnBtn) langEnBtn.addEventListener('click', () => setLang('en'));
  if (langEsBtn) langEsBtn.addEventListener('click', () => setLang('es'));

  // ── STATE ─────────────────────────────────────────────────────────────────
  let history = [];
  let conversationStarted = false;
  let isSending = false;

  // ── PERSISTENCE ───────────────────────────────────────────────────────────
  function saveConversation() {
    try {
      if (history.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      }
    } catch (err) {
      console.warn('[Hey Bori] Could not save conversation:', err);
    }
  }

  function loadConversation() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(m =>
        m && typeof m === 'object' &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.length > 0
      );
    } catch (err) {
      console.warn('[Hey Bori] Could not load conversation:', err);
      return [];
    }
  }

  // ── RENDERING ─────────────────────────────────────────────────────────────
  function renderWelcome() {
    messagesEl.innerHTML = '';
    const lang = currentLang();
    const t = I18N[lang];

    const wrap = document.createElement('div');
    wrap.className = 'welcome';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'welcome-eyebrow';
    eyebrow.textContent = t.welcomeEyebrow;

    const title = document.createElement('h1');
    title.className = 'welcome-title';
    title.textContent = t.welcomeTitle;

    const sub = document.createElement('p');
    sub.className = 'welcome-sub';
    sub.textContent = t.welcomeSub;

    wrap.appendChild(eyebrow);
    wrap.appendChild(title);
    wrap.appendChild(sub);
    messagesEl.appendChild(wrap);
  }

  function renderMessage(role, content, opts) {
    opts = opts || {};
    const isError = !!opts.isError;
    const el = document.createElement('div');
    el.className = 'msg ' + (isError ? 'error' : (role === 'user' ? 'user' : 'bori'));
    el.textContent = content;
    messagesEl.appendChild(el);
  }

  function startConversation() {
    if (conversationStarted) return;
    conversationStarted = true;
    messagesEl.innerHTML = ''; // wipe welcome
  }

  function addMessage(role, content, opts) {
    opts = opts || {};
    const store = opts.store !== false;
    const isError = !!opts.isError;

    renderMessage(role, content, { isError });
    scrollToBottom();

    if (store && (role === 'user' || role === 'assistant')) {
      history.push({ role, content });
      saveConversation();
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'typing';
    el.setAttribute('aria-label', I18N[currentLang()].thinking);
    el.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function setSending(state) {
    isSending = state;
    sendBtn.disabled = state;
    inputEl.disabled = state;
    if (newChatBtn) newChatBtn.disabled = state;
  }

  // ── RESTORE / RESET ───────────────────────────────────────────────────────
  function restoreConversation() {
    const saved = loadConversation();
    if (saved.length === 0) {
      renderWelcome();
      return;
    }

    history = saved;
    conversationStarted = true;
    messagesEl.innerHTML = '';
    history.forEach(m => renderMessage(m.role, m.content));
    scrollToBottom();
  }

  function clearConversation() {
    if (isSending) return;

    if (history.length > 0) {
      const ok = window.confirm(I18N[currentLang()].clearConfirm);
      if (!ok) return;
    }

    history = [];
    saveConversation();
    conversationStarted = false;
    renderWelcome();
    inputEl.focus();
  }

  if (newChatBtn) newChatBtn.addEventListener('click', clearConversation);

  // ── API CALL ──────────────────────────────────────────────────────────────
  async function fetchReply() {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, language: currentLang() })
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'Request failed (' + res.status + ')');
    }

    const data = await res.json();
    if (!data || typeof data.reply !== 'string') {
      throw new Error('Malformed response from server.');
    }
    return data.reply;
  }

  // ── SEND FLOW ─────────────────────────────────────────────────────────────
  async function handleSend() {
    if (isSending) return;
    const text = (inputEl.value || '').trim();
    if (!text) return;

    startConversation();
    addMessage('user', text);
    inputEl.value = '';
    autoResize();

    setSending(true);
    const typing = showTyping();

    try {
      const reply = await fetchReply();
      if (typing) typing.remove();
      addMessage('assistant', reply);
    } catch (err) {
      console.error('[Hey Bori] send failed:', err);
      if (typing) typing.remove();
      const msg =
        err && err.message && /fetch|network|failed to fetch/i.test(err.message)
          ? I18N[currentLang()].networkError
          : I18N[currentLang()].error;
      addMessage('assistant', msg, { store: false, isError: true });
    } finally {
      setSending(false);
      inputEl.focus();
    }
  }

  // ── INPUT ─────────────────────────────────────────────────────────────────
  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  }

  inputEl.addEventListener('input', autoResize);

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  // ── INIT ──────────────────────────────────────────────────────────────────
  function init() {
    setLang(currentLang());
    restoreConversation();
    autoResize();
    if (window.matchMedia('(min-width: 700px)').matches) inputEl.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
