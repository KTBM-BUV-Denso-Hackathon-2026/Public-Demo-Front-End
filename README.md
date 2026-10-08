# Frontend — DENSO RAG Chatbot

Giao diện web tĩnh (HTML + CSS + JavaScript thuần) cho hệ thống DENSO RAG.
**Không có build step, không framework, không npm** — mở file là chạy.

| Trang | File | Dành cho | Mô tả |
|---|---|---|---|
| Hỏi đáp | `index.html` | Mọi user đã đăng nhập | Chat RAG kiểu ChatGPT/Gemini: sidebar lịch sử, streaming SSE, nguồn tham khảo |
| Đăng nhập / đăng ký | `login.html` | Khách | Hai tab trên cùng trang, hiện lỗi theo từng field |
| Tài liệu tri thức | `knowledge.html` | `Senior Engineer` / `Admin` | Tải tài liệu lên để RAG nạp vào vector DB, quản lý & xem các đoạn chunk |

---

## 1. Chạy thử trong 30 giây

Cần backend đang chạy (xem `../README.md` mục 3). Sau đó:

```bash
python frontend/serve.py
```

Mở <http://127.0.0.1:5173/login.html>.

Tài khoản demo (đã có sẵn trong DB khi bàn giao):

| Email | Mật khẩu | Cấp bậc |
|---|---|---|
| `e2e@example.com` | `MatKhau123!` | Senior Engineer (được tải tài liệu) |

> ⚠️ **Trước khi đưa lên production: xoá tài khoản demo này** hoặc đổi mật khẩu.
> Nó là tài khoản test do script E2E của dự án tạo ra.

### Tuỳ chọn `serve.py`

```bash
python frontend/serve.py --port 8080          # đổi cổng
python frontend/serve.py --host 0.0.0.0       # cho phép trong mạng nội bộ (có cảnh báo)
python frontend/serve.py --certfile c.pem --keyfile k.pem   # bật HTTPS
```

### Cấu hình trỏ API

Sửa `assets/js/config.js`:

```js
API_BASE_URL: 'http://127.0.0.1:8000',   // origin của denso_backend
```

**Bắt buộc sửa kèm 2 chỗ**, nếu không trang sẽ bị CSP chặn request:

1. `connect-src` trong thẻ `<meta http-equiv="Content-Security-Policy">` của
   **cả 3 file HTML**.
2. `connect-src` trong `SECURITY_HEADERS` của `serve.py` (nếu dùng `serve.py`).

```html
connect-src 'self' https://api.congty.com
```

Phía backend cũng phải cho phép origin của frontend
(`CORS_ALLOWED_ORIGINS` trong `denso_backend/.env`).

---

## 2. Cấu trúc thư mục

```
frontend/
├── index.html              Trang chat
├── login.html              Đăng nhập / đăng ký
├── knowledge.html          Quản lý tài liệu RAG
├── serve.py                Static server kèm security headers (dev/demo)
├── README.md               File này
└── assets/
    ├── css/app.css         Toàn bộ style riêng của app
    ├── js/
    │   ├── config.js       ⚠️ CHỈ chứa cấu hình công khai (API base URL)
    │   ├── store.js        Quản lý token (bộ nhớ + sessionStorage)
    │   ├── api.js          Fetch wrapper: auth, refresh, phân tích SSE
    │   ├── ui.js           Tiện ích DOM an toàn (không innerHTML), toast
    │   ├── auth-guard.js   Chốt bảo vệ dùng chung cho các trang
    │   ├── auth-page.js    Logic trang đăng nhập
    │   ├── chat-page.js    Logic trang chat
    │   └── knowledge-page.js  Logic trang tài liệu
    └── vendor/             Bootstrap 5.3.8 + Bootstrap Icons 1.13.1 (đã vendor)
```

**Vì sao vendor Bootstrap thay vì CDN?**
Không phụ thuộc mạng ngoài (chạy được trong mạng nội bộ/air-gapped), không
phát sinh request ra domain thứ ba (thuận cho CSP và quyền riêng tư), không
lo rủi ro CDN bị chèn thêm mã. Toàn bộ thư viện đều có giấy phép MIT.

