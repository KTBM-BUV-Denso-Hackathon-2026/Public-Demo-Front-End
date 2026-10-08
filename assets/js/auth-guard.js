/**
 * Chốt bảo vệ dùng chung cho các trang cần đăng nhập.
 *
 * - Không có phiên -> chuyển về login.html (kèm trang muốn tới để quay lại sau).
 * - Có phiên nhưng token hết hạn -> thử refresh một lần; thất bại thì xoá phiên.
 * - Được nạp TRƯỚC mọi script trang, và chạy đồng bộ phần kiểm tra ban đầu,
 *   còn phần xác thực mạng là bất đồng bộ nên các trang tự xử lý khi cần.
 */
(function () {
  'use strict';

  const LOGIN_URL = 'login.html';

  /** Đường dẫn trong cùng thư mục, giữ lại để quay lại sau khi đăng nhập. */
  function currentPage() {
    const path = window.location.pathname.split('/').pop();
    return path && path !== '' ? path : 'index.html';
  }

  function goLogin() {
    window.store.clear();
    const next = encodeURIComponent(currentPage());
    window.location.replace(LOGIN_URL + '?next=' + next);
  }

  /** Đồng bộ: nếu chắc chắn không có token thì chuyển ngay, không nháy màn hình. */
  if (!window.store.hasSession()) {
    goLogin();
  }

  window.authGuard = {
    /** Đảm bảo có phiên hợp lệ; trả về thông tin user hoặc null (đã chuyển trang). */
    async ensureSession() {
      if (!window.store.hasSession()) {
        goLogin();
        return null;
      }
      try {
        return await window.api.request('/auth/user/', { timeoutMs: 10000 });
      } catch (err) {
        if (err && err.status === 401) {
          goLogin();
          return null;
        }
        // 5xx / mạng: KHÔNG xoá phiên, chỉ báo lỗi để người dùng thử lại.
        throw err;
      }
    },

    logout() {
      // Gọi API để thu hồi refresh token ở server (nếu backend hỗ trợ) rồi xoá cục bộ.
      window.api
        .request('/auth/logout/', { method: 'POST', timeoutMs: 5000 })
        .catch(() => null)
        .then(() => {
          window.store.clear();
          window.location.replace(LOGIN_URL);
        });
    },

    LOGIN_URL: LOGIN_URL,
    goLogin: goLogin,
  };
})();
