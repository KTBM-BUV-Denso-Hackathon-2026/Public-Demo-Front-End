/**
 * Trang hỏi đáp (index.html).
 *
 * Trách nhiệm:
 *   - Tải/nạp lại danh sách hội thoại, render sidebar theo nhóm ngày.
 *   - Gửi câu hỏi (streaming SSE hoặc JSON) và render trả lời.
 *   - Hiển thị "Nguồn tham khảo" (RAG contexts) dạng thu gọn.
 *   - Đổi tên / xoá hội thoại.
 *
 * Mọi nội dung từ server đều được render bằng textContent (xem ui.js) —
 * không dùng innerHTML ở bất kỳ đâu trong file này.
 */
(function () {
  'use strict';

  const el = window.ui.el;
  const clear = window.ui.clear;
  const CFG = window.DENSO_CONFIG;
  const LS_PARAMS = 'denso.ask.params';

  // ------------------------------------------------------------------- state
  const state = {
    chats: [],
    activeId: null,
    messages: [],
    contexts: [],
    streaming: false,
    abortController: null,
    user: null,
    params: { top_k: CFG.DEFAULT_TOP_K, temperature: 0.7, max_new_tokens: 512, stream: true },
  };

  // ------------------------------------------------------------------- DOM
  const dom = {
    sidebar: document.getElementById('sidebar'),
    chatList: document.getElementById('chat-list'),
    thread: document.getElementById('thread'),
    threadScroll: document.getElementById('thread-scroll'),
    emptyState: document.getElementById('empty-state'),
    suggestionGrid: document.getElementById('suggestion-grid'),
    form: document.getElementById('composer'),
    input: document.getElementById('input-question'),
    sendBtn: document.getElementById('btn-send'),
    stopBtn: document.getElementById('btn-stop'),
    newChat: document.getElementById('btn-new-chat'),
    topbarTitle: document.getElementById('topbar-title'),
    renameBtn: document.getElementById('btn-rename'),
    deleteBtn: document.getElementById('btn-delete-chat'),
    openSidebar: document.getElementById('btn-open-sidebar'),
    closeSidebar: document.getElementById('btn-close-sidebar'),
    logout: document.getElementById('btn-logout'),
    userLabel: document.getElementById('user-label'),
    menuEmail: document.getElementById('menu-email'),
    menuLevel: document.getElementById('menu-level'),
    linkKnowledge: document.getElementById('link-knowledge'),
    modalRename: document.getElementById('modal-rename'),
    formRename: document.getElementById('form-rename'),
    inputRename: document.getElementById('input-rename'),
  };

  // ------------------------------------------------------- gợi ý câu hỏi
  const SUGGESTIONS = [
    { icon: 'wrench-adjustable-circle', text: 'Quy trình bảo trì định kỳ gồm những bước nào?' },
    { icon: 'exclamation-triangle', text: 'Các dấu hiệu cho thấy cầu chì bị cháy?' },
    { icon: 'thermometer-half', text: 'Khi nào cần kiểm tra tủ điện điều khiển?' },
    { icon: 'search', text: 'Tóm tắt tài liệu về an toàn trước khi sửa chữa.' },
  ];

  // ------------------------------------------------------ lưu tuỳ chọn RAG
  function loadParams() {
    try {
      const raw = window.localStorage.getItem(LS_PARAMS);
      if (!raw) return;
      const saved = JSON.parse(raw);
      Object.keys(state.params).forEach((key) => {
        if (typeof saved[key] === typeof state.params[key]) state.params[key] = saved[key];
      });
    } catch (_) {
      /* localStorage bị chặn -> dùng mặc định */
    }
  }

  function saveParams() {
    try {
      // Chỉ lưu tuỳ chọn không nhạy cảm (không có token/secret nào ở đây).
      window.localStorage.setItem(LS_PARAMS, JSON.stringify(state.params));
    } catch (_) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ helpers
  function isNearBottom() {
    const el2 = dom.threadScroll;
    return el2.scrollHeight - el2.scrollTop - el2.clientHeight < 160;
  }

  function scrollToBottom(force) {
    requestAnimationFrame(() => {
      if (force || isNearBottom()) {
        dom.threadScroll.scrollTop = dom.threadScroll.scrollHeight;
      }
    });
  }

  function chatTitle() {
    if (state.activeId === null) return 'Hội thoại mới';
    const chat = state.chats.find((c) => c.id === state.activeId);
    return (chat && chat.title) || 'Hội thoại ' + state.activeId;
  }

  function setTopbarTitle() {
    dom.topbarTitle.textContent = chatTitle();
  }

  // ------------------------------------------------------------------ render
  function renderSidebar() {
    clear(dom.chatList);
    const groups = window.ui.groupChatsByDate(state.chats);
    if (!groups.length) {
      dom.chatList.appendChild(
        el('p', { className: 'text-muted-2 small px-2 pt-3 mb-0', text: 'Chưa có hội thoại nào.' })
      );
      return;
    }

    groups.forEach((group) => {
      dom.chatList.appendChild(
        el('div', { className: 'chat-group-label', text: group.label })
      );
      group.items.forEach((chat) => {
        const isActive = chat.id === state.activeId;

        const title = el('span', {
          className: 'chat-item-title',
          text: chat.title || 'Hội thoại ' + chat.id,
          title: chat.title || '',
        });

        const delBtn = el('button', {
          className: 'icon-btn chat-item-actions',
          attrs: { type: 'button', 'aria-label': 'Xoá hội thoại' },
          title: 'Xoá',
        }, [window.ui.icon('trash3')]);
        delBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          confirmDelete(chat);
        });

        const item = el(
          'div',
          {
            className: 'chat-item' + (isActive ? ' is-active' : ''),
            attrs: { role: 'button', tabindex: '0', 'aria-current': isActive ? 'page' : 'false' },
          },
          [window.ui.icon('chat-left-text', 'flex-shrink-0'), title, delBtn]
        );

        item.addEventListener('click', () => openChat(chat.id));
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openChat(chat.id);
          }
        });

        dom.chatList.appendChild(item);
      });
    });
  }

  function renderSuggestions() {
    clear(dom.suggestionGrid);
    SUGGESTIONS.forEach((item) => {
      const card = el('button', {
        className: 'suggestion-card',
        attrs: { type: 'button' },
      }, [
        window.ui.icon(item.icon),
        el('span', { text: item.text }),
      ]);
      card.addEventListener('click', () => {
        dom.input.value = item.text;
        ui_autoGrow(dom.input);
        updateSendState();
        dom.input.focus();
      });
      dom.suggestionGrid.appendChild(card);
    });
  }

  function ui_autoGrow(node) {
    window.ui.autoGrow(node);
  }

  /** Một tin nhắn trong luồng. */
  function buildMessage(role, text, options) {
    const opts = options || {};
    const isUser = role === 'user';

    const textNode = el('div', { className: 'msg-text' });
    window.ui.renderText(textNode, text || '');

    const roleLine = el('div', { className: 'msg-role' }, [
      el('span', { text: isUser ? 'Bạn' : 'Trợ lý DENSO' }),
    ]);
    if (opts.pending) {
      roleLine.appendChild(
        el('span', { className: 'badge text-bg-light border fw-normal', text: 'đang tìm tài liệu…' })
      );
    }

    const body = el('div', { className: 'msg-body' }, [roleLine, textNode]);

    // Nguồn tham khảo (chỉ của câu trả lời AI).
    if (!isUser && opts.contexts && opts.contexts.length) {
      const list = el('div', {});
      opts.contexts.forEach((ctx) => {
        const text2 = typeof ctx === 'string' ? ctx : JSON.stringify(ctx);
        list.appendChild(el('div', { className: 'source-item', text: window.ui.truncate(text2, 2000) }));
      });
      const details = el('details', { className: 'sources' }, [
        el('summary', {}, [
          window.ui.icon('journals'),
          el('span', { text: 'Nguồn tham khảo (' + opts.contexts.length + ')' }),
        ]),
        el('div', { className: 'sources-body' }, [list]),
      ]);
      body.appendChild(details);
    }

    if (!isUser && !opts.contexts && opts.showNoContext) {
      body.appendChild(
        el('p', {
          className: 'no-context-note',
          text: 'Không tìm thấy đoạn tài liệu nào phù hợp — câu trả lời dưới đây không dựa trên tài liệu đã nạp.',
        })
      );
    }

    const wrap = el('div', { className: 'msg' + (isUser ? ' is-user' : '') }, [
      el('span', {
        className: 'msg-avatar' + (isUser ? ' is-user' : ''),
        attrs: { 'aria-hidden': 'true' },
      }, [window.ui.icon(isUser ? 'person-fill' : 'cpu')]),
      body,
    ]);

    wrap.__textNode = textNode;
    return wrap;
  }

  function renderThread() {
    clear(dom.thread);
    const visible = state.messages.slice(-CFG.MAX_RENDERED_MESSAGES);
    visible.forEach((msg) => {
      const isLast = msg === visible[visible.length - 1];
      dom.thread.appendChild(
        buildMessage(msg.role, msg.content, {
          contexts: msg.role === 'assistant' ? msg.contexts : null,
          showNoContext: msg.role === 'assistant' && isLast && !msg.contexts,
        })
      );
    });

    const hasMessages = visible.length > 0;
    dom.emptyState.classList.toggle('d-none', hasMessages);
    dom.thread.classList.toggle('d-none', !hasMessages);
  }

  /**
   * Gắn nguồn RAG vào câu trả lời AI gần nhất trong `state.messages`.
   *
   * Phải lưu vào STATE chứ không gắn trực tiếp vào DOM: `renderThread()` dựng
   * lại toàn bộ danh sách từ state, nên mọi thứ gắn tay vào node sẽ bị xoá mất.
   */
  function setLastAssistantContexts(contexts) {
    state.contexts = Array.isArray(contexts) ? contexts : [];
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      if (state.messages[i].role === 'assistant') {
        state.messages[i].contexts = state.contexts;
        return;
      }
    }
  }

  function updateSendState() {
    const ready = dom.input.value.trim().length > 0 && !state.streaming;
    dom.sendBtn.disabled = !ready;
    dom.sendBtn.classList.toggle('is-ready', ready);
    dom.stopBtn.classList.toggle('d-none', !state.streaming);
    dom.sendBtn.classList.toggle('d-none', state.streaming);
  }

  // -------------------------------------------------------------- data (API)
  async function loadChats() {
    const data = await window.api.request('/chat/chats/', { query: { page_size: 100 } });
    state.chats = (data && data.results) || [];
    renderSidebar();
    setTopbarTitle();
  }

  async function openChat(id) {
    if (state.streaming) {
      window.ui.toast('Hãy dừng câu trả lời đang chạy trước khi đổi hội thoại.', 'warning');
      return;
    }
    try {
      const chat = await window.api.request('/chat/chats/' + encodeURIComponent(id) + '/');
      state.activeId = id;
      state.messages = Array.isArray(chat.message) ? chat.message : [];
      state.contexts = [];
      renderSidebar();
      setTopbarTitle();
      renderThread();
      dom.threadScroll.scrollTop = dom.threadScroll.scrollHeight;
      closeSidebarOnMobile();
    } catch (err) {
      window.ui.toast(err.message, 'danger');
    }
  }

  function startNewChat() {
    if (state.streaming) {
      window.ui.toast('Hãy dừng câu trả lời đang chạy trước.', 'warning');
      return;
    }
    state.activeId = null;
    state.messages = [];
    state.contexts = [];
    renderSidebar();
    setTopbarTitle();
    renderThread();
    dom.input.value = '';
    ui_autoGrow(dom.input);
    updateSendState();
    closeSidebarOnMobile();
    dom.input.focus();
  }

  /**
   * Bảo đảm có một chat trên server trước khi hỏi.
   * (Lưu ý: backend tự đặt tiêu đề = câu hỏi đầu tiên, nên để title rỗng.)
   */
  async function ensureChat() {
    if (state.activeId !== null) return state.activeId;
    const chat = await window.api.request('/chat/chats/', { method: 'POST', body: { title: '' } });
    state.activeId = chat.id;
    await loadChats();
    return state.activeId;
  }

  // --------------------------------------------------------------- gửi hỏi
  async function ask(question) {
    if (state.streaming) return;

    const trimmed = question.trim();
    if (!trimmed) return;
    if (trimmed.length > CFG.MAX_QUESTION_LENGTH) {
      window.ui.toast('Câu hỏi quá dài (tối đa ' + CFG.MAX_QUESTION_LENGTH + ' ký tự).', 'warning');
      return;
    }

    state.messages.push({ role: 'user', content: trimmed });
    dom.input.value = '';
    ui_autoGrow(dom.input);

    // Hiển thị ngay tin nhắn người dùng + ô trả lời đang chờ.
    const userMsg = buildMessage('user', trimmed, {});
    const pendingMsg = buildMessage('assistant', '', { pending: true });
    dom.thread.appendChild(userMsg);
    dom.thread.appendChild(pendingMsg);
    dom.emptyState.classList.add('d-none');
    dom.thread.classList.remove('d-none');
    scrollToBottom(true);

    state.streaming = true;
    state.abortController = new AbortController();
    updateSendState();

    let chatId = null;
    try {
      chatId = await ensureChat();

      if (state.params.stream) {
        await askStreaming(chatId, trimmed, pendingMsg);
      } else {
        await askBlocking(chatId, trimmed, pendingMsg);
      }
    } catch (err) {
      const cancelled = err && err.wasCancelled;
      clearPendingBadge(pendingMsg);
      if (pendingMsg.__textNode) pendingMsg.__textNode.classList.remove('caret');
      const text = cancelled
        ? '(đã dừng — câu trả lời này KHÔNG được lưu vào lịch sử)'
        : '⚠️ ' + (err.message || 'Không thể hỏi đáp.');
      window.ui.renderText(pendingMsg.__textNode, text);
      if (!cancelled) {
        window.ui.toast(err.message || 'Không thể hỏi đáp.', 'danger');
        if (err.status === 401) window.authGuard.goLogin();
      }
    } finally {
      state.streaming = false;
      state.abortController = null;
      updateSendState();
      await loadChats().catch(() => null);
      setTopbarTitle();
      scrollToBottom();
    }
  }

  function buildAskPayload(chatId, question, stream) {
    const payload = { question: question, stream: stream, top_k: state.params.top_k };
    // Chỉ gửi khi khác mặc định để request gọn.
    if (state.params.temperature !== 0.7) payload.temperature = state.params.temperature;
    if (state.params.max_new_tokens !== 512) payload.max_new_tokens = state.params.max_new_tokens;
    return payload;
  }

  /** Bỏ badge "đang tìm tài liệu…" và thay bằng spinner (khi bắt đầu stream). */
  function markStreamingStarted(msgNode) {
    const badge = msgNode.querySelector('.msg-role .badge');
    if (badge) badge.remove();
    const roleLine = msgNode.querySelector('.msg-role');
    if (roleLine) {
      roleLine.appendChild(window.ui.icon('arrow-repeat', 'spinner-border spinner-border-sm text-muted-2'));
    }
    if (msgNode.__textNode) msgNode.__textNode.classList.add('caret');
    scrollToBottom();
  }

  /** Bỏ badge chờ (dùng cho chế độ không streaming). */
  function clearPendingBadge(msgNode) {
    const badge = msgNode.querySelector('.msg-role .badge');
    if (badge) badge.remove();
    const spinner = msgNode.querySelector('.msg-role .spinner-border');
    if (spinner) spinner.remove();
  }

  async function askStreaming(chatId, question, pendingMsg) {
    const textNode = pendingMsg.__textNode;
    let buffer = '';

    await window.api.streamChat(
      chatId,
      buildAskPayload(chatId, question, true),
      {
        onStart: () => {
          // KHÔNG clear() ở đây: clear() gỡ textNode khỏi DOM nên mọi cập nhật
          // sau đó sẽ không hiển thị. Chỉ bỏ badge và bật con trỏ nhấp nháy.
          markStreamingStarted(pendingMsg);
        },
        onDelta: (delta) => {
          buffer += delta;
          window.ui.renderText(textNode, buffer);
          scrollToBottom();
        },
        onEnd: (event) => {
          textNode.classList.remove('caret');
          clearPendingBadge(pendingMsg);
          // Server trả về messages đầy đủ -> nguồn sự thật, tránh lệch hiển thị.
          if (Array.isArray(event.messages) && event.messages.length) {
            state.messages = event.messages.map((m) => ({ role: m.role, content: m.content }));
          } else {
            state.messages.push({ role: 'user', content: question });
            state.messages.push({ role: 'assistant', content: buffer });
          }
          // Nguồn RAG đi kèm event `end` (xem llm_api/schemas.py::StreamEvent).
          setLastAssistantContexts(event.contexts);
        },
        onError: (message) => {
          textNode.classList.remove('caret');
          throw new window.api.ApiError(0, message);
        },
      },
      state.abortController.signal
    );

    // `renderThread()` dựng lại danh sách từ state -> nguồn tham khảo hiện luôn.
    renderThread();
    scrollToBottom();
  }

  async function askBlocking(chatId, question, pendingMsg) {
    const data = await window.api.request(
      '/chat/chats/' + encodeURIComponent(chatId) + '/ask/',
      {
        method: 'POST',
        body: buildAskPayload(chatId, question, false),
        timeoutMs: 180000,
      }
    );
    // Giữ nguyên cấu trúc node, chỉ thay nội dung (clear() sẽ làm node mồ côi).
    clearPendingBadge(pendingMsg);
    window.ui.renderText(pendingMsg.__textNode, data.answer || '');

    if (Array.isArray(data.messages) && data.messages.length) {
      state.messages = data.messages.map((m) => ({ role: m.role, content: m.content }));
    } else {
      state.messages.push({ role: 'user', content: question });
      state.messages.push({ role: 'assistant', content: data.answer || '' });
    }

    setLastAssistantContexts(data.contexts);
    renderThread();
  }

  // ------------------------------------------------------------ xoá / đổi tên
  async function confirmDelete(chat) {
    const title = window.ui.truncate(chat.title || 'Hội thoại ' + chat.id, 60);
    if (!window.confirm('Xoá vĩnh viễn hội thoại "' + title + '"?\nToàn bộ lịch sử trong hội thoại sẽ mất.')) {
      return;
    }
    try {
      await window.api.request('/chat/chats/' + encodeURIComponent(chat.id) + '/', {
        method: 'DELETE',
      });
      window.ui.toast('Đã xoá hội thoại.', 'success');
      if (state.activeId === chat.id) startNewChat();
      await loadChats();
    } catch (err) {
      window.ui.toast(err.message, 'danger');
    }
  }

  function openRenameModal() {
    if (state.activeId === null) {
      window.ui.toast('Hãy mở một hội thoại trước khi đổi tên.', 'warning');
      return;
    }
    dom.inputRename.value = chatTitle();
    const modal = window.bootstrap.Modal.getOrCreateInstance(dom.modalRename);
    modal.show();
  }

  async function submitRename(event) {
    event.preventDefault();
    if (state.activeId === null) return;
    const title = dom.inputRename.value.trim();
    if (!title) {
      window.ui.toast('Tiêu đề không được để trống.', 'warning');
      return;
    }
    try {
      await window.api.request('/chat/chats/' + encodeURIComponent(state.activeId) + '/', {
        method: 'PATCH',
        body: { title: title },
      });
      window.bootstrap.Modal.getInstance(dom.modalRename).hide();
      await loadChats();
      window.ui.toast('Đã đổi tên.', 'success');
    } catch (err) {
      window.ui.toast(err.message, 'danger');
    }
  }

  // ---------------------------------------------------------------- sidebar
  function openSidebarOnMobile() {
    dom.sidebar.classList.add('is-open');
    if (!document.querySelector('.sidebar-backdrop')) {
      const back = el('div', { className: 'sidebar-backdrop d-lg-none' });
      back.addEventListener('click', closeSidebarOnMobile);
      document.body.appendChild(back);
    }
  }

  function closeSidebarOnMobile() {
    dom.sidebar.classList.remove('is-open');
    const back = document.querySelector('.sidebar-backdrop');
    if (back) back.remove();
  }

  // ------------------------------------------------------------------- init
  function bindEvents() {
    dom.form.addEventListener('submit', (event) => {
      event.preventDefault();
      ask(dom.input.value);
    });

    dom.input.addEventListener('input', () => {
      ui_autoGrow(dom.input);
      updateSendState();
    });

    dom.input.addEventListener('keydown', (event) => {
      // Enter gửi, Shift+Enter xuống dòng (bỏ qua khi đang bật IME tiếng Việt).
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!dom.sendBtn.disabled) dom.form.requestSubmit();
      }
    });

    dom.stopBtn.addEventListener('click', () => {
      if (state.abortController) state.abortController.abort('cancelled');
    });

    dom.newChat.addEventListener('click', startNewChat);
    dom.renameBtn.addEventListener('click', openRenameModal);
    dom.deleteBtn.addEventListener('click', () => {
      const chat = state.chats.find((c) => c.id === state.activeId);
      if (chat) confirmDelete(chat);
    });
    dom.logout.addEventListener('click', () => window.authGuard.logout());
    dom.openSidebar.addEventListener('click', openSidebarOnMobile);
    dom.closeSidebar.addEventListener('click', closeSidebarOnMobile);
    dom.formRename.addEventListener('submit', submitRename);

    // Tuỳ chọn RAG
    const bindRange = (id, key, format, max) => {
      const input = document.getElementById(id);
      const out = document.getElementById(id + '-val');
      input.value = state.params[key];
      out.textContent = format(state.params[key]);
      input.addEventListener('input', () => {
        let value = parseFloat(input.value);
        if (key === 'top_k') value = Math.round(value);
        state.params[key] = value;
        out.textContent = format(value);
        saveParams();
      });
      if (max) input.max = max;
    };
    bindRange('param-topk', 'top_k', (v) => String(v), 20);
    bindRange('param-temp', 'temperature', (v) => v.toFixed(1), 2);
    bindRange('param-max', 'max_new_tokens', (v) => String(v), 2048);

    const streamToggle = document.getElementById('param-stream');
    streamToggle.checked = state.params.stream;
    streamToggle.addEventListener('change', () => {
      state.params.stream = streamToggle.checked;
      saveParams();
    });
  }

  async function init() {
    loadParams();
    renderSuggestions();
    bindEvents();
    renderThread();
    updateSendState();
    setTopbarTitle();

    try {
      const user = await window.authGuard.ensureSession();
      if (!user) return;
      state.user = user;

      const email = user.email || '';
      const name = ((user.first_name || '') + ' ' + (user.last_name || '')).trim();
      dom.userLabel.textContent = name || email;
      dom.menuEmail.textContent = email;

      // Đọc claim `role` trong JWT để hiển thị (server vẫn là nơi phân quyền).
      const role = window.store.getRole();
      dom.menuLevel.textContent =
        { 0: 'Worker', 500: 'Senior Engineer', 900: 'Admin', 1000: 'Staff' }[role] || '—';

      // Worker không được nạp tài liệu -> ẩn mục quản lý tài liệu.
      if (!window.store.isRagManager()) {
        dom.linkKnowledge.classList.add('d-none');
        dom.linkKnowledge.setAttribute('aria-hidden', 'true');
        dom.linkKnowledge.removeAttribute('href');
      }

      await loadChats();
      dom.input.focus();
    } catch (err) {
      window.ui.toast(
        err.isNetwork
          ? 'Không kết nối được máy chủ API. Kiểm tra backend đã chạy chưa?'
          : err.message || 'Không tải được dữ liệu.',
        'danger'
      );
    }
  }

  init();
})();
