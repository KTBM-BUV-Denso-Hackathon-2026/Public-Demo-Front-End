/**
 * Trang tài liệu tri thức (knowledge.html).
 *
 * Dành cho `senior engineer` / `admin` / superuser — tức những người được phép
 * nạp tài liệu vào RAG (xem apps/core/permissions.py::IsRAGManager).
 *
 * Lưu ý về phân quyền: giao diện ẩn/hiện nút dựa trên claim `role` trong JWT
 * để người dùng không thấy thao tác mình không làm được. Đây CHỈ là tiện nghiệp
 * giao diện — backend vẫn kiểm tra lại và trả 403 nếu không đủ quyền.
 */
(function () {
  'use strict';

  const el = window.ui.el;
  const clear = window.ui.clear;
  const CFG = window.DENSO_CONFIG;

  const state = {
    page: 1,
    pageSize: 20,
    status: '',
    total: 0,
    canManage: false,
    selectedFile: null,
    editingId: null,
    abortController: null,
  };

  const dom = {
    sidebar: document.getElementById('sidebar'),
    openSidebar: document.getElementById('btn-open-sidebar'),
    closeSidebar: document.getElementById('btn-close-sidebar'),
    logout: document.getElementById('btn-logout'),
    userLabel: document.getElementById('user-label'),
    menuEmail: document.getElementById('menu-email'),
    menuLevel: document.getElementById('menu-level'),
    noPermission: document.getElementById('no-permission'),
    uploadSection: document.getElementById('upload-section'),
    formUpload: document.getElementById('form-upload'),
    titleInput: document.getElementById('upload-title-input'),
    summaryInput: document.getElementById('upload-summary'),
    dropzone: document.getElementById('dropzone'),
    dropzoneTitle: document.getElementById('dropzone-title'),
    fileInput: document.getElementById('file-input'),
    fileHint: document.getElementById('file-hint'),
    dropzoneHint: document.getElementById('dropzone-hint'),
    progress: document.getElementById('upload-progress'),
    progressBar: document.getElementById('upload-progress-bar'),
    btnUpload: document.getElementById('btn-upload'),
    btnCancel: document.getElementById('btn-cancel-upload'),
    btnRefresh: document.getElementById('btn-refresh'),
    filterStatus: document.getElementById('filter-status'),
    docRows: document.getElementById('doc-rows'),
    listSummary: document.getElementById('list-summary'),
    pagerInfo: document.getElementById('pager-info'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    modalDoc: document.getElementById('modal-doc'),
    modalDocBody: document.getElementById('modal-doc-body'),
    modalDocLabel: document.getElementById('modal-doc-label'),
    modalEdit: document.getElementById('modal-edit'),
    formEdit: document.getElementById('form-edit'),
    editTitle: document.getElementById('edit-title'),
    editSummary: document.getElementById('edit-summary'),
  };

  // ------------------------------------------------------------------ helpers
  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function extensionOf(name) {
    const idx = String(name || '').lastIndexOf('.');
    return idx === -1 ? '' : String(name).slice(idx).toLowerCase();
  }

  /** Đường dẫn tải tệp: API trả về "/media/..." (list) hoặc URL tuyệt đối (detail). */
  function fileUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return window.api.buildUrl(path);
  }

  function setBusy(button, busy, iconName, label) {
    button.disabled = busy;
    clear(button);
    button.appendChild(window.ui.icon(iconName, busy ? 'spinner-border spinner-border-sm me-1' : 'me-1'));
    button.appendChild(el('span', { text: label }));
  }

  // --------------------------------------------------------------- hiển thị
  function renderNoPermission() {
    clear(dom.noPermission);
    dom.noPermission.appendChild(
      el('span', { className: 'd-inline-flex align-items-start gap-2' }, [
        window.ui.icon('shield-lock', 'flex-shrink-0 mt-1'),
        el('span', {
          text:
            'Bạn đang đăng nhập với cấp bậc ' +
            (dom.menuLevel.textContent || 'Worker') +
            '. Chỉ Senior Engineer hoặc Admin mới được tải tài liệu lên. ' +
            'Bạn vẫn có thể xem và dùng tài liệu do người khác nạp.',
        }),
      ])
    );
    dom.noPermission.classList.remove('d-none');
    dom.uploadSection.classList.add('d-none');
    dom.btnRefresh.classList.remove('d-none');
  }

  function renderRows(items) {
    clear(dom.docRows);

    if (!items.length) {
      dom.docRows.appendChild(
        el('tr', {}, [
          el('td', { attrs: { colspan: '5' } }, [
            el('div', { className: 'text-center text-muted-2 py-4' }, [
              window.ui.icon('inbox', 'fs-3 d-block mb-2'),
              el('span', { text: 'Chưa có tài liệu nào. Dùng ô tải lên ở trên để thêm tài liệu đầu tiên.' }),
            ]),
          ]),
        ])
      );
      return;
    }

    items.forEach((doc) => {
      const titleCell = el('div', { className: 'doc-title-cell', text: doc.title || '(không tên)' });

      const statusCell = el('td', {}, [window.ui.statusBadge(doc.status, doc.status_display)]);
      if (doc.status === 'failed' && doc.error) {
        statusCell.appendChild(
          el('div', {
            className: 'small text-danger mt-1',
            text: window.ui.truncate(doc.error, 120),
            title: doc.error,
          })
        );
      }

      const actions = el('div', { className: 'btn-group btn-group-sm', attrs: { role: 'group' } });

      const viewBtn = el('button', {
        className: 'btn btn-outline-secondary',
        attrs: { type: 'button', 'aria-label': 'Xem các đoạn đã nạp' },
        title: 'Xem các đoạn đã nạp',
      }, [window.ui.icon('list-ul')]);
      viewBtn.addEventListener('click', () => openDocDetail(doc));
      actions.appendChild(viewBtn);

      if (state.canManage) {
        const editBtn = el('button', {
          className: 'btn btn-outline-secondary',
          attrs: { type: 'button', 'aria-label': 'Sửa thông tin' },
          title: 'Sửa thông tin',
        }, [window.ui.icon('pencil-square')]);
        editBtn.addEventListener('click', () => openEditModal(doc));
        actions.appendChild(editBtn);

        const delBtn = el('button', {
          className: 'btn btn-outline-danger',
          attrs: { type: 'button', 'aria-label': 'Xoá tài liệu' },
          title: 'Xoá',
        }, [window.ui.icon('trash3')]);
        delBtn.addEventListener('click', () => confirmDeleteDoc(doc));
        actions.appendChild(delBtn);
      }

      dom.docRows.appendChild(
        el('tr', {}, [
          el('td', {}, [titleCell]),
          statusCell,
          el('td', { className: 'text-end', text: String(doc.chunk_count || 0) }),
          el('td', { className: 'text-muted-2 small', text: window.ui.formatRelative(doc.updated_at || doc.created_at) }),
          el('td', { className: 'text-end' }, [actions]),
        ])
      );
    });
  }

  function renderPager() {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    dom.pagerInfo.textContent =
      'Trang ' + state.page + '/' + totalPages + ' · tổng ' + state.total + ' tài liệu';
    dom.btnPrev.disabled = state.page <= 1;
    dom.btnNext.disabled = state.page >= totalPages;
  }

  // -------------------------------------------------------------------- data
  async function loadDocs() {
    try {
      const data = await window.api.request('/rag/raw-data/', {
        query: { page: state.page, page_size: state.pageSize, status: state.status },
      });
      state.total = (data && data.count) || 0;
      renderRows((data && data.results) || []);
      renderPager();
      dom.listSummary.textContent = 'Dữ liệu mà chatbot dùng để trả lời.';
    } catch (err) {
      if (err.status === 401) {
        window.authGuard.goLogin();
        return;
      }
      clear(dom.docRows);
      dom.docRows.appendChild(
        el('tr', {}, [
          el('td', { attrs: { colspan: '5' } }, [
            el('div', { className: 'text-danger small py-4 text-center', text: err.message }),
          ]),
        ])
      );
      window.ui.toast(err.message, 'danger');
    }
  }

  // ------------------------------------------------------------------- upload
  function validateFile(file) {
    if (!file) return 'Vui lòng chọn một tệp tài liệu.';
    const ext = extensionOf(file.name);
    if (CFG.ALLOWED_EXTENSIONS.indexOf(ext) === -1) {
      return 'Định dạng "' + (ext || 'không có đuôi') + '" không được hỗ trợ. Chỉ nhận: ' +
        CFG.ALLOWED_EXTENSIONS.join(', ') + '.';
    }
    if (file.size > CFG.MAX_UPLOAD_BYTES) {
      // Nêu rõ cả byte vì formatBytes() làm tròn, nếu không sẽ ra
      // "10.0 MB" so với "Giới hạn 10.0 MB" — trông vô lý.
      return (
        'Tệp quá lớn: ' +
        formatBytes(file.size) +
        ' (' +
        file.size.toLocaleString('vi-VN') +
        ' byte). Giới hạn là ' +
        formatBytes(CFG.MAX_UPLOAD_BYTES) +
        ' (' +
        CFG.MAX_UPLOAD_BYTES.toLocaleString('vi-VN') +
        ' byte).'
      );
    }
    if (file.size === 0) return 'Tệp rỗng.';
    return null;
  }

  function showSelectedFile(file) {
    clear(dom.dropzoneTitle);
    clear(dom.dropzoneHint);
    if (!file) {
      dom.dropzoneTitle.textContent = 'Nhấn để chọn tệp, hoặc kéo thả vào đây';
      dom.dropzoneHint.textContent = CFG.ALLOWED_EXTENSIONS.join(' · ') +
        ' — tối đa ' + formatBytes(CFG.MAX_UPLOAD_BYTES);
      clear(dom.fileHint);
      state.selectedFile = null;
      return;
    }
    dom.dropzoneTitle.textContent = file.name;
    dom.dropzoneHint.textContent = formatBytes(file.size) + ' · ' + (extensionOf(file.name) || '—');
    dom.fileHint.textContent = 'Đã chọn: ' + file.name;
    state.selectedFile = file;
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (state.abortController) return;

    const title = dom.titleInput.value.trim();
    if (!title) {
      window.ui.toast('Vui lòng nhập tiêu đề tài liệu.', 'warning');
      dom.titleInput.focus();
      return;
    }

    const problem = validateFile(state.selectedFile);
    if (problem) {
      window.ui.toast(problem, 'warning');
      return;
    }

    const form = new FormData();
    form.append('title', title);
    form.append('file', state.selectedFile, state.selectedFile.name);
    const summary = dom.summaryInput.value.trim();
    if (summary) form.append('summary', summary);

    state.abortController = new AbortController();
    setBusy(dom.btnUpload, true, 'cloud-arrow-up', 'Đang tải lên…');
    dom.btnCancel.classList.remove('d-none');
    dom.progress.classList.remove('d-none');
    dom.progressBar.style.width = '0%';
    dom.progressBar.textContent = '0%';

    try {
      const result = await window.api.upload(
        '/rag/raw-data/',
        form,
        (percent) => {
          dom.progressBar.style.width = percent + '%';
          dom.progressBar.textContent = percent + '%';
          dom.progress.setAttribute('aria-valuenow', String(percent));
        },
        state.abortController.signal
      );

      const ingestion = (result && result.ingestion) || {};
      const status = ingestion.status || (result && result.status);
      if (status === 'done') {
        window.ui.toast(
          'Đã nạp "' + (result.title || title) + '": ' + (ingestion.chunks || 0) + ' đoạn.',
          'success'
        );
      } else {
        window.ui.toast(
          'Tài liệu đã lưu nhưng nạp RAG không thành công. Xem cột "Trạng thái".',
          'warning'
        );
      }

      dom.formUpload.reset();
      showSelectedFile(null);
      state.page = 1;
      await loadDocs();
    } catch (err) {
      if (err.wasCancelled) {
        window.ui.toast('Đã huỷ tải lên.', 'info');
      } else if (err.status === 401) {
        window.authGuard.goLogin();
      } else {
        window.ui.toast(err.message || 'Tải lên thất bại.', 'danger');
      }
    } finally {
      state.abortController = null;
      setBusy(dom.btnUpload, false, 'cloud-arrow-up', 'Tải lên & nạp vào RAG');
      dom.btnCancel.classList.add('d-none');
      window.setTimeout(() => dom.progress.classList.add('d-none'), 1200);
    }
  }

  // ---------------------------------------------------------------- chi tiết
  async function openDocDetail(row) {
    dom.modalDocLabel.textContent = row.title || 'Chi tiết tài liệu';
    clear(dom.modalDocBody);
    dom.modalDocBody.appendChild(
      el('div', { className: 'text-center py-4 text-muted-2' }, [
        window.ui.icon('arrow-repeat', 'spinner-border mb-2 d-block'),
        el('span', { text: 'Đang tải…' }),
      ])
    );
    window.bootstrap.Modal.getOrCreateInstance(dom.modalDoc).show();

    try {
      const [detail, chunks] = await Promise.all([
        window.api.request('/rag/raw-data/' + encodeURIComponent(row.id) + '/'),
        window.api.request('/rag/chunks/', {
          query: { raw_data: row.id, page_size: 100 },
        }),
      ]);

      clear(dom.modalDocBody);

      const dl = el('dl', { className: 'kv row' });
      const addKv = (label, value) => {
        dl.appendChild(el('dt', { className: 'col-sm-3', text: label }));
        dl.appendChild(el('dd', { className: 'col-sm-9', text: value }));
      };
      addKv('Trạng thái', detail.status_display || detail.status);
      addKv('Số đoạn đã nạp', String(chunks.count || 0));
      addKv('Tệp', detail.file || '—');
      addKv('Người tải lên', detail.user || '—');
      addKv('Tạo lúc', window.ui.formatDateTime(detail.created_at));
      addKv('Cập nhật', window.ui.formatDateTime(detail.updated_at));
      if (detail.summary) addKv('Mô tả', detail.summary);
      if (detail.error) addKv('Lỗi', detail.error);
      dom.modalDocBody.appendChild(dl);

      if (detail.file) {
        dom.modalDocBody.appendChild(
          el('a', {
            className: 'btn btn-sm btn-outline-secondary',
            attrs: {
              href: fileUrl(detail.file),
              target: '_blank',
              rel: 'noopener noreferrer',
            },
          }, [window.ui.icon('file-earmark-arrow-down', 'me-1'), el('span', { text: 'Mở tệp gốc' })])
        );
      }

      dom.modalDocBody.appendChild(
        el('hr', { className: 'my-3' })
      );
      dom.modalDocBody.appendChild(
        el('h3', { className: 'h6 mb-2', text: 'Các đoạn đã tách & vector hoá' })
      );

      const items = (chunks && chunks.results) || [];
      if (!items.length) {
        dom.modalDocBody.appendChild(
          el('p', { className: 'text-muted-2 small', text: 'Chưa có đoạn nào được nạp.' })
        );
        return;
      }

      items.forEach((chunk, index) => {
        const header = el('div', { className: 'd-flex align-items-center gap-2 mb-1' }, [
          el('span', { className: 'badge text-bg-light border fw-normal', text: '#' + (chunk.chunk_index ?? index) }),
          chunk.has_vector
            ? el('span', { className: 'badge text-bg-success', text: (chunk.vector_dim || '?') + ' chiều' })
            : el('span', { className: 'badge text-bg-danger', text: 'chưa có vector' }),
        ]);

        // Nội dung chunk đến từ file người dùng tải lên -> textContent, tuyệt đối an toàn.
        const box = el('div', { className: 'chunk-box', text: chunk.chunk_content || '' });

        dom.modalDocBody.appendChild(
          el('div', { className: 'mb-3' }, [header, box])
        );
      });
    } catch (err) {
      clear(dom.modalDocBody);
      dom.modalDocBody.appendChild(
        el('div', { className: 'text-danger small', text: err.message })
      );
    }
  }

  // -------------------------------------------------------------------- sửa
  function openEditModal(doc) {
    state.editingId = doc.id;
    dom.editTitle.value = doc.title || '';
    dom.editSummary.value = doc.summary || '';
    window.bootstrap.Modal.getOrCreateInstance(dom.modalEdit).show();
  }

  async function handleEdit(event) {
    event.preventDefault();
    if (!state.editingId) return;
    const title = dom.editTitle.value.trim();
    if (!title) {
      window.ui.toast('Tiêu đề không được để trống.', 'warning');
      return;
    }
    try {
      await window.api.request('/rag/raw-data/' + encodeURIComponent(state.editingId) + '/', {
        method: 'PATCH',
        body: { title: title, summary: dom.editSummary.value.trim() },
      });
      window.bootstrap.Modal.getInstance(dom.modalEdit).hide();
      window.ui.toast('Đã cập nhật tài liệu.', 'success');
      await loadDocs();
    } catch (err) {
      window.ui.toast(err.message, 'danger');
    }
  }

  async function confirmDeleteDoc(doc) {
    if (
      !window.confirm(
        'Xoá vĩnh viễn tài liệu "' + (doc.title || doc.id) + '"?\n' +
          'Toàn bộ các đoạn (chunk) đã nạp cũng sẽ bị xoá và chatbot sẽ không còn trích dẫn được tài liệu này.'
      )
    ) {
      return;
    }
    try {
      await window.api.request('/rag/raw-data/' + encodeURIComponent(doc.id) + '/', {
        method: 'DELETE',
      });
      window.ui.toast('Đã xoá tài liệu.', 'success');
      await loadDocs();
    } catch (err) {
      window.ui.toast(err.message, 'danger');
    }
  }

  // ----------------------------------------------------------------- sidebar
  function openSidebar() {
    dom.sidebar.classList.add('is-open');
    if (!document.querySelector('.sidebar-backdrop')) {
      const back = el('div', { className: 'sidebar-backdrop d-lg-none' });
      back.addEventListener('click', closeSidebar);
      document.body.appendChild(back);
    }
  }
  function closeSidebar() {
    dom.sidebar.classList.remove('is-open');
    const back = document.querySelector('.sidebar-backdrop');
    if (back) back.remove();
  }

  // -------------------------------------------------------------------- init
  function bindEvents() {
    // Chọn / kéo thả tệp
    dom.dropzone.addEventListener('click', () => dom.fileInput.click());
    dom.dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        dom.fileInput.click();
      }
    });

    dom.fileInput.addEventListener('change', () => showSelectedFile(dom.fileInput.files[0] || null));

    ['dragenter', 'dragover'].forEach((type) => {
      dom.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dom.dropzone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach((type) => {
      dom.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dom.dropzone.classList.remove('is-over');
      });
    });
    dom.dropzone.addEventListener('drop', (event) => {
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      const file = files[0];
      // Nạp lại vào input để form gửi đúng tệp vừa thả.
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        dom.fileInput.files = dt.files;
      } catch (_) {
        /* trình duyệt cũ không cho gán Files -> vẫn xử lý bằng state */
      }
      showSelectedFile(file);
    });

    dom.formUpload.addEventListener('submit', handleUpload);
    dom.btnCancel.addEventListener('click', () => {
      if (state.abortController) state.abortController.abort('cancelled');
    });

    dom.filterStatus.addEventListener('change', () => {
      state.status = dom.filterStatus.value;
      state.page = 1;
      loadDocs();
    });

    dom.btnRefresh.addEventListener('click', () => {
      loadDocs();
      window.ui.toast('Đã làm mới danh sách.', 'info');
    });
    dom.btnPrev.addEventListener('click', () => {
      if (state.page > 1) {
        state.page -= 1;
        loadDocs();
      }
    });
    dom.btnNext.addEventListener('click', () => {
      state.page += 1;
      loadDocs();
    });

    dom.formEdit.addEventListener('submit', handleEdit);
    dom.openSidebar.addEventListener('click', openSidebar);
    dom.closeSidebar.addEventListener('click', closeSidebar);
    dom.logout.addEventListener('click', () => window.authGuard.logout());

    // Tự làm mới danh sách khi tab được nhìn thấy lại (nạp nền có thể xong).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.page) loadDocs();
    });
  }

  async function init() {
    dom.dropzoneHint.textContent =
      CFG.ALLOWED_EXTENSIONS.join(' · ') + ' — tối đa ' + formatBytes(CFG.MAX_UPLOAD_BYTES);
    bindEvents();
    showSelectedFile(null);

    try {
      const user = await window.authGuard.ensureSession();
      if (!user) return;

      const email = user.email || '';
      const name = ((user.first_name || '') + ' ' + (user.last_name || '')).trim();
      dom.userLabel.textContent = name || email;
      dom.menuEmail.textContent = email;
      const role = window.store.getRole();
      dom.menuLevel.textContent =
        { 0: 'Worker', 500: 'Senior Engineer', 900: 'Admin', 1000: 'Staff' }[role] || '—';

      state.canManage = window.store.isRagManager();
      if (!state.canManage) renderNoPermission();

      await loadDocs();
    } catch (err) {
      window.ui.toast(
        err.isNetwork ? 'Không kết nối được máy chủ API.' : err.message,
        'danger'
      );
    }
  }

  init();
})();