---

## 3. Bảo mật

### 3.1 Chống XSS — hàng rào chính

> **Quy tắc bất biến của toàn bộ frontend: không bao giờ gán dữ liệu từ server vào
> `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write`.
> Mọi thứ đi qua `textContent`.**

Lý do đặc biệt quan trọng ở hệ thống này: **dữ liệu RAG đến từ file người dùng
tải lên** — hoàn toàn không đáng tin cậy. Nếu render HTML thì chỉ cần một tài
liệu `.md` chứa `<script>` là chiếm được phiên của mọi người.

Cơ chế cụ thể trong `ui.js`:
- `el(tag, opts, children)` — tạo node, `opts.text` luôn qua `textContent`.
- `renderText(node, text)` — "markdown nhẹ" chỉ hỗ trợ xuống dòng + gạch đầu
  dòng, và dựng bằng **text node**; không có parser HTML nào.
- `icon(name)` — allow-list tên class `^[a-z0-9-]+$`, tên lạ thay bằng icon mặc định.

Kiểm chứng: đã thử tài liệu chứa `<script>`, `<img onerror>`, `<iframe src=javascript:>`
và tiêu đề chứa HTML → DOM có **0** thẻ `script`/`img`/`iframe` được tạo, payload
hiển thị nguyên văn dạng text.

### 3.2 Content Security Policy

Không có `'unsafe-inline'`, không có `'unsafe-eval'`. Hệ quả: **mọi script phải nằm
trong file ngoài, mọi handler phải dùng `addEventListener`, không được dùng
thuộc tính `style="..."` hay `onclick="..."` trong HTML.** Đã rà soát toàn bộ và
tuân thủ — console sạch, không có cảnh báo CSP.

Lưu ý: `frame-ancestors` **không có tác dụng** trong thẻ `<meta>`. Phải set ở
HTTP header — `serve.py` và cấu hình nginx bên dưới đã làm việc đó.

### 3.3 Quản lý token

| | Lưu ở đâu | Vì sao |
|---|---|---|
| access token | bộ nhớ JS + `sessionStorage` | `localStorage` bị **mọi** script cùng origin đọc và tồn tại vĩnh viễn → không dùng |
| refresh token | `sessionStorage` | hạn chế thiệt hại ở mức 1 tab / 1 phiên |

**Nói thẳng giới hạn:** với kiến trúc token-trong-body, không thể an toàn tuyệt đối
phía client — nếu kẻ tấn công chạy được JS trong tab của bạn thì nó đọc được
`sessionStorage`. Cách chống XSS thật sự là CSP nghiêm ngặt + không dùng
`innerHTML` (đã làm ở trên).

**Cách tốt nhất** — bật cookie httpOnly ở backend, khi đó JS **không đọc được**
refresh token:

```ini
# denso_backend/.env
JWT_ALLAUTH_REFRESH_TOKEN_AS_COOKIE=true
CORS_ALLOWED_ORIGINS=https://rag-noi-bo.congty.com
CORS_ALLOW_CREDENTIALS=true
```

Frontend **tự chuyển** sang luồng cookie: `api.js` luôn gửi
`credentials: 'include'`, và khi response không có `refresh` trong body thì nó
refresh bằng cookie. Không cần sửa code frontend.

### 3.4 Phân quyền

Giao diện đọc claim `role` trong JWT để ẩn/hiện nút (chỉ để tiện nghiệm giao diện).
**Backend vẫn là nơi phân quyền thật** và trả 403 nếu không đủ quyền — đã kiểm
chứng: tài khoản `Worker` bị 403 khi thử upload.

### 3.5 Không rò rỉ bí mật

- `config.js` **chỉ** chứa URL công khai. Không có API key, token hay secret nào.
- Frontend **không bao giờ** biết `LLM_API_TOKEN` / `RAG_WORKER_TOKEN` (token nội
  bộ giữa 3 service ở backend).
- Link mở tệp gốc dùng `rel="noopener noreferrer"`.
- Mọi request ngoài đều qua `api.js` với header `Authorization` được thêm tập trung.

### 3.6 Rate limit & session

