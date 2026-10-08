/**
 * Lưu trữ token xác thực — thiết kế theo nguyên tắc "giảm tối đa rủi ro XSS".
 *
 * Chiến lược (theo thứ tự ưu tiên):
 *   1. Bộ nhớ (biến JS)            — an toàn nhất, mất khi reload/đóng tab.
 *   2. sessionStorage               — sống sót qua F5 trong cùng 1 tab.
 *
 * ⚠️ CỐ Ý KHÔNG dùng localStorage:
 *    localStorage bị đọc bởi MỌI script trên cùng origin và tồn tại vĩnh viễn
 *    (kể cả sau khi đóng tab) → nếu website bị XSS, token bị đánh cắp và dùng
 *    được mãi. sessionStorage hạn chế thiệt hại ở mức "1 tab + 1 phiên".
 *
 * ⚠️ GIỚI HẠN ĐÃ BIẾT (nói thẳng để không ai hiểu nhầm):
 *    Với kiến trúc token-trong-body, KHÔNG có cách nào an toàn tuyệt đối phía
 *    client: nếu kẻ tấn công chạy được JS trong tab của bạn thì chúng đọc được
 *    sessionStorage. Cách chống XSS thật sự là:
 *      - CSP nghiêm ngặt (đã đặt trong <meta http-equiv>) chặn JS lạ,
 *      - không bao giờ dùng innerHTML với dữ liệu từ server (xem `ui.js`),
 *      - và TỐT NHẤT: bật cookie httpOnly ở backend — xem README mục "Bảo mật".
 *
 *    Khi backend bật `JWT_ALLAUTH_REFRESH_TOKEN_AS_COOKIE=true`, refresh token
 *    nằm trong cookie httpOnly (JS không đọc được) và mã này tự động dùng luồng
 *    cookie: `store.js` không lưu gì cả, `api.js` gửi `credentials: 'include'`.
 */
(function () {
  'use strict';

  const KEY_ACCESS = 'denso.access';
  const KEY_REFRESH = 'denso.refresh';

  /** Cache trong bộ nhớ — nguồn sự thật chính. */
  const mem = { access: null, refresh: null };

  /** Đọc an toàn từ sessionStorage (private mode / quota đầy có thể ném lỗi). */
  function readStore(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      if (value) {
        window.sessionStorage.setItem(key, value);
      } else {
        window.sessionStorage.removeItem(key);
      }
    } catch (_) {
      /* bỏ qua: vẫn dùng được bộ nhớ */
    }
  }

  const store = {
    getAccess() {
      if (!mem.access) mem.access = readStore(KEY_ACCESS);
      return mem.access;
    },

    setAccess(token) {
      mem.access = token || null;
      writeStore(KEY_ACCESS, token);
    },

    getRefresh() {
      if (!mem.refresh) mem.refresh = readStore(KEY_REFRESH);
      return mem.refresh;
    },

    setRefresh(token) {
      mem.refresh = token || null;
      writeStore(KEY_REFRESH, token);
    },

    setBoth(tokens) {
      store.setAccess(tokens && tokens.access);
      store.setRefresh(tokens && tokens.refresh);
    },

    clear() {
      mem.access = null;
      mem.refresh = null;
      writeStore(KEY_ACCESS, null);
      writeStore(KEY_REFRESH, null);
    },

    hasSession() {
      return Boolean(store.getAccess() || store.getRefresh());
    },

    /** Đọc payload JWT (base64url) — CHỈ để quyết định hiển thị UI, không thay thế phân quyền server. */
    decodeAccessPayload() {
      const token = store.getAccess();
      if (!token) return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const json = decodeURIComponent(
          atob(padded)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        return JSON.parse(json);
      } catch (_) {
        return null;
      }
    },

    /** Số thứ tự `role` trong claim JWT. Xem apps/core/models.py. */
    getRole() {
      const payload = store.decodeAccessPayload();
      return payload && typeof payload.role === 'number' ? payload.role : null;
    },

    isRagManager() {
      // 500 = senior engineer, 900 = admin, 1000 = staff (xem ROLE_* trong core/models.py)
      const role = store.getRole();
      return role === 500 || role === 900 || role === 1000;
    },

    isExpired() {
      const payload = store.decodeAccessPayload();
      if (!payload || !payload.exp) return false;
      // trừ 30s để không dùng token sắp hết hạn
      return Date.now() / 1000 > payload.exp - 30;
    },
  };

  window.store = store;
})();
