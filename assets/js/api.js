/**
 * Lớp gọi API mỏng, tập trung vào 3 điều:
 *   1. Gắn Authorization + tự refresh token khi 401.
 *   2. Chuẩn hoá lỗi thành `ApiError` để UI hiển thị nhất quán.
 *   3. An toàn với XSS: chỉ trả về dữ liệu, KHÔNG bao giờ render.
 *
 * Quy ước lỗi backend (đã kiểm chứng thực tế):
 *   - 400 validation : {"field": ["msg1", "msg2"], ...}
 *   - 401            : {"detail": "...", "code": "...", "messages": [...]}
 *   - 403            : {"detail": "..."}
 *   - 404            : {"detail": "..."}
 *   - 429            : {"detail": "..."}
 *   - 5xx / lỗi mạng : detail hoặc thông báo chung
 */
(function () {
  'use strict';

  const CFG = window.DENSO_CONFIG;
  const BASE = String(CFG.API_BASE_URL).replace(/\/+$/, '');

  class ApiError extends Error {
    constructor(status, message, options) {
      super(message);
      this.name = 'ApiError';
      this.status = status || 0;
      /** @type {Object<string, string[]>} lỗi theo field (chỉ có khi 400) */
      this.fieldErrors = (options && options.fieldErrors) || {};
      this.code = (options && options.code) || null;
      this.isNetwork = Boolean(options && options.isNetwork);
      this.retryAfter = (options && options.retryAfter) || null;
    }
  }

  /** Ghép URL an toàn (chặn path người dùng chèn thêm scheme để chống open-redirect). */
  function buildUrl(path, query) {
    const clean = String(path).startsWith('/') ? String(path) : '/' + path;
    let url = BASE + clean;
    if (query) {
      const params = new URLSearchParams();
      Object.keys(query).forEach((key) => {
        const value = query[key];
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value);
        }
      });
      const qs = params.toString();
      if (qs) url += (url.indexOf('?') === -1 ? '?' : '&') + qs;
    }
    return url;
  }

  /**
   * Biến phản hồi lỗi thành ApiError.
   * Không bao giờ ném lộ HTML/HTML-injection từ server ra thông báo người dùng —
   * nếu body không phải JSON ta dùng text thuần, và UI sẽ render bằng textContent.
   */
  function toApiError(response) {
    const ct = response.headers.get('Content-Type') || '';
    let payload = null;
    let rawText = '';

    if (ct.indexOf('json') !== -1) {
      try {
        payload = response.json();
      } catch (_) {
        payload = null;
      }
    } else {
      try {
        rawText = response.text().slice(0, 300);
      } catch (_) {
        rawText = '';
      }
    }

    let message = '';
    let fieldErrors = {};
    let code = null;

    if (payload && typeof payload === 'object') {
      const keys = Object.keys(payload);
      const looksLikeFieldErrors = keys.length > 0 && keys.every((k) => Array.isArray(payload[k]));
      if (looksLikeFieldErrors) {
        fieldErrors = payload;
        const firstField = keys[0];
        message = Array.isArray(payload[firstField]) ? payload[firstField][0] : String(payload[firstField]);
      } else {
        message = typeof payload.detail === 'string' ? payload.detail : '';
        code = payload.code || null;
      }
    } else if (rawText) {
      message = rawText;
    }

    if (!message) {
      if (response.status === 0) message = 'Không kết nối được máy chủ.';
      else if (response.status === 401) message = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
      else if (response.status === 403) message = 'Bạn không có quyền thực hiện thao tác này.';
      else if (response.status === 404) message = 'Không tìm thấy dữ liệu.';
      else if (response.status === 429) message = 'Bạn thao tác quá nhanh. Vui lòng chậm lại.';
      else if (response.status >= 500) message = 'Máy chủ đang có sự cố. Vui lòng thử lại sau.';
      else message = 'Yêu cầu thất bại (HTTP ' + response.status + ').';
    }

    const retryAfterHeader = response.headers.get('Retry-After');
    return new ApiError(response.status, message, {
      fieldErrors: fieldErrors,
      code: code,
      retryAfter: retryAfterHeader ? parseInt(retryAfterHeader, 10) : null,
    });
  }

  /** Gộp các lần refresh đồng thời thành một promise (tránh refresh đồng loạt). */
  let refreshPromise = null;

  async function refreshTokens() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      const refresh = window.store.getRefresh();
      const options = {
        method: 'POST',
        credentials: 'include', // hỗ trợ chế độ cookie httpOnly
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      };
      if (refresh) {
        options.body = JSON.stringify({ refresh: refresh });
      }
      // Nếu không có refresh trong bộ nhớ, coi như backend dùng cookie httpOnly
      // và để trình duyệt tự gửi cookie (options.body vắng mặt).
      const res = await fetch(buildUrl('/auth/refresh/'), options);
      if (!res.ok) {
        window.store.clear();
        throw toApiError(res);
      }
      const data = await res.json();
      // Chế độ cookie: response không chứa refresh -> chỉ lưu access.
      if (data && data.access) window.store.setAccess(data.access);
      if (data && data.refresh) window.store.setRefresh(data.refresh);
      return data;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  /**
   * Thực hiện một request JSON.
   * @param {string} path
   * @param {Object} [options]
   * @param {string} [options.method]
   * @param {Object|FormData} [options.body]  FormData => gửi multipart (browser tự set boundary)
   * @param {Object} [options.query]
   * @param {boolean} [options.auth=true]      gắn Bearer token
   * @param {AbortSignal} [options.signal]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<any>}
   */
  async function request(path, options) {
    const opts = options || {};
    const method = (opts.method || 'GET').toUpperCase();

    const headers = { Accept: 'application/json' };
    let body;
    if (opts.body instanceof FormData) {
      body = opts.body; // để browser tự sinh Content-Type multipart
    } else if (opts.body !== undefined && opts.body !== null) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const send = async () => {
      const token = window.store.getAccess();
      const finalHeaders = Object.assign({}, headers);
      if (opts.auth !== false && token) {
        finalHeaders.Authorization = 'Bearer ' + token;
      }

      // Timeout thủ công (fetch không có sẵn) + hỗ trợ abort của người dùng.
      const controller = new AbortController();
      const timeoutMs = opts.timeoutMs || CFG.REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
      let onExternalAbort = null;
      if (opts.signal) {
        onExternalAbort = () => controller.abort('cancelled');
        if (opts.signal.aborted) onExternalAbort();
        else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
      }

      try {
        return await fetch(buildUrl(path, opts.query), {
          method: method,
          headers: finalHeaders,
          body: body,
          credentials: 'include',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
        if (onExternalAbort && opts.signal) {
          opts.signal.removeEventListener('abort', onExternalAbort);
        }
      }
    };

    let response;
    try {
      response = await send();
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || err.message === 'cancelled');
      if (aborted) {
        const e = new ApiError(0, 'Yêu cầu đã bị hủy.');
        e.isNetwork = true;
        e.wasCancelled = true;
        throw e;
      }
      throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra mạng hoặc API URL.', {
        isNetwork: true,
      });
    }

    // 401 -> thử refresh MỘT LẦN rồi phát lại (tránh vòng lặp vô hạn)
    if (response.status === 401 && opts.auth !== false && !opts._retried) {
      try {
        await refreshTokens();
        return await request(path, Object.assign({}, opts, { _retried: true }));
      } catch (_) {
        window.store.clear();
        throw toApiError(response);
      }
    }

    if (response.status === 204) return null;

    if (!response.ok) throw toApiError(response);

    const ct = response.headers.get('Content-Type') || '';
    if (ct.indexOf('json') === -1) return null;
    try {
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  /**
   * Upload file có thanh tiến trình (fetch không hỗ trợ upload progress → dùng XHR).
   * @param {string} path
   * @param {FormData} formData
   * @param {(percent:number)=>void} [onProgress]
   * @param {AbortSignal} [signal]
   */
  function upload(path, formData, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', buildUrl(path), true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      const token = window.store.getAccess();
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      // KHÔNG tự set Content-Type: browser cần tự sinh boundary.

      if (signal) {
        if (signal.aborted) {
          reject(new ApiError(0, 'Đã hủy tải lên.'));
          return;
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        let payload = null;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch (_) {
          payload = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload);
          return;
        }
        let message = 'Tải lên thất bại (HTTP ' + xhr.status + ').';
        let fieldErrors = {};
        if (payload && typeof payload === 'object') {
          const keys = Object.keys(payload);
          if (keys.length && keys.every((k) => Array.isArray(payload[k]))) {
            fieldErrors = payload;
            message = payload[keys[0]][0];
          } else if (typeof payload.detail === 'string') {
            message = payload.detail;
          }
        }
        reject(new ApiError(xhr.status, message, { fieldErrors: fieldErrors }));
      });

      xhr.addEventListener('error', () =>
        reject(new ApiError(0, 'Không kết nối được máy chủ.', { isNetwork: true }))
      );
      xhr.addEventListener('abort', () =>
        reject(Object.assign(new ApiError(0, 'Đã hủy tải lên.'), { wasCancelled: true }))
      );

      xhr.send(formData);
    });
  }

  /**
   * Đọc luồng SSE từ `POST .../ask/` (EventSource không hỗ trợ POST nên phải tự parse).
   *
   * LƯU Ý: cố tình gửi `Accept` kiểu wildcard thay vì `text/event-stream`.
   * `ChatAskView` là DRF `APIView`, nên request đi qua content negotiation của
   * DRF; nếu client gửi `Accept: text/event-stream` thì không renderer nào khớp
   * và server trả **406 Not Acceptable** trước khi view kịp chạy. View trả về
   * `StreamingHttpResponse` thuần nên không cần khai báo media type ở request.
   *
   * @returns {Promise<void>} resolve khi luồng kết thúc.
   */
  async function streamChat(chatId, payload, handlers, signal) {
    handlers = handlers || {};
    const token = window.store.getAccess();

    const headers = { 'Content-Type': 'application/json', Accept: '*/*' };
    if (token) headers.Authorization = 'Bearer ' + token;

    let response;
    try {
      response = await fetch(buildUrl('/chat/chats/' + encodeURIComponent(chatId) + '/ask/'), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        credentials: 'include',
        signal: signal,
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const e = new ApiError(0, 'Đã dừng sinh câu trả lời.');
        e.wasCancelled = true;
        throw e;
      }
      throw new ApiError(0, 'Không kết nối được máy chủ RAG.', { isNetwork: true });
    }

    if (!response.ok || !response.body) {
      // Đọc lại body để lấy message cụ thể (json hoặc text)
      let message = '';
      try {
        const ct = response.headers.get('Content-Type') || '';
        if (ct.indexOf('json') !== -1) {
          const p = await response.json();
          message =
            (p && typeof p.detail === 'string' && p.detail) ||
            (p && p.question && p.question[0]) ||
            'Không thể hỏi đáp.';
        } else {
          message = (await response.text()).slice(0, 200);
        }
      } catch (_) {
        message = 'Không thể hỏi đáp (HTTP ' + response.status + ').';
      }
      throw new ApiError(response.status, message);
    }

    const reader = response.body.getReader();
    // Bắt buộc decode UTF-8 tích luỹ: tiếng Việt có thể bị cắt giữa 2 byte.
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const handleFrame = (rawFrame) => {
      const frame = rawFrame.trim();
      if (!frame) return;
      // Chỉ quan tâm trường `data:` theo chuẩn SSE (bỏ qua comment/event/id).
      const line = frame.indexOf('data:') === 0 ? frame.slice(5).trim() : null;
      if (line === null) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch (_) {
        return; // bỏ qua frame hỏng thay vì làm sập cả luồng
      }
      if (!event || typeof event.type !== 'string') return;
      if (event.type === 'delta' && typeof event.delta === 'string') {
        if (handlers.onDelta) handlers.onDelta(event.delta);
      } else if (event.type === 'end') {
        if (handlers.onEnd) handlers.onEnd(event);
      } else if (event.type === 'error') {
        if (handlers.onError) handlers.onError(event.error || 'Lỗi không xác định.');
      } else if (event.type === 'start' && handlers.onStart) {
        handlers.onStart(event);
      }
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE phân tách frame bằng dòng trống
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleFrame(frame);
        }
      }
      // phần còn lại nếu server không kết thúc bằng dòng trống
      buffer += decoder.decode();
      if (buffer.trim()) handleFrame(buffer);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const e = new ApiError(0, 'Đã dừng sinh câu trả lời.');
        e.wasCancelled = true;
        throw e;
      }
      throw err;
    } finally {
      try {
        reader.releaseLock();
      } catch (_) {
        /* ignore */
      }
    }
  }

  window.api = {
    ApiError: ApiError,
    buildUrl: buildUrl,
    request: request,
    upload: upload,
    refreshTokens: refreshTokens,
    streamChat: streamChat,
  };
})();