Backend đã bật throttle (`THROTTLE_ANON=60/min`, `THROTTLE_USER=600/min`).
Frontend xử lý 401 → refresh một lần → hết hạn thì chuyển về trang đăng nhập.

---

## 4. Triển khai production

### 4.1 Mẫu nginx

```nginx
server {
    listen 443 ssl http2;
    server_name rag-noi-bo.congty.com;

    ssl_certificate     /etc/ssl/certs/rag.crt;
    ssl_certificate_key /etc/ssl/private/rag.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    root /srv/denso/frontend;
    index index.html;

    # --- Header bảo mật cho toàn site ---
    # `connect-src` PHẢI khớp API_BASE_URL trong assets/js/config.js
    add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' https://api-noi-bo.congty.com" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy        "camera=(), geolocation=(), microphone=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # HTML không cache (chứa đường dẫn asset -> deploy không bị "cũ")
    location ~* \.html$ {
        add_header Cache-Control "no-store";
    }

    # Asset có tên cố định -> chỉ cache lại khi đổi tên file
    location ~* \.(css|js|woff2?|png|svg|ico)$ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        try_files $uri $uri/ =404;
    }
}

# --- Backend API ---
server {
    listen 443 ssl http2;
    server_name api-noi-bo.congty.com;

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        # SSE: tắt buffering, nới timeout
        proxy_buffering    off;
        proxy_read_timeout 600s;
        client_max_body_size 12m;   # khớp MAX_UPLOAD_BYTES backend (10MB)
    }
}
```

### 4.2 Checklist trước khi lên production

- [ ] `API_BASE_URL` trỏ origin thật (có `https://`).
- [ ] `connect-src` khớp ở **cả 3 HTML + `serve.py` + nginx**.
- [ ] `CORS_ALLOWED_ORIGINS` trong `denso_backend/.env` = origin frontend.
- [ ] `SECRET_KEY` thật, `DEBUG=False`, `ALLOWED_HOSTS` đúng domain.
- [ ] `INTERNAL_API_TOKEN` (llm_api + rag_worker) đã đặt; `/ready` báo
      `"auth_required": true`.
- [ ] **Xoá/đổi mật khẩu tài khoản demo** `e2e@example.com`.
- [ ] Bật `JWT_ALLAUTH_REFRESH_TOKEN_AS_COOKIE=true` (xem 3.3).
- [ ] HTTPS + HSTS (đã có trong mẫu nginx).
- [ ] `allowed_hosts` / `CSRF_TRUSTED_ORIGINS` nếu Django chạy sau proxy HTTPS.

### 4.3 Docker

```dockerfile
FROM nginx:1.27-alpine
COPY frontend/ /usr/share/nginx/html/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

---

## 5. Ghi chú kỹ thuật

**Vì sao tự parse SSE thay vì dùng `EventSource`?**
`EventSource` chỉ hỗ trợ `GET` và không gửi header `Authorization`.
`api.js::streamChat` dùng `fetch` + `ReadableStream` + `TextDecoder('utf-8')`
để decode tiếng Việt (bắt buộc `{ stream: true }` vì ký tự có thể bị cắt giữa
2 byte).

**Vì sao `Accept: */*` chứ không phải `text/event-stream`?**
`ChatAskView` là DRF `APIView` nên request đi qua content negotiation của DRF.
Gửi `Accept: text/event-stream` sẽ không khớp renderer nào và server trả
**406 Not Acceptable**. View trả `StreamingHttpResponse` thuần nên không cần khai
báo media type ở request.

**Nguồn tham khảo ở chế độ streaming.**
`llm_api` gửi `contexts` kèm event `end` của luồng SSE (xem
`llm_api/schemas.py::StreamEvent`), nên client hiển thị được nguồn ngay mà không
phải gọi lại API.

**`role` trong JWT.** `0` = Worker, `500` = Senior Engineer, `900` = Admin,
`1000` = Staff — xem `denso_backend/apps/core/models.py` (`ROLE_*`).

**Không cache HTML.** `serve.py` và nginx đặt `no-store` cho `.html`, còn lại thì
cache dài hạn. Nếu bạn đổi tên file asset, hãy tăng phiên bản trong `index.html`.
