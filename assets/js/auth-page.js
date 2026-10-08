/**
 * Trang đăng nhập / đăng ký.
 *
 * Luồng:
 *   - Nếu đã có phiên hợp lệ -> vào thẳng index.html (tránh màn hình thừa).
 *   - Login/Register gọi API thật, hiển thị lỗi theo từng field do backend trả.
 *   - Sau khi có token: lưu vào store rồi chuyển hướng sang index.html.
 */
(function () {
  'use strict';

  const el = window.ui.el;
  const clear = window.ui.clear;

  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const btnLogin = document.getElementById('btn-login');
  const btnRegister = document.getElementById('btn-register');
  const globalError = document.getElementById('global-error');

  /**
   * Trang đích sau khi đăng nhập/đăng ký.
   *
   * `auth-guard.js` gắn `?next=<trang>` khi chuyển hướng do mất phiên. Chỉ chấp
   * nhận tên file cục bộ trong danh sách cho phép — nếu nhận chuỗi bất kỳ từ
   * query string thì sẽ mở lỗ hổng open-redirect (kẻ xấu gửi link
   * `login.html?next=https://evil.example` để đưa nạn nhân sang site khác).
   */
  const ALLOWED_NEXT = ['index.html', 'knowledge.html'];

  function nextPage() {
    let raw = '';
    try {
      raw = new URLSearchParams(window.location.search).get('next') || '';
    } catch (_) {
      raw = '';
    }
    return ALLOWED_NEXT.indexOf(raw) !== -1 ? raw : 'index.html';
  }

  function goToApp() {
    // replace() để nút Back không quay lại trang đăng nhập đã dùng xong.
    window.location.replace(nextPage());
  }

  // ------------------------------------------------------------------ helpers

  function showGlobalError(message) {
    if (!message) {
      globalError.classList.add('d-none');
      clear(globalError);
      return;
    }
    clear(globalError);
    // textContent => không bao giờ render HTML từ server.
    globalError.appendChild(
      el('span', { className: 'd-inline-flex align-items-start gap-2' }, [
        window.ui.icon('exclamation-octagon-fill', 'flex-shrink-0 mt-1'),
        el('span', { text: message }),
      ])
    );
    globalError.classList.remove('d-none');
  }

  /** Vẽ lỗi dưới từng input (không dùng innerHTML). */
  function renderFieldErrors(form, fieldErrors) {
    form.querySelectorAll('.field-error').forEach((n) => n.remove());
    form.querySelectorAll('.is-invalid').forEach((n) => n.classList.remove('is-invalid'));

    Object.keys(fieldErrors || {}).forEach((name) => {
      const input = form.querySelector('[name="' + name + '"]');
      const messages = Array.isArray(fieldErrors[name]) ? fieldErrors[name] : [String(fieldErrors[name])];
      if (!input) return;
      input.classList.add('is-invalid');
      input.parentNode.appendChild(el('span', { className: 'field-error', text: messages.join(' ') }));
    });
  }

  function setBusy(button, busy, busyLabel) {
    button.disabled = busy;
    clear(button);
    if (busy) {
      button.appendChild(window.ui.icon('arrow-repeat', 'spinner-border spinner-border-sm me-1'));
      button.appendChild(el('span', { text: busyLabel }));
    }
  }

  /** Kiểm tra phía client để báo lỗi nhanh; backend vẫn là nguồn chân lý. */
  function validateLogin(email, password) {
    const errors = {};
    if (!email) errors.email = ['Vui lòng nhập email.'];
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = ['Email không hợp lệ.'];
    if (!password) errors.password = ['Vui lòng nhập mật khẩu.'];
    return errors;
  }

  function validateRegister(data) {
    const errors = {};
    if (!data.first_name) errors.first_name = ['Vui lòng nhập họ.'];
    if (!data.last_name) errors.last_name = ['Vui lòng nhập tên.'];
    if (!data.email) errors.email = ['Vui lòng nhập email.'];
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = ['Email không hợp lệ.'];
    if (!data.password1) errors.password1 = ['Vui lòng nhập mật khẩu.'];
    else if (data.password1.length < 8) errors.password1 = ['Mật khẩu phải có ít nhất 8 ký tự.'];
    if (data.password1 !== data.password2) errors.password2 = ['Hai mật khẩu không khớp.'];
    return errors;
  }

  // ------------------------------------------------------------- password eye

  function setupPasswordToggle(buttonId, inputId) {
    const btn = document.getElementById(buttonId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-label', showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
      btn.setAttribute('title', showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
      clear(btn);
      btn.appendChild(window.ui.icon(showing ? 'eye' : 'eye-slash'));
      input.focus();
    });
  }

  // ------------------------------------------------------------------- submit

  async function handleLogin(event) {
    event.preventDefault();
    showGlobalError(null);
    renderFieldErrors(formLogin, {});

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const errors = validateLogin(email, password);
    if (Object.keys(errors).length) {
      renderFieldErrors(formLogin, errors);
      return;
    }

    setBusy(btnLogin, true, 'Đang đăng nhập…');
    try {
      const tokens = await window.api.request(
        '/auth/login/',
        { method: 'POST', auth: false, body: { email: email, password: password } }
      );
      window.store.setBoth(tokens);
      goToApp();
    } catch (err) {
      renderFieldErrors(formLogin, err.fieldErrors);
      showGlobalError(err.message || 'Đăng nhập thất bại.');
      setBusy(btnLogin, false);
      window.ui.toast(err.message || 'Đăng nhập thất bại.', 'danger');
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    showGlobalError(null);
    renderFieldErrors(formRegister, {});

    const data = {
      first_name: document.getElementById('reg-first').value.trim(),
      last_name: document.getElementById('reg-last').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      password1: document.getElementById('reg-pw1').value,
      password2: document.getElementById('reg-pw2').value,
    };

    const errors = validateRegister(data);
    if (Object.keys(errors).length) {
      renderFieldErrors(formRegister, errors);
      return;
    }

    setBusy(btnRegister, true, 'Đang tạo…');
    try {
      const tokens = await window.api.request('/auth/registration/', {
        method: 'POST',
        auth: false,
        body: data,
      });
      window.store.setBoth(tokens);
      window.ui.toast('Tạo tài khoản thành công. Chào mừng bạn!', 'success');
      goToApp();
    } catch (err) {
      renderFieldErrors(formRegister, err.fieldErrors);
      showGlobalError(err.message || 'Đăng ký thất bại.');
      setBusy(btnRegister, false);
      window.ui.toast(err.message || 'Đăng ký thất bại.', 'danger');
    }
  }

  // -------------------------------------------------------------------- init

  setupPasswordToggle('toggle-login-pw', 'login-password');
  setupPasswordToggle('toggle-reg-pw', 'reg-pw1');
  formLogin.addEventListener('submit', handleLogin);
  formRegister.addEventListener('submit', handleRegister);

  // Đã đăng nhập rồi -> không cần ở lại trang này.
  (async function redirectIfAuthenticated() {
    if (!window.store.hasSession()) return;
    try {
      await window.api.request('/auth/user/', { timeoutMs: 8000 });
      goToApp();
    } catch (_) {
      // Token hỏng/hết hạn -> dọn phiên và ở lại trang đăng nhập.
      window.store.clear();
    }
  })();
})();
