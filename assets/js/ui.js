/**
 * Tiện ích DOM — mọi hàm ở đây đều AN TOÀN VỚI XSS.
 *
 * ⚠️ NGUYÊN TẮC BẤT BIẾN CỦA TOÀN BỘ FRONTEND:
 *    KHÔNG BAO GIỜ gán dữ liệu từ server (câu trả lời AI, tiêu đề tài liệu,
 *    nội dung chunk, thông báo lỗi) vào `innerHTML` / `outerHTML` /
 *    `insertAdjacentHTML` / `document.write`.
 *    Mọi nội dung người dùng & server đều đi qua `textContent`.
 *    Đây là hàng rào quan trọng nhất chống XSS, vì dữ liệu RAG đến từ file
 *    do người dùng tải lên — hoàn toàn không đáng tin cậy.
 */
(function () {
  'use strict';

  /** Regex cho phép icon: chỉ chấp nhận tên class hợp lệ của Bootstrap Icons. */
  const ICON_NAME_RE = /^[a-z0-9-]+$/;

  /** Tạo phần tử DOM. `text` luôn được gán bằng textContent (an toàn). */
  function el(tag, options, children) {
    const node = document.createElement(tag);
    const opts = options || {};

    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);
    if (opts.title) node.title = opts.title;
    if (opts.type) node.setAttribute('type', opts.type);
    // ⚠️ Đọc giá trị từ `opts.attrs[name]`, KHÔNG phải `opts[name]`.
    // Gộp nhầm sẽ khiến mọi thuộc tính (id, role, aria-*, href, colspan...) bị bỏ qua.
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach((name) => {
        const value = opts.attrs[name];
        if (value !== undefined && value !== null) node.setAttribute(name, String(value));
      });
    }
    if (opts.on) {
      Object.keys(opts.on).forEach((evt) => node.addEventListener(evt, opts.on[evt]));
    }

    const list = Array.isArray(children) ? children : children ? [children] : [];
    list.forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  /** Icon Bootstrap Icons, có kiểm tra allowlist tên class. */
  function icon(name, extraClass) {
    const safe = String(name || '').replace(/^bi-/, '');
    if (!ICON_NAME_RE.test(safe)) {
      // Tên lạ -> dùng icon mặc định thay vì nội suy chuỗi tùy ý
      return el('i', { className: 'bi bi-question-circle' + (extraClass ? ' ' + extraClass : '') });
    }
    return el('i', { className: 'bi bi-' + safe + (extraClass ? ' ' + extraClass : ''), attrs: { 'aria-hidden': 'true' } });
  }

  /** Xoá toàn bộ con (không dùng innerHTML = ''). */
  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  /**
   * Render "văn bản có cấu trúc nhẹ" (chỉ xuống dòng + gạch đầu dòng).
   * CỐ Ý KHÔNG phân tích Markdown/HTML: chuyển mọi thứ thành text node.
   */
  function renderText(node, text) {
    clear(node);
    const raw = text === undefined || text === null ? '' : String(text);
    if (!raw) return;

    const lines = raw.split('\n');
    const frag = document.createDocumentFragment();

    lines.forEach((line, index) => {
      const isBullet = /^\s*[-*•]\s+/.test(line);
      const content = isBullet ? line.replace(/^\s*[-*•]\s+/, '') : line;

      if (isBullet) {
        frag.appendChild(
          el('div', { className: 'ui-bullet' }, [
            el('span', { className: 'ui-bullet-dot', attrs: { 'aria-hidden': 'true' } }),
            el('span', { className: 'ui-bullet-text', text: content }),
          ])
        );
      } else if (content.trim() !== '') {
        frag.appendChild(el('div', { className: 'ui-line', text: content }));
      } else {
        frag.appendChild(el('div', { className: 'ui-gap' }));
      }

      if (index < lines.length - 1) frag.appendChild(el('br'));
    });

    node.appendChild(frag);
  }

  /** Định dạng ngày kiểu Việt Nam. */
  function formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  }

  /** Khoảng thời gian tương đối cho sidebar. */
  function formatRelative(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return 'Vừa xong';
    if (diff < hour) return Math.floor(diff / minute) + ' phút trước';
    if (diff < day) return Math.floor(diff / hour) + ' giờ trước';
    if (diff < 7 * day) return Math.floor(diff / day) + ' ngày trước';
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }

  /** Nhóm hội thoại theo mốc thời gian (giống ChatGPT). */
  function groupChatsByDate(chats) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 24 * 60 * 60 * 1000;
    const groups = [
      { key: 'today', label: 'Hôm nay', items: [] },
      { key: 'yesterday', label: 'Hôm qua', items: [] },
      { key: 'week', label: '7 ngày trước', items: [] },
      { key: 'older', label: 'Cũ hơn', items: [] },
    ];
    chats.forEach((chat) => {
      const t = new Date(chat.updated_at || chat.created_at).getTime();
      if (!isFinite(t)) groups[3].items.push(chat);
      else if (t >= startOfToday) groups[0].items.push(chat);
      else if (t >= startOfToday - day) groups[1].items.push(chat);
      else if (t >= startOfToday - 7 * day) groups[2].items.push(chat);
      else groups[3].items.push(chat);
    });
    return groups.filter((g) => g.items.length > 0);
  }

  /** Lấy khởi tạo textContent an toàn. */
  function textOf(node) {
    return node && typeof node.textContent === 'string' ? node.textContent : '';
  }

  /** Rút gọn chuỗi. */
  function truncate(value, max) {
    const s = String(value === undefined || value === null ? '' : value);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  /**
   * Hiển thị thông báo nổi (toast) — nội dung luôn qua textContent.
   * @param {string} message
   * @param {'success'|'danger'|'warning'|'info'} variant
   */
  let toastHost = null;
  function toast(message, variant) {
    if (!toastHost) {
      toastHost = document.getElementById('ui-toast-host');
      if (!toastHost) {
        toastHost = el('div', {
          className: 'toast-container position-fixed bottom-0 end-0 p-3',
          attrs: { id: 'ui-toast-host', 'aria-live': 'polite', 'aria-atomic': 'true' },
        });
        document.body.appendChild(toastHost);
      }
    }

    const tone = variant || 'info';
    const iconName = {
      success: 'check-circle-fill',
      danger: 'exclamation-octagon-fill',
      warning: 'exclamation-triangle-fill',
      info: 'info-circle-fill',
    }[tone] || 'info-circle-fill';

    const node = el('div', {
      className: 'toast align-items-center border-0 text-bg-' + tone,
      attrs: { role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true' },
    });
    node.appendChild(el('div', { className: 'd-flex' }, [
      el('div', { className: 'toast-body d-flex align-items-start gap-2' }, [
        icon(iconName, 'flex-shrink-0 mt-1'),
        el('span', { text: message }),
      ]),
    ]));
    const closeBtn = el('button', {
      className: 'btn-close btn-close-white me-2 m-auto',
      attrs: { type: 'button', 'aria-label': 'Đóng' },
    });
    closeBtn.addEventListener('click', () => node.remove());
    node.appendChild(closeBtn);

    toastHost.appendChild(node);
    const inst = window.bootstrap.Toast.getOrCreateInstance(node, { delay: 5000 });
    inst.show();
    node.addEventListener('hidden.bs.toast', () => node.remove());
  }

  /** Debounce đơn giản. */
  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), wait || 250);
    };
  }

  /** Tự co giãn textarea theo nội dung (tối đa theo CSS max-height). */
  function autoGrow(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  /** Badge trạng thái nạp tài liệu. */
  function statusBadge(status, display) {
    const map = {
      done: { cls: 'success', icon: 'check-circle-fill' },
      pending: { cls: 'secondary', icon: 'clock' },
      processing: { cls: 'info', icon: 'arrow-repeat' },
      failed: { cls: 'danger', icon: 'exclamation-octagon-fill' },
    };
    const conf = map[status] || { cls: 'secondary', icon: 'question-circle' };
    return el('span', { className: 'badge text-bg-' + conf.cls + ' d-inline-flex align-items-center gap-1' }, [
      icon(conf.icon),
      el('span', { text: display || status || '—' }),
    ]);
  }

  window.ui = {
    el: el,
    icon: icon,
    clear: clear,
    renderText: renderText,
    formatDateTime: formatDateTime,
    formatRelative: formatRelative,
    groupChatsByDate: groupChatsByDate,
    textOf: textOf,
    truncate: truncate,
    toast: toast,
    debounce: debounce,
    autoGrow: autoGrow,
    statusBadge: statusBadge,
  };
})();
