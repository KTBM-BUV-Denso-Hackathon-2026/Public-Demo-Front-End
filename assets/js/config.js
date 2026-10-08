/**
 * Cấu hình runtime của frontend DENSO RAG.
 *
 * ⚠️ FILE NÀY CHỈ CHỨA CẤU HÌNH CÔNG KHAI.
 * KHÔNG BAO GIỜ đặt secret/token/khoá API vào đây — toàn bộ mã nguồn frontend
 * được gửi tới trình duyệt, bất kỳ ai cũng đọc được bằng View Source.
 *
 * Các token xác thực KHÔNG nằm ở đây: chúng được quản lý runtime bởi
 * `assets/js/store.js` và chỉ tồn tại trong bộ nhớ + sessionStorage của tab.
 *
 * Khi deploy production: sửa `API_BASE_URL` thành origin thật (https://...) và
 * sửa `connect-src` trong thẻ <meta http-equiv="Content-Security-Policy"> của
 * từng file HTML cho khớp (phải giống nhau!).
 */
window.DENSO_CONFIG = Object.freeze({
  /** Origin của denso_backend (chạy cổng 8000). KHÔNG có dấu "/" cuối. */
  API_BASE_URL: 'http://127.0.0.1:8000',

  /** Thời gian chờ (ms) cho các request JSON thông thường. */
  REQUEST_TIMEOUT_MS: 30000,

  /** Số chunk RAG mặc định (gửi kèm mỗi lượt hỏi). */
  DEFAULT_TOP_K: 5,

  /** Ngưỡng dài tối đa cho một câu hỏi (khớp AskRequestSerializer của backend). */
  MAX_QUESTION_LENGTH: 8000,

  /** Số ký tự tối đa của một file tài liệu (khớp MAX_UPLOAD_BYTES backend = 10MB). */
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,

  /** Định dạng file backend chấp nhận — phải khớp apps/rag/validators.py. */
  ALLOWED_EXTENSIONS: ['.txt', '.md', '.markdown', '.csv', '.json'],

  /** Số tin nhắn lịch sử tối đa giữ lại khi render (bảo vệ hiệu năng). */
  MAX_RENDERED_MESSAGES: 500,
});
