(function () {
  const API = location.hostname === "127.0.0.1" && ["4173", "8302"].includes(location.port) ? "http://127.0.0.1:8301/api" : "/api";
  try {
    localStorage.removeItem("jiangsu-user");
  } catch (_) {}
  const standaloneRoutes = ["/login"];
  const navItems = [
    { path: "/", label: "首页", icon: "home" },
    { path: "/materials", label: "物资管理", icon: "box" },
    { path: "/inbound", label: "入库管理", icon: "log-in" },
    { path: "/outbound", label: "出库管理", icon: "log-out" },
    { path: "/inventory", label: "库存统计", icon: "chart" },
    { path: "/inbound-records", label: "入库记录", icon: "clipboard" },
    { path: "/outbound-records", label: "出库记录", icon: "clipboard" },
    { path: "/sales-records", label: "销售记录", icon: "cart" },
    { path: "/permissions", label: "权限管理", icon: "users" }
  ];

  const state = {
    route: normalizePath(location.pathname),
    loading: true,
    data: {},
    modal: null,
    toast: "",
    error: "",
    sidebarOpen: false,
    user: { name: "游客", role: "游客" },
    query: {},
    pages: {},
    notifications: null,
    importPreview: null
  };
  let pendingImportBuffer = null;

  const yuan = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" });
  const PAGE_SIZE = 25;
  const permissionCatalog = [
    "物资管理-查看", "物资管理-编辑", "入库管理-创建", "入库记录-查看",
    "出库管理-申请", "出库管理-审核", "出库管理-物资信息", "出库管理-销售员",
    "出库管理-提成", "出库记录-查看", "库存统计-查看",
    "库存统计-单价", "库存统计-总价值", "库存统计-成本", "库存统计-成本合计",
    "销售记录-查看", "销售记录-购买方", "销售记录-销售金额", "销售记录-成本",
    "销售记录-提成", "销售记录-利润", "权限管理-配置"
  ];
  const routePermissions = {
    "/materials": "物资管理-查看",
    "/inbound": "入库管理-创建",
    "/outbound": ["出库管理-申请", "出库管理-审核"],
    "/inventory": "库存统计-查看",
    "/inbound-records": "入库记录-查看",
    "/outbound-records": "出库记录-查看",
    "/sales-records": "销售记录-查看",
    "/permissions": "权限管理-配置"
  };
  if (!isAuthenticated() && state.route !== "/login") {
    state.route = "/login";
    history.replaceState({}, "", "/login");
  }

  function isAuthenticated() {
    return state.user && state.user.role && state.user.role !== "游客";
  }

  function hasPermission(permission) {
    if (!permission) return true;
    if (state.user && state.user.role === "管理员") return true;
    return String((state.user && state.user.permissions) || "").split("、").includes(permission);
  }

  function hasAnyPermission(permissions) {
    return Array.isArray(permissions) ? permissions.some((permission) => hasPermission(permission)) : hasPermission(permissions);
  }

  function canAccessRoute(path) {
    if (path === "/login") return true;
    return hasAnyPermission(routePermissions[path]);
  }

  function accessibleNavItems() {
    return navItems.filter((item) => canAccessRoute(item.path));
  }

  function firstAccessibleRoute() {
    const first = accessibleNavItems()[0];
    return first ? first.path : "/";
  }

  function visibleColumns(columns) {
    return columns.filter((column) => hasPermission(column.permission));
  }

  function normalizePath(path) {
    const clean = path.replace(/\/+$/, "") || "/";
    return navItems.some((item) => item.path === clean) || standaloneRoutes.includes(clean) ? clean : "/";
  }

  function icon(name) {
    const paths = {
      home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h5v-5h4v5h5v-9.5"/>',
      box: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
      "log-in": '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
      "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
      chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V7"/><path d="M16 16v-8"/>',
      clipboard: '<path d="M9 4h6l1 2h3v15H5V6h3l1-2Z"/><path d="M9 10h6"/><path d="M9 14h6"/><path d="M9 18h4"/>',
      cart: '<path d="M4 5h2l2.2 10.5h9.8L21 8H8"/><circle cx="10" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-8 0v2"/><circle cx="12" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
      plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
      download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
      upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
      file: '<path d="M14 3H6v18h12V7l-4-4Z"/><path d="M14 3v4h4"/>',
      close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
      alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
      trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/>',
      edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
      check: '<path d="m20 6-11 11-5-5"/>',
      x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
    };
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function normalizeError(error) {
    if (error && error.message === "Failed to fetch") return "网络连接异常，请点重新加载";
    return error && error.message ? error.message : "请求失败，请稍后重试";
  }

  async function api(path, options = {}) {
    const url = `${API}${path}`;
    const request = {
      headers: { "Content-Type": "application/json" },
      ...options
    };
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, request);
        const body = await response.json();
        if (!body.ok) throw new Error(body.message || "请求失败");
        return body.data;
      } catch (error) {
        lastError = error;
        if (attempt === 0 && (!error.message || error.message === "Failed to fetch")) {
          await sleep(400);
          continue;
        }
        break;
      }
    }
    throw new Error(normalizeError(lastError));
  }

  function params(obj) {
    const p = new URLSearchParams();
    Object.entries(obj || {}).forEach(([key, value]) => {
      if (value) p.set(key, value);
    });
    const text = p.toString();
    return text ? `?${text}` : "";
  }

  async function loadData() {
    if (!isAuthenticated() && state.route !== "/login") {
      state.route = "/login";
      history.replaceState({}, "", "/login");
    }
    if (isAuthenticated() && state.route !== "/login" && !canAccessRoute(state.route)) {
      state.route = firstAccessibleRoute();
      history.replaceState({}, "", state.route);
    }
    state.loading = true;
    state.error = "";
    render();
    try {
      if (state.route === "/login") state.data = {};
      if (state.route === "/") {
        state.data = await api("/dashboard");
        state.notifications = state.data.notifications || null;
      }
      if (state.route === "/materials") state.data = { materials: await api(`/materials${params(state.query.materials)}`) };
      if (state.route === "/inbound") state.data = { materials: await api("/materials") };
      if (state.route === "/outbound") state.data = { materials: await api("/materials"), requests: await api("/outbound-requests") };
      if (state.route === "/inventory") state.data = { materials: await api(`/materials${params(state.query.inventory)}`) };
      if (state.route === "/inbound-records") state.data = { rows: await api(`/inbound-records${params(state.query.inboundRecords)}`), materials: await api("/materials") };
      if (state.route === "/outbound-records") state.data = { rows: await api(`/outbound-records${params(state.query.outboundRecords)}`), materials: await api("/materials") };
      if (state.route === "/sales-records") state.data = { ...(await api(`/sales-records${params(state.query.sales)}`)), materials: await api("/materials") };
      if (state.route === "/permissions") state.data = { users: await api("/users"), roles: await api("/role-permissions") };
    } catch (error) {
      state.error = error.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  function setRoute(path) {
    const target = normalizePath(path);
    state.route = !isAuthenticated() && target !== "/login" ? "/login" : canAccessRoute(target) ? target : firstAccessibleRoute();
    state.sidebarOpen = false;
    state.modal = null;
    history.pushState({}, "", state.route);
    loadData();
  }

  function setPage(key, page) {
    state.pages[key] = Math.max(1, Number(page) || 1);
    render();
  }

  function resetPage(key) {
    state.pages[key] = 1;
  }

  function toast(message) {
    state.toast = message;
    render();
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => {
      state.toast = "";
      render();
    }, 1800);
  }

  function pageShell(content) {
    const noticeCount = state.notifications ? notificationCount(state.notifications) : notificationCount(state.data.notifications);
    return `
      <div class="app-shell">
        ${state.sidebarOpen ? '<div class="sidebar-mask" data-action="close-sidebar"></div>' : ""}
        <aside class="sidebar ${state.sidebarOpen ? "open" : ""}">
          <div class="brand">江苏服装系统</div>
          <nav class="nav-list">
            ${accessibleNavItems().map((item) => `
              <a class="nav-item ${state.route === item.path ? "active" : ""}" href="${item.path}" data-route="${item.path}">
                ${icon(item.icon)}<span>${item.label}</span>
              </a>
            `).join("")}
          </nav>
          <div class="system-about">
            <strong>关于系统</strong>
            <span>系统名称：服装管理系统</span>
            <span>版本号：v1.0.0</span>
            <span>更新内容：待更新</span>
            <span>开发日期：2026年07月</span>
          </div>
        </aside>
        <div class="main-wrap">
          <header class="topbar">
            <button class="icon-button mobile-menu" title="菜单" data-action="open-sidebar">${icon("menu")}</button>
            <div class="topbar-title">
              <img class="topbar-logo" src="/assets/system-logo.jpg" alt="系统 logo" />
              <h2>欢迎回来，${escapeHtml(state.user.name || "游客")}</h2>
            </div>
            <div class="top-actions">
              <button class="icon-button notice-button" title="通知" data-action="show-notifications">${icon("bell")}${noticeCount ? `<span class="notice-dot">${noticeCount > 99 ? "99+" : noticeCount}</span>` : ""}</button>
              <button class="btn primary" data-route="/login">${icon("log-in")}${state.user.role === "游客" ? "登录" : state.user.role}</button>
            </div>
          </header>
          <main class="page">${content}</main>
        </div>
        ${state.modal ? modalMarkup(state.modal) : ""}
        ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
      </div>
    `;
  }

  function loadingOrError() {
    if (state.loading) return pageShell('<section class="panel"><div class="loading">数据加载中...</div></section>');
    if (state.error) return pageShell(`<section class="panel"><div class="error-text">${escapeHtml(state.error)}</div><button class="btn primary" data-action="reload">重新加载</button></section>`);
    return "";
  }

  function notificationCount(notifications) {
    if (!notifications) return 0;
    return Object.values(notifications).reduce((sum, item) => sum + Number(item.count || 0), 0);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function numberInput(name, placeholder, value = "") {
    return `<input class="input" name="${name}" type="number" min="0" step="0.01" placeholder="${placeholder}" value="${escapeHtml(value)}" />`;
  }

  function input(name, placeholder, value = "", type = "text") {
    return `<input class="input" name="${name}" type="${type}" placeholder="${placeholder}" value="${escapeHtml(value)}" />`;
  }

  function select(name, options, selected = "") {
    return `<select name="${name}">${options.map((option) => {
      const value = typeof option === "object" ? option.value : option;
      const text = typeof option === "object" ? option.text : option;
      return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(text)}</option>`;
    }).join("")}</select>`;
  }

  function field(label, control, required = false) {
    return `<div class="field"><label>${label}${required ? ' <span class="required">*</span>' : ""}</label>${control}</div>`;
  }

  function statCard(iconName, tone, value, unit, label) {
    return `
      <div class="stat-card">
        <div class="stat-icon ${tone}">${icon(iconName)}</div>
        <div><div class="stat-value">${value}<span>${unit}</span></div><div class="stat-label">${label}</div></div>
      </div>
    `;
  }

  function loginPage() {
    if (state.loading) return '<section class="login-page"><div class="login-card"><div class="loading">数据加载中...</div></div></section>';
    return `
      <section class="login-page">
        <form class="login-card" data-form="login">
          <div class="login-title"><h1>江苏服装系统</h1><div class="muted">请输入账号和密码登录</div></div>
          ${field("账号", input("account", "请输入账号"), true)}
          ${field("密码", input("password", "请输入密码", "", "password"), true)}
          <button class="btn primary full" type="submit">登录</button>
        </form>
      </section>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    `;
  }

  function homePage() {
    const fallback = loadingOrError();
    if (fallback) return fallback;
    const stats = state.data.stats;
    const recent = state.data.recent || [];
    const warnings = state.data.warnings || [];
    return pageShell(`
      <div class="stats-grid">
        ${statCard("log-in", "green", stats.today_inbound, "件", "今日入库")}
        ${statCard("log-out", "blue", stats.today_outbound, "件", "今日出库")}
        ${statCard("box", "navy", stats.current_stock, "件", "当前库存")}
        ${statCard("alert", "amber", stats.low_stock, "种", "低库存预警")}
      </div>
      <div class="home-grid">
        <section class="panel">
          <div class="panel-header"><h3 class="panel-title">最近操作记录</h3></div>
          <div class="record-list">
            ${recent.map((row) => `
              <div class="record-row">
                <span class="badge ${row.type === "入库" ? "green" : "blue"}">${row.type}</span>
                <strong>${escapeHtml(row.material_name)}</strong>
                <div class="amount">${row.type === "入库" ? "+" : "-"}${row.quantity}件<br><span class="muted">${escapeHtml(row.created_at)}</span></div>
              </div>
            `).join("") || '<div class="empty-row">暂无操作记录</div>'}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header"><h3 class="panel-title">低库存预警</h3></div>
          <div class="warning-list">
            ${warnings.map((row) => `<div class="warning-item"><span>${escapeHtml(row.name)}</span><span>库存：${row.stock}件</span></div>`).join("") || '<div class="empty-row">暂无低库存预警</div>'}
          </div>
        </section>
      </div>
      <section class="panel quick-panel">
        <div class="panel-header"><h3 class="panel-title">快捷操作</h3></div>
        <div class="quick-grid">
          ${canAccessRoute("/inbound") ? `<a class="quick-link primary" href="/inbound" data-route="/inbound">${icon("log-in")}快速入库</a>` : ""}
          ${canAccessRoute("/outbound") ? `<a class="quick-link secondary" href="/outbound" data-route="/outbound">${icon("log-out")}快速出库</a>` : ""}
          ${canAccessRoute("/inventory") ? `<a class="quick-link success" href="/inventory" data-route="/inventory">${icon("box")}查看库存</a>` : ""}
        </div>
      </section>
    `);
  }

  function table(headers, rows, options = {}) {
    const pageSize = options.pageSize || PAGE_SIZE;
    const totalRows = rows.length;
    const totalPages = options.pageKey ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1;
    const currentPage = options.pageKey ? Math.min(Math.max(1, state.pages[options.pageKey] || 1), totalPages) : 1;
    const visibleRows = options.pageKey ? rows.slice((currentPage - 1) * pageSize, currentPage * pageSize) : rows;
    const bodyRows = visibleRows.map((row) => {
      const cells = Array.isArray(row) ? row : row.cells;
      const className = Array.isArray(row) ? "" : ` class="${escapeHtml(row.className || "")}"`;
      return `<tr${className}>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
    }).join("");
    const pageButtons = options.pageKey ? Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
      `<button type="button" class="${page === currentPage ? "active" : ""}" data-action="page" data-page-key="${options.pageKey}" data-page="${page}" onclick="window.JFS.goPage(event, '${options.pageKey}', ${page})" ${page === currentPage ? "disabled" : ""}>${page}</button>`
    )).join("") : '<button class="active" disabled>1</button>';
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${visibleRows.length ? bodyRows : `<tr><td class="empty-row" colspan="${headers.length}">暂无数据</td></tr>`}</tbody>
          ${options.foot ? `<tfoot><tr>${options.foot.map((cell) => `<td>${cell}</td>`).join("")}</tr></tfoot>` : ""}
        </table>
      </div>
      <div class="pagination">
        <span class="muted">共 ${options.count ?? totalRows} 条记录${options.pageKey ? `，每页 ${pageSize} 条，第 ${currentPage}/${totalPages} 页` : ""}</span>
        <div class="pager-buttons">
          <button type="button" data-action="page" data-page-key="${options.pageKey || ""}" data-page="${currentPage - 1}" onclick="window.JFS.goPage(event, '${options.pageKey || ""}', ${currentPage - 1})" ${!options.pageKey || currentPage <= 1 ? "disabled" : ""}>上一页</button>
          ${pageButtons}
          <button type="button" data-action="page" data-page-key="${options.pageKey || ""}" data-page="${currentPage + 1}" onclick="window.JFS.goPage(event, '${options.pageKey || ""}', ${currentPage + 1})" ${!options.pageKey || currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </div>
    `;
  }

  function materialRows(materials, withActions = false) {
    return materials.map((row) => {
      const cells = [
      `<span class="table-name">${escapeHtml(row.name)}</span>`,
      escapeHtml(row.spec),
      escapeHtml(row.size),
      escapeHtml(row.color),
      row.threshold,
      `<span class="badge ${row.status === "充足" ? "green" : "red"}">${row.status}</span>`,
      row.price_text,
      row.cost_text
      ];
      if (withActions) {
        cells.push(`<div class="row-actions"><button class="icon-button" title="编辑" data-action="edit-material" data-id="${row.id}">${icon("edit")}</button><button class="icon-button danger-icon" title="删除" data-action="delete-material" data-id="${row.id}">${icon("trash")}</button></div>`);
      }
      return cells;
    });
  }

  function materialNameOptions(selected = "") {
    const names = Array.from(new Set((state.data.materials || []).map((m) => m.name))).sort();
    return [{ value: "", text: "全部品类" }].concat(names.map((name) => ({ value: name, text: name }))).map((option) => {
      const value = typeof option === "object" ? option.value : option;
      const text = typeof option === "object" ? option.text : option;
      return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(text)}</option>`;
    }).join("");
  }

  function materialsPage() {
    const fallback = loadingOrError();
    if (fallback) return fallback;
    const q = state.query.materials || {};
    const canEdit = hasPermission("物资管理-编辑");
    const headers = ["品名", "规格", "尺寸", "颜色", "预警阈值", "库存预警", "单价 (元)", "成本 (元)"];
    if (canEdit) headers.push("操作");
    return pageShell(`
      <section class="panel">
        <form class="toolbar" data-form="materials-filter">
          ${input("search", "搜索物资名称...", q.search || "")}
          ${canEdit ? `<button class="btn primary" type="button" data-modal="material">${icon("plus")}新增物资</button>` : ""}
        </form>
        ${table(headers, materialRows(state.data.materials, canEdit), { count: state.data.materials.length })}
      </section>
    `);
  }

  function materialOptions() {
    return [{ value: "", text: "请选择品名" }].concat((state.data.materials || []).map((m) => ({ value: m.id, text: `${m.name} / ${m.spec} / ${m.size} / ${m.color} / 库存${m.stock}` })));
  }

  function materialValueOptions(field, selected = "", rows = state.data.materials || []) {
    const values = Array.from(new Set(rows.map((m) => m[field]).filter(Boolean))).sort();
    return `<option value="">请选择</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
  }

  function materialFilterOptions(field, allText, selected = "", rows = state.data.materials || []) {
    const values = Array.from(new Set(rows.map((m) => m[field]).filter(Boolean))).sort();
    return `<option value="">${escapeHtml(allText)}</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
  }

  function filterOptionRows(query = {}, field = "") {
    let rows = state.data.materials || [];
    if (query.category) rows = rows.filter((m) => m.name === query.category);
    if (["size", "color"].includes(field) && query.spec) rows = rows.filter((m) => m.spec === query.spec);
    if (field === "color" && query.size) rows = rows.filter((m) => m.size === query.size);
    return rows;
  }

  function scopedMaterialFilterOptions(query, field, allText) {
    return materialFilterOptions(field, allText, query[field] || "", filterOptionRows(query, field));
  }

  function normalizeMaterialQuery(query = {}) {
    const clean = { ...query };
    ["spec", "size", "color"].forEach((field) => {
      if (!clean[field]) return;
      const values = new Set(filterOptionRows(clean, field).map((m) => m[field]).filter(Boolean));
      if (!values.has(clean[field])) delete clean[field];
    });
    return clean;
  }

  function queryKeyFromFilterForm(type) {
    return {
      "inventory-filter": "inventory",
      "inboundRecords-filter": "inboundRecords",
      "outboundRecords-filter": "outboundRecords",
      "sales-filter": "sales"
    }[type];
  }

  function salespersonOptions(selected = "") {
    const names = Array.from(new Set(state.data.salespeople || [])).filter(Boolean).sort();
    return `<option value="">全部销售员</option>${names.map((name) => `<option value="${escapeHtml(name)}" ${String(name) === String(selected) ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
  }

  function salesYearOptions(selected = "") {
    const currentYear = String(new Date().getFullYear());
    const years = Array.from(new Set([currentYear].concat(state.data.years || []))).filter(Boolean).sort().reverse();
    return `<option value="">全部年份</option>${years.map((year) => `<option value="${escapeHtml(year)}" ${String(year) === String(selected) ? "selected" : ""}>${escapeHtml(year)}年</option>`).join("")}`;
  }

  function salesMonthOptions(selected = "") {
    return `<option value="">全部月份</option>${Array.from({ length: 12 }, (_, index) => {
      const value = String(index + 1).padStart(2, "0");
      return `<option value="${value}" ${String(value) === String(selected) ? "selected" : ""}>${index + 1}月</option>`;
    }).join("")}`;
  }

  function materialPickerFields(selected = {}) {
    return `
      <select name="material_name" data-material-field="name">${materialValueOptions("name", selected.name || "")}</select>
      <select name="spec" data-material-field="spec">${materialValueOptions("spec", selected.spec || "")}</select>
      <select name="size" data-material-field="size">${materialValueOptions("size", selected.size || "")}</select>
      <select name="color" data-material-field="color">${materialValueOptions("color", selected.color || "")}</select>
      <input type="hidden" name="material_id" value="${escapeHtml(selected.material_id || "")}" />
    `;
  }

  function inboundItemRow(index) {
    return `
      <div class="material-item-row inbound-item-row" data-inbound-row>
        <div class="item-index">${index + 1}</div>
        ${materialPickerFields()}
        ${numberInput("quantity", "入库数量")}
        <div class="item-meta" data-material-meta>请选择品名、规格、尺寸、颜色</div>
        <button class="icon-button danger-icon" type="button" title="移除" data-action="remove-inbound-item">${icon("trash")}</button>
      </div>
    `;
  }

  function outboundItemRow(index) {
    return `
      <div class="material-item-row outbound-item-row" data-outbound-row>
        <div class="item-index">${index + 1}</div>
        ${materialPickerFields()}
        ${numberInput("quantity", "出货数量")}
        ${numberInput("sale_amount", "销售金额")}
        <div class="item-meta" data-material-meta>请选择品名、规格、尺寸、颜色</div>
        <button class="icon-button danger-icon" type="button" title="移除" data-action="remove-outbound-item">${icon("trash")}</button>
      </div>
    `;
  }

  function inboundPage() {
    const fallback = loadingOrError();
    if (fallback) return fallback;
    return pageShell(`
      <section class="form-panel">
        <div class="form-actions">
          <h3 class="panel-title">入库登记</h3>
          <div class="top-actions">
            <button class="btn outline" data-action="download-template" type="button">${icon("download")}下载模板</button>
            <button class="btn success" data-action="import-excel" type="button">${icon("upload")}Excel 导入</button>
          </div>
        </div>
        <form class="form-grid" data-form="inbound">
          <div class="full outbound-items">
            <div class="outbound-head">
              <label>入库物资 <span class="required">*</span></label>
              <button class="btn outline compact" type="button" data-action="add-inbound-item">${icon("plus")}添加物资</button>
            </div>
            <div class="material-item-labels inbound-labels"><span>#</span><span>品名</span><span>规格</span><span>尺寸</span><span>颜色</span><span>数量</span><span>物资信息</span><span></span></div>
            <div data-inbound-items>${inboundItemRow(0)}</div>
          </div>
          ${field("操作人", input("operator", "操作人", state.user.name || "游客"), true)}
          ${field("备注（可选）", `<textarea name="remark" placeholder="请输入备注信息..."></textarea>`, false)}
          <button class="btn primary full" type="submit">确认入库</button>
        </form>
      </section>
    `);
  }

  function outboundPage() {
    const fallback = loadingOrError();
    if (fallback) return fallback;
    const canApply = hasPermission("出库管理-申请");
    const canReview = hasPermission("出库管理-审核");
    const canSetSalesperson = hasPermission("出库管理-销售员");
    const canSetCommission = hasPermission("出库管理-提成");
    return pageShell(`
      ${canApply ? `<section class="form-panel">
        <div class="form-actions">
          <h3 class="panel-title">出库申请</h3>
          ${canReview ? `<button class="btn secondary" data-modal="applications" type="button">${icon("file")}查看申请列表</button>` : ""}
        </div>
        <form class="form-grid" data-form="outbound">
          <div class="full outbound-items">
            <div class="outbound-head">
              <label>出库物资 <span class="required">*</span></label>
              <button class="btn outline compact" type="button" data-action="add-outbound-item">${icon("plus")}添加物资</button>
            </div>
            <div class="material-item-labels outbound-labels"><span>#</span><span>品名</span><span>规格</span><span>尺寸</span><span>颜色</span><span>出货数量</span><span>销售金额</span><span>物资信息</span><span></span></div>
            <div data-outbound-items>${outboundItemRow(0)}</div>
          </div>
          ${field("总金额 (元)", `<input class="input" name="total_amount" type="number" min="0" step="0.01" value="0" readonly data-outbound-total />`, true)}
          ${field("申请人", input("applicant", "申请人", state.user.name || "游客"), true)}
          ${canSetSalesperson ? field("销售员", input("salesperson", "默认当前登录人", state.user.name || ""), false) : `<input type="hidden" name="salesperson" value="${escapeHtml(state.user.name || "")}" />`}
          ${canSetCommission ? field("提成 (元)", numberInput("commission", "可不填，默认 0"), false) : '<input type="hidden" name="commission" value="0" />'}
          ${field("购买方", input("buyer", "请输入购买方名称"), true)}
          ${canSetCommission ? `<div class="full calc-strip">
            <span>预计利润</span>
            <strong data-profit-preview>${yuan.format(0)}</strong>
          </div>` : ""}
          ${field("备注（可选）", input("remark", "请输入备注信息"), false)}
          <button class="btn danger full" type="submit">提交出库申请</button>
        </form>
      </section>` : ""}
      ${!canApply && canReview ? `<section class="panel">
        <div class="panel-header"><h3 class="panel-title">出库审核</h3><button class="btn secondary" data-modal="applications" type="button">${icon("file")}查看申请列表</button></div>
      </section>` : ""}
    `);
  }

  function inventoryColumns() {
    return visibleColumns([
      { key: "name", header: "品名", cell: (row) => `<span class="table-name">${escapeHtml(row.name)}</span>`, export: (row) => row.name },
      { key: "spec", header: "规格", cell: (row) => escapeHtml(row.spec), export: (row) => row.spec },
      { key: "size", header: "尺寸", cell: (row) => escapeHtml(row.size), export: (row) => row.size },
      { key: "color", header: "颜色", cell: (row) => escapeHtml(row.color), export: (row) => row.color },
      { key: "stock", header: "当前库存", cell: (row) => row.stock < row.threshold ? `<span class="stock-warning">${row.stock} <small>(预警)</small></span>` : row.stock, export: (row) => row.stock },
      { key: "price", header: "单价 (元)", permission: "库存统计-单价", cell: (row) => row.price_text, export: (row) => row.price },
      { key: "totalValue", header: "总价值 (元)", permission: "库存统计-总价值", cell: (row) => `<span class="money-cell sale">${row.total_value_text}</span>`, export: (row) => row.total_value },
      { key: "cost", header: "成本 (元)", permission: "库存统计-成本", cell: (row) => `<span class="money-cell cost">${row.cost_text}</span>`, export: (row) => row.cost },
      { key: "totalCost", header: "成本合计 (元)", permission: "库存统计-成本合计", cell: (row) => `<span class="money-cell commission">${row.total_cost_text || yuan.format((row.stock || 0) * (row.cost || 0))}</span>`, export: (row) => row.total_cost ?? row.stock * row.cost }
    ]);
  }

  function inventoryPage() {
    const fallback = loadingOrError();
    if (fallback) return fallback;
    const q = state.query.inventory || {};
    const columns = inventoryColumns();
    const rows = state.data.materials.map((row) => ({
      className: row.stock < row.threshold ? "warning-row" : "",
      cells: columns.map((column) => column.cell(row))
    }));
    const totalStock = state.data.materials.reduce((sum, row) => sum + row.stock, 0);
    const totalValue = state.data.materials.reduce((sum, row) => sum + row.total_value, 0);
    const totalCost = state.data.materials.reduce((sum, row) => sum + (row.total_cost ?? row.stock * row.cost), 0);
    const foot = columns.map((column, index) => {
      if (index === 0) return "合计";
      if (column.key === "stock") return `${totalStock}件`;
      if (column.key === "totalValue") return `<span class="money-cell sale">${yuan.format(totalValue)}</span>`;
      if (column.key === "totalCost") return `<span class="money-cell commission">${yuan.format(totalCost)}</span>`;
      return "";
    });
    return pageShell(`
      <section class="panel">
        <form class="toolbar" data-form="inventory-filter">
          ${input("search", "搜索物资名称...", q.search || "")}
          <button class="btn primary" type="button" data-action="export-inventory">${icon("download")}导出 Excel</button>
        </form>
        <form class="filters" data-form="inventory-filter" data-live-filter>
          <select name="category">${materialNameOptions(q.category || "")}</select>
          <select name="spec">${scopedMaterialFilterOptions(q, "spec", "全部规格")}</select>
          <select name="size">${scopedMaterialFilterOptions(q, "size", "全部尺寸")}</select>
          <select name="color">${scopedMaterialFilterOptions(q, "color", "全部颜色")}</select>
          <button class="btn primary" type="submit">查询</button>
          <button class="btn outline-blue" type="button" data-action="reset-inventory">重置筛选</button>
        </form>
        ${table(columns.map((column) => column.header), rows, {
          count: rows.length,
          pageKey: "inventory",
          foot
        })}
      </section>
    `);
  }

  function recordsPage(type) {
    const fallback = loadingOrError();
    if (fallback) return fallback;
    const inbound = type === "inbound";
    const queryKey = inbound ? "inboundRecords" : "outboundRecords";
    const q = state.query[queryKey] || {};
    const rows = state.data.rows.map((row) => {
      const common = [escapeHtml(row.created_at), `<span class="table-name">${escapeHtml(row.material_name)}</span>`, escapeHtml(row.spec), escapeHtml(row.size), escapeHtml(row.color), `${inbound ? "+" : "-"}${row.quantity}件`, escapeHtml(row.operator)];
      return inbound ? common.concat(escapeHtml(row.remark || "-")) : common.concat(escapeHtml(row.buyer || "-"), `<span class="badge ${row.status === "已通过" ? "green" : row.status === "待审核" ? "amber" : "red"}">${row.status}</span>`, escapeHtml(row.remark || "-"));
    });
    return pageShell(`
      <section class="panel">
        <form class="filters wide" data-form="${queryKey}-filter" data-live-filter>
          ${input("search", "搜索物资名称...", q.search || "")}
          <select name="category">${materialNameOptions(q.category || "")}</select>
          <select name="spec">${scopedMaterialFilterOptions(q, "spec", "全部规格")}</select>
          <select name="size">${scopedMaterialFilterOptions(q, "size", "全部尺寸")}</select>
          <select name="color">${scopedMaterialFilterOptions(q, "color", "全部颜色")}</select>
          ${input("start", "开始日期", q.start || "", "date")}
          ${input("end", "结束日期", q.end || "", "date")}
          ${inbound ? "" : select("status", ["全部状态", "待审核", "已通过", "已驳回"], q.status || "")}
          <button class="btn primary" type="submit">查询</button>
          <button class="btn outline-blue" type="button" data-action="reset-records" data-key="${queryKey}">重置筛选</button>
        </form>
        ${table(inbound ? ["日期", "品名", "规格", "尺寸", "颜色", "数量", "操作人", "备注"] : ["日期", "品名", "规格", "尺寸", "颜色", "数量", "操作人", "购买方", "状态", "备注"], rows, { count: rows.length, pageKey: queryKey })}
      </section>
    `);
  }

  function salesPage() {
    const fallback = loadingOrError();
    if (fallback) return fallback;
    const summary = state.data.summary;
    const q = state.query.sales || {};
    const selectedYear = q.year || String(q.month || "").slice(0, 4);
    const selectedMonth = q.month_num || String(q.month || "").slice(5, 7);
    const columns = salesColumns();
    const rows = state.data.rows.map((row) => columns.map((column) => column.cell(row)));
    const foot = columns.map((column, index) => {
      if (index === 0) return "合计";
      if (column.key === "quantity") return `${summary.quantity}件`;
      if (column.key === "saleAmount") return `<span class="money-cell sale">${yuan.format(summary.sale_amount)}</span>`;
      if (column.key === "costAmount") return `<span class="money-cell cost">${yuan.format(summary.cost_amount)}</span>`;
      if (column.key === "commission") return `<span class="money-cell commission">${yuan.format(summary.commission)}</span>`;
      if (column.key === "profit") return `<span class="money-cell ${summary.profit >= 0 ? "profit" : "loss"}">${yuan.format(summary.profit)}</span>`;
      return "";
    });
    const summaryCards = [
      { permission: "销售记录-销售金额", className: "sale", label: "销售总额", value: yuan.format(summary.sale_amount) },
      { permission: "销售记录-成本", className: "cost", label: "总成本", value: yuan.format(summary.cost_amount) },
      { permission: "销售记录-提成", className: "commission", label: "总提成", value: yuan.format(summary.commission) },
      { permission: "销售记录-利润", className: summary.profit >= 0 ? "profit" : "loss", label: "总利润", value: yuan.format(summary.profit) }
    ].filter((card) => hasPermission(card.permission));
    return pageShell(`
      ${summaryCards.length ? `<div class="summary-grid">${summaryCards.map((card) => `<div class="summary-card ${card.className}"><span>${card.label}</span><b>${card.value}</b></div>`).join("")}</div>` : ""}
      <section class="panel">
        <form class="filters wide" data-form="sales-filter" data-live-filter>
          ${input("search", "搜索物资名称或购买方...", q.search || "")}
          <select name="year">${salesYearOptions(selectedYear)}</select>
          <select name="month_num">${salesMonthOptions(selectedMonth)}</select>
          <select name="category">${materialNameOptions(q.category || "")}</select>
          <select name="spec">${scopedMaterialFilterOptions(q, "spec", "全部规格")}</select>
          <select name="size">${scopedMaterialFilterOptions(q, "size", "全部尺寸")}</select>
          <select name="color">${scopedMaterialFilterOptions(q, "color", "全部颜色")}</select>
          <select name="salesperson">${salespersonOptions(q.salesperson || "")}</select>
          <button class="btn primary" type="submit">查询</button>
          <button class="btn success" type="button" data-action="export-sales">${icon("download")}导出 Excel</button>
          <button class="btn outline-blue" type="button" data-action="reset-sales">重置筛选</button>
        </form>
        ${table(columns.map((column) => column.header), rows, {
          count: rows.length,
          pageKey: "sales",
          foot
        })}
      </section>
    `);
  }

  function salesColumns() {
    return visibleColumns([
      { key: "date", header: "日期", cell: (row) => escapeHtml(row.sale_date), export: (row) => row.sale_date },
      { key: "buyer", header: "购买方", permission: "销售记录-购买方", cell: (row) => escapeHtml(row.buyer), export: (row) => row.buyer },
      { key: "name", header: "品名", cell: (row) => `<span class="table-name">${escapeHtml(row.material_name)}</span>`, export: (row) => row.material_name },
      { key: "spec", header: "规格/尺寸/颜色", cell: (row) => escapeHtml(row.spec_size_color), export: (row) => row.spec_size_color },
      { key: "quantity", header: "数量", cell: (row) => `${row.quantity}件`, export: (row) => row.quantity },
      { key: "saleAmount", header: "销售金额 (元)", permission: "销售记录-销售金额", cell: (row) => `<span class="money-cell sale">${yuan.format(row.sale_amount)}</span>`, export: (row) => row.sale_amount },
      { key: "costAmount", header: "成本 (元)", permission: "销售记录-成本", cell: (row) => `<span class="money-cell cost">${yuan.format(row.cost_amount)}</span>`, export: (row) => row.cost_amount },
      { key: "salesperson", header: "销售员", cell: (row) => escapeHtml(row.salesperson), export: (row) => row.salesperson },
      { key: "commission", header: "提成 (元)", permission: "销售记录-提成", cell: (row) => `<span class="money-cell commission">${yuan.format(row.commission)}</span>`, export: (row) => row.commission },
      { key: "profit", header: "利润 (元)", permission: "销售记录-利润", cell: (row) => `<span class="money-cell ${row.profit >= 0 ? "profit" : "loss"}">${yuan.format(row.profit)}</span>`, export: (row) => row.profit }
    ]);
  }

  function permissionsPage() {
    const fallback = loadingOrError();
    if (fallback) return fallback;
    const roles = state.data.roles || [];
    const rows = state.data.users.map((user) => [
      escapeHtml(user.username),
      `<span class="table-name">${escapeHtml(user.name)}</span>`,
      `<span class="badge blue">${escapeHtml(user.role)}</span>`,
      `<span class="permission-summary table-permission-summary">${escapeHtml(user.permissions)}</span>`,
      escapeHtml(user.last_login || "-"),
      `<div class="row-actions"><button class="icon-button" title="编辑" data-action="edit-user" data-id="${user.id}">${icon("edit")}</button>${user.username === "admin" ? "" : `<button class="icon-button danger-icon" title="删除" data-action="delete-user" data-id="${user.id}">${icon("trash")}</button>`}</div>`
    ]);
    return pageShell(`
      <div class="home-grid">
        <section class="panel">
          <div class="panel-header"><h3 class="panel-title">用户列表</h3><button class="btn primary" data-modal="user">${icon("plus")}添加用户</button></div>
          ${table(["用户名", "名称", "角色", "权限", "最后登录", "操作"], rows, { count: rows.length })}
        </section>
        <section class="panel">
          <div class="panel-header"><h3 class="panel-title">角色定义与权限配置</h3></div>
          <div class="role-list">
            ${roles.map(roleCard).join("")}
          </div>
        </section>
        <section class="panel danger-panel">
          <div class="panel-header"><h3 class="panel-title">数据库维护</h3></div>
          <div class="danger-note">清除数据库会删除物资、入库、出库、销售、申请记录，用户和权限配置会保留。</div>
          <form class="form-grid" data-form="secondary-password">
            ${field("当前二次密码", input("current_password", "请输入当前二次密码", "", "password"), true)}
            ${field("新二次密码", input("new_password", "至少 4 位", "", "password"), true)}
            ${field("确认新二次密码", input("confirm_password", "请再次输入新密码", "", "password"), true)}
            <button class="btn primary full" type="submit">修改二次密码</button>
          </form>
          <form class="form-grid danger-form" data-form="clear-database">
            ${field("二次密码", input("secondary_password", "请输入二次密码", "", "password"), true)}
            ${field("确认文字", input("confirm_text", "请输入：确认清空"), true)}
            <button class="btn danger full" type="submit">一键清除数据库</button>
          </form>
        </section>
      </div>
    `);
  }

  function roleCard(role) {
    const selected = new Set(role.items || []);
    return `
      <form class="role-card" data-form="role-permissions">
        <input type="hidden" name="role" value="${escapeHtml(role.role)}" />
        <div class="role-card-head">
          <div>
            <h3>${escapeHtml(role.role)}</h3>
            <p class="permission-summary">${escapeHtml(role.permissions || "-")}</p>
          </div>
          <button class="btn outline compact" type="submit">保存</button>
        </div>
        <div class="permission-grid">
          ${permissionCatalog.map((item) => `
            <label class="check-item">
              <input type="checkbox" name="permission" value="${escapeHtml(item)}" ${selected.has(item) ? "checked" : ""} />
              <span>${escapeHtml(item)}</span>
            </label>
          `).join("")}
        </div>
      </form>
    `;
  }

  function modalMarkup(type) {
    if (type === "notifications") {
      const notices = state.notifications || state.data.notifications || {};
      const items = [
        { key: "low_stock", tone: "amber", path: "/inventory" },
        { key: "inbound_success", tone: "green", path: "/inbound-records" },
        { key: "pending_outbound", tone: "blue", path: "/outbound" }
      ].map((config) => ({ ...config, ...(notices[config.key] || {}) }));
      return modal(`
        <div class="notice-list">
          ${items.map((item) => `
            <button class="notice-item ${item.tone}" type="button" data-route="${item.path}" onclick="window.JFS.goRoute(event, '${item.path}')">
              <span class="notice-count">${Number(item.count || 0)}</span>
              <span class="notice-copy">
                <strong>${escapeHtml(item.title || "")}</strong>
                <small>${escapeHtml(item.description || "")}</small>
              </span>
            </button>
          `).join("")}
        </div>
      `, "铃铛提醒");
    }
    if (type === "login") {
      return modal(`
        <div class="login-title"><h2>江苏服装系统</h2><div class="muted">欢迎回来，请登录您的账号</div></div>
        <form class="form-grid" data-form="login">
          ${field("账号", input("account", "请输入账号"), true)}
          ${field("密码", input("password", "请输入密码", "", "password"), true)}
          <button class="btn primary full" type="submit">登录</button>
        </form>
      `, "");
    }
    if (type === "material") {
      const editing = state.editMaterial;
      return modal(`
        <form class="form-grid" data-form="material">
          ${editing ? `<input type="hidden" name="id" value="${editing.id}" />` : ""}
          ${field("品名", input("name", "请输入品名", editing?.name || ""), true)}
          ${field("规格", input("spec", "请输入规格", editing?.spec || ""), true)}
          ${field("尺寸", input("size", "请输入尺寸", editing?.size || ""), true)}
          ${field("颜色", input("color", "请输入颜色", editing?.color || ""), true)}
          ${field("当前库存", numberInput("stock", "请输入库存数量", editing?.stock ?? ""), true)}
          ${field("预警阈值", numberInput("threshold", "库存低于此值时预警", editing?.threshold ?? 50), true)}
          ${field("单价 (元)", numberInput("price", "请输入单价", editing?.price ?? ""), true)}
          ${field("成本 (元)", numberInput("cost", "请输入成本", editing?.cost ?? ""), true)}
          <div class="modal-footer full"><button class="btn outline" type="button" data-action="close-modal" onclick="window.JFS.closeModal(event)">取消</button><button class="btn primary" type="submit">确定</button></div>
        </form>
      `, editing ? "编辑物资" : "新增物资");
    }
    if (type === "user") {
      const editing = state.editUser;
      return modal(`
        <form class="form-grid" data-form="user">
          ${editing ? `<input type="hidden" name="id" value="${editing.id}" />` : ""}
          ${field("名称", input("name", "请输入用户名称（如：张三）", editing?.name || ""), true)}
          ${field("用户名", input("username", "请输入用户名（用于登录）", editing?.username || ""), true)}
          ${field("密码", input("password", editing ? "不修改请留空" : "请输入密码", "", "password"), !editing)}
          ${field("角色", select("role", ["请选择角色", "管理员", "仓库管理员", "普通员工"], editing?.role || ""), true)}
          <div class="modal-footer full"><button class="btn outline" type="button" data-action="close-modal" onclick="window.JFS.closeModal(event)">取消</button><button class="btn primary" type="submit">确定</button></div>
        </form>
      `, editing ? "编辑用户" : "添加用户");
    }
    if (type === "applications") {
      if (!hasPermission("出库管理-审核")) {
        return modal('<div class="empty-row">没有出库审核权限</div>', "出库申请列表");
      }
      const requests = state.data.requests || [];
      const columns = visibleColumns([
        { header: "日期", cell: (row) => escapeHtml(row.created_at) },
        { header: "品名", cell: (row) => (row.items || []).length ? `<div class="mini-list">${row.items.map((item) => `<span>${escapeHtml(item.material_name)} x ${item.quantity}</span>`).join("")}</div>` : escapeHtml(row.material_name) },
        { header: "规格", cell: (row) => escapeHtml((row.items || []).map((item) => item.spec).join("、") || row.spec) },
        { header: "尺寸", cell: (row) => escapeHtml((row.items || []).map((item) => item.size).join("、") || row.size) },
        { header: "颜色", cell: (row) => escapeHtml((row.items || []).map((item) => item.color).join("、") || row.color) },
        { header: "数量", cell: (row) => `${row.quantity}件` },
        { header: "申请人", cell: (row) => escapeHtml(row.applicant) },
        { header: "销售员", permission: "出库管理-销售员", cell: (row) => escapeHtml(row.salesperson) },
        { header: "提成", permission: "出库管理-提成", cell: (row) => row.status === "待审核"
          ? `<input class="input table-number-input" type="number" min="0" step="0.01" value="${Number(row.commission || 0).toFixed(2)}" data-commission-for="${row.id}" />`
          : yuan.format(row.commission) },
        { header: "购买方", cell: (row) => escapeHtml(row.buyer) },
        { header: "总金额", cell: (row) => yuan.format(row.total_amount) },
        { header: "状态", cell: (row) => `<span class="badge ${row.status === "已通过" ? "green" : row.status === "待审核" ? "amber" : "red"}">${row.status}</span>` },
        { header: "操作/驳回理由", cell: (row) => row.status === "待审核" && hasPermission("出库管理-审核")
          ? `<div class="row-actions"><button type="button" class="btn success compact" data-action="review-request" data-review="approve" data-id="${row.id}" onclick="window.JFS.reviewRequest(event, ${row.id}, 'approve')">${icon("check")}通过</button><button type="button" class="btn danger compact" data-action="review-request" data-review="reject" data-id="${row.id}" onclick="window.JFS.reviewRequest(event, ${row.id}, 'reject')">${icon("x")}驳回</button></div>`
          : escapeHtml(row.reject_reason || "") }
      ]);
      const rows = requests.map((row) => columns.map((column) => column.cell(row)));
      return modal(table(columns.map((column) => column.header), rows, { count: rows.length, pageKey: "applications", pageSize: 10 }), "出库申请列表", "xlarge");
    }
    if (type === "importPreview") {
      const preview = state.importPreview || { rows: [], total: 0, created_materials: 0, existing_materials: 0, total_quantity: 0, fileName: "" };
      const rows = preview.rows.map((row) => [
        row.row,
        escapeHtml(row.name),
        escapeHtml(row.spec),
        escapeHtml(row.size),
        escapeHtml(row.color),
        `${row.quantity}件`,
        row.price ?? "-",
        row.cost ?? "-",
        row.threshold ?? "-",
        row.material_exists ? `<span class="badge green">已有物资</span>` : `<span class="badge amber">新增物资</span>`,
        `${row.current_stock} → ${row.after_stock}`,
        escapeHtml(row.action)
      ]);
      return modal(`
        <div class="preview-summary">
          <span>文件：${escapeHtml(preview.fileName || "-")}</span>
          <span>预览 ${preview.total} 条</span>
          <span>新增物资 ${preview.created_materials} 个</span>
          <span>已有物资 ${preview.existing_materials} 个</span>
          <span>合计入库 ${preview.total_quantity} 件</span>
        </div>
        ${table(["行号", "品名", "规格", "尺寸", "颜色", "数量", "单价", "成本", "预警阈值", "匹配结果", "库存变化", "导入动作"], rows, { count: rows.length })}
        <div class="modal-footer">
          <button class="btn outline" type="button" data-action="close-modal" onclick="window.JFS.closeModal(event)">取消</button>
          <button class="btn primary" type="button" data-action="confirm-import" onclick="window.JFS.confirmImport(event)">${icon("upload")}确认导入</button>
        </div>
      `, "Excel 导入预览", "large");
    }
    return "";
  }

  function modal(body, title, size = "") {
    return `
      <div class="modal-backdrop" data-action="close-modal">
        <div class="modal ${size}" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
          ${title ? `<div class="modal-header"><h2>${title}</h2><button type="button" class="icon-button" data-action="close-modal" onclick="window.JFS.closeModal(event)">${icon("close")}</button></div>` : ""}
          <div class="modal-body">${body}</div>
        </div>
      </div>
    `;
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function confirmImport() {
    if (!pendingImportBuffer) {
      toast("请重新选择 Excel 文件");
      return;
    }
    const operator = encodeURIComponent(state.user.name || "游客");
    const result = await api(`/inbound-import?operator=${operator}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pendingImportBuffer
    });
    pendingImportBuffer = null;
    state.importPreview = null;
    state.modal = null;
    toast(`导入成功：${result.imported} 条，新增物资 ${result.created_materials} 个`);
    await loadData();
  }

  async function submitForm(form) {
    const type = form.getAttribute("data-form");
    const data = formData(form);
    if (type === "login") {
      const user = await api("/login", { method: "POST", body: JSON.stringify(data) });
      state.user = user;
      state.modal = null;
      toast("登录成功");
      if (state.route === "/login") {
        setRoute("/");
      } else {
        render();
      }
      return;
    }
    if (type === "material") {
      if (!hasPermission("物资管理-编辑")) {
        toast("没有物资编辑权限");
        return;
      }
      const id = data.id;
      if (id) delete data.id;
      await api(id ? `/materials/${id}` : "/materials", { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
      state.modal = null;
      state.editMaterial = null;
      toast(id ? "物资已更新" : "物资已新增");
      await loadData();
      return;
    }
    if (type === "inbound") {
      if (!hasPermission("入库管理-创建")) {
        toast("没有入库权限");
        return;
      }
      const items = collectItemRows(form, "[data-inbound-row]");
      const result = await api("/inbound", { method: "POST", body: JSON.stringify({ ...data, items }) });
      toast(`入库成功：${result.count || 1} 条，库存已更新`);
      await loadData();
      return;
    }
    if (type === "outbound") {
      if (!hasPermission("出库管理-申请")) {
        toast("没有出库申请权限");
        return;
      }
      const items = collectItemRows(form, "[data-outbound-row]").map((item) => ({ ...item, sale_amount: item.sale_amount || 0 }));
      await api("/outbound", { method: "POST", body: JSON.stringify({ ...data, items }) });
      toast("出库申请已提交");
      await loadData();
      return;
    }
    if (type === "user") {
      if (!hasPermission("权限管理-配置")) {
        toast("没有权限管理权限");
        return;
      }
      const id = data.id;
      if (id) delete data.id;
      if (id && !data.password) delete data.password;
      await api(id ? `/users/${id}` : "/users", { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
      state.modal = null;
      state.editUser = null;
      toast(id ? "用户已更新" : "用户已添加");
      await loadData();
      return;
    }
    if (type === "materials-filter") {
      state.query.materials = data;
      await loadData();
      return;
    }
    if (type === "inventory-filter") {
      state.query.inventory = normalizeMaterialQuery({ ...(state.query.inventory || {}), ...data });
      resetPage("inventory");
      await loadData();
      return;
    }
    if (type === "inboundRecords-filter") {
      state.query.inboundRecords = normalizeMaterialQuery(data);
      resetPage("inboundRecords");
      await loadData();
      return;
    }
    if (type === "outboundRecords-filter") {
      state.query.outboundRecords = normalizeMaterialQuery(data);
      resetPage("outboundRecords");
      await loadData();
      return;
    }
    if (type === "sales-filter") {
      state.query.sales = normalizeMaterialQuery(data);
      resetPage("sales");
      await loadData();
      return;
    }
    if (type === "role-permissions") {
      const items = Array.from(form.querySelectorAll('[name="permission"]:checked')).map((item) => item.value);
      await api("/role-permissions", { method: "POST", body: JSON.stringify({ role: data.role, items }) });
      toast("角色权限已保存");
      await loadData();
      return;
    }
    if (type === "secondary-password") {
      if (!hasPermission("权限管理-配置")) {
        toast("没有权限管理权限");
        return;
      }
      await api("/admin/secondary-password", { method: "PUT", body: JSON.stringify(data) });
      form.reset();
      toast("二次密码已修改");
      return;
    }
    if (type === "clear-database") {
      if (!hasPermission("权限管理-配置")) {
        toast("没有权限管理权限");
        return;
      }
      if (!confirm("确定清除全部业务数据吗？此操作不可恢复。")) return;
      const result = await api("/admin/clear-database", { method: "POST", body: JSON.stringify(data) });
      form.reset();
      toast(`数据库已清除：物资 ${result.counts.materials} 条`);
      await loadData();
    }
  }

  function downloadCsv(filename, rows) {
    const text = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadTemplate() {
    const link = document.createElement("a");
    link.href = "/templates/inbound-import-template.xlsx";
    link.download = "入库管理导入模板.xlsx";
    link.click();
  }

  function materialById(id) {
    return (state.data.materials || []).find((m) => String(m.id) === String(id));
  }

  function materialByPicker(row) {
    const value = (name) => row.querySelector(`[name="${name}"]`)?.value || "";
    return (state.data.materials || []).find((m) => m.name === value("material_name") && m.spec === value("spec") && m.size === value("size") && m.color === value("color"));
  }

  function updateSelectOptions(selectEl, field, rows, selected) {
    const values = Array.from(new Set(rows.map((m) => m[field]).filter(Boolean))).sort();
    const keep = values.includes(selected) ? selected : "";
    selectEl.innerHTML = `<option value="">请选择</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${value === keep ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
    selectEl.value = keep;
    return keep;
  }

  function updateMaterialPickerOptions(row) {
    const materials = state.data.materials || [];
    const nameSelect = row.querySelector('[name="material_name"]');
    const specSelect = row.querySelector('[name="spec"]');
    const sizeSelect = row.querySelector('[name="size"]');
    const colorSelect = row.querySelector('[name="color"]');
    const name = updateSelectOptions(nameSelect, "name", materials, nameSelect.value);
    const specRows = name ? materials.filter((m) => m.name === name) : [];
    const spec = updateSelectOptions(specSelect, "spec", specRows, specSelect.value);
    const sizeRows = name && spec ? specRows.filter((m) => m.spec === spec) : [];
    const size = updateSelectOptions(sizeSelect, "size", sizeRows, sizeSelect.value);
    const colorRows = name && spec && size ? sizeRows.filter((m) => m.size === size) : [];
    updateSelectOptions(colorSelect, "color", colorRows, colorSelect.value);
  }

  function refreshMaterialRows(form) {
    form.querySelectorAll("[data-inbound-row], [data-outbound-row]").forEach((row, index) => {
      updateMaterialPickerOptions(row);
      const material = materialByPicker(row);
      row.querySelector(".item-index").textContent = String(index + 1);
      row.querySelector('[name="material_id"]').value = material ? material.id : "";
      const hasAny = ["material_name", "spec", "size", "color"].some((name) => row.querySelector(`[name="${name}"]`)?.value);
      const meta = row.querySelector("[data-material-meta]");
      if (!hasPermission("出库管理-物资信息") && row.matches("[data-outbound-row]")) {
        meta.textContent = material ? "已选择物资" : (hasAny ? "请继续选择完整物资" : "请选择品名、规格、尺寸、颜色");
      } else {
        meta.textContent = material ? `库存${material.stock} / 单价${yuan.format(material.price)} / 成本${yuan.format(material.cost)}` : (hasAny ? "请继续选择完整物资信息" : "请选择品名、规格、尺寸、颜色");
      }
    });
  }

  function collectItemRows(form, selector) {
    refreshMaterialRows(form);
    return Array.from(form.querySelectorAll(selector)).map((row) => ({
      material_id: row.querySelector('[name="material_id"]').value,
      quantity: row.querySelector('[name="quantity"]').value,
      sale_amount: row.querySelector('[name="sale_amount"]')?.value || ""
    })).filter((item) => item.material_id || item.quantity || item.sale_amount);
  }

  function refreshOutboundForm(form) {
    refreshMaterialRows(form);
    let total = 0;
    let cost = 0;
    form.querySelectorAll("[data-outbound-row]").forEach((row, index) => {
      const material = materialById(row.querySelector('[name="material_id"]').value);
      const quantity = Number(row.querySelector('[name="quantity"]').value || 0);
      const saleAmount = Number(row.querySelector('[name="sale_amount"]').value || 0);
      row.querySelector(".item-index").textContent = String(index + 1);
      total += saleAmount;
      cost += material ? material.cost * quantity : 0;
    });
    const commission = Number(form.querySelector('[name="commission"]')?.value || 0);
    const totalInput = form.querySelector("[data-outbound-total]");
    if (totalInput) totalInput.value = total.toFixed(2);
    const profit = form.querySelector("[data-profit-preview]");
    if (profit) profit.textContent = yuan.format(total - cost - commission);
  }

  function reviewPayload(id, review) {
    const payload = {};
    if (review === "approve" && hasPermission("出库管理-提成")) {
      const inputEl = document.querySelector(`[data-commission-for="${id}"]`);
      if (inputEl) {
        const commission = Number(inputEl.value || 0);
        if (!Number.isFinite(commission) || commission < 0) {
          toast("提成不能小于 0");
          return null;
        }
        payload.commission = commission;
      }
    }
    if (review === "reject") {
      const reason = prompt("请输入驳回理由");
      if (reason === null) return null;
      payload.reject_reason = reason.trim();
      if (!payload.reject_reason) {
        toast("驳回理由不能为空");
        return null;
      }
    }
    return payload;
  }

  async function importExcelFile() {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    picker.onchange = async () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        toast("请选择 xlsx 格式的 Excel 文件");
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        const preview = await api("/inbound-import-preview", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: buffer
        });
        pendingImportBuffer = buffer;
        state.importPreview = { ...preview, fileName: file.name };
        state.modal = "importPreview";
        render();
      } catch (error) {
        toast(error.message);
      }
    };
    picker.click();
  }

  function render() {
    const pages = {
      "/login": loginPage,
      "/": homePage,
      "/materials": materialsPage,
      "/inbound": inboundPage,
      "/outbound": outboundPage,
      "/inventory": inventoryPage,
      "/inbound-records": () => recordsPage("inbound"),
      "/outbound-records": () => recordsPage("outbound"),
      "/sales-records": salesPage,
      "/permissions": permissionsPage
    };
    const nav = navItems.find((item) => item.path === state.route) || navItems[0];
    document.title = `${state.route === "/login" ? "登录" : nav.label} - 江苏服装系统`;
    document.getElementById("app").innerHTML = (pages[state.route] || homePage)();
  }

  window.JFS = {
    goRoute(event, path) {
      event.preventDefault();
      event.stopPropagation();
      setRoute(path);
    },
    goPage(event, key, page) {
      event.preventDefault();
      event.stopPropagation();
      if (!key) return;
      setPage(key, page);
    },
    closeModal(event) {
      event.preventDefault();
      event.stopPropagation();
      state.modal = null;
      state.editMaterial = null;
      state.editUser = null;
      render();
    },
    async reviewRequest(event, id, review) {
      event.preventDefault();
      event.stopPropagation();
      try {
        if (!hasPermission("出库管理-审核")) {
          toast("没有出库审核权限");
          return;
        }
        const payload = reviewPayload(id, review);
        if (!payload) return;
        await api(`/outbound-requests/${id}/${review}`, { method: "POST", body: JSON.stringify(payload) });
        state.modal = null;
        toast("申请已处理");
        await loadData();
      } catch (error) {
        toast(error.message);
      }
    },
    async confirmImport(event) {
      event.preventDefault();
      event.stopPropagation();
      try {
        await confirmImport();
      } catch (error) {
        toast(error.message);
      }
    }
  };

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    try {
      await submitForm(form);
    } catch (error) {
      toast(error.message);
    }
  });

  document.addEventListener("click", async (event) => {
    const route = event.target.closest("[data-route]");
    if (route) {
      event.preventDefault();
      setRoute(route.getAttribute("data-route"));
      return;
    }
    const modal = event.target.closest("[data-modal]");
    if (modal) {
      if (modal.getAttribute("data-modal") === "material") state.editMaterial = null;
      if (modal.getAttribute("data-modal") === "user") state.editUser = null;
      state.modal = modal.getAttribute("data-modal");
      render();
      return;
    }
    const step = event.target.closest("[data-step]");
    if (step) {
      const inputEl = step.parentElement.querySelector("input");
      inputEl.value = Math.max(0, Number(inputEl.value || 0) + Number(step.getAttribute("data-step")));
      const outboundForm = step.closest('[data-form="outbound"]');
      if (outboundForm) refreshOutboundForm(outboundForm);
      const inboundForm = step.closest('[data-form="inbound"]');
      if (inboundForm) refreshMaterialRows(inboundForm);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const name = action.getAttribute("data-action");
    try {
      if (name === "review-request") {
        event.preventDefault();
        event.stopPropagation();
        if (!hasPermission("出库管理-审核")) {
          toast("没有出库审核权限");
          return;
        }
        const review = action.getAttribute("data-review");
        const payload = reviewPayload(action.getAttribute("data-id"), review);
        if (!payload) return;
        await api(`/outbound-requests/${action.getAttribute("data-id")}/${review}`, { method: "POST", body: JSON.stringify(payload) });
        state.modal = null;
        toast("申请已处理");
        await loadData();
        return;
      }
      if (name === "close-modal") {
        event.preventDefault();
        event.stopPropagation();
        state.modal = null;
        state.editMaterial = null;
        state.editUser = null;
        render();
        return;
      }
      if (name === "open-sidebar") {
        state.sidebarOpen = true;
        render();
      }
      if (name === "close-sidebar") {
        state.sidebarOpen = false;
        render();
      }
      if (name === "reload") await loadData();
      if (name === "send-code") toast("验证码已发送：8888");
      if (name === "page") {
        event.preventDefault();
        event.stopPropagation();
        setPage(action.getAttribute("data-page-key"), action.getAttribute("data-page"));
        return;
      }
      if (name === "show-notifications") {
        state.notifications = (await api("/dashboard")).notifications;
        state.modal = "notifications";
        render();
        return;
      }
      if (name === "import-excel") {
        if (!hasPermission("入库管理-创建")) {
          toast("没有入库权限");
          return;
        }
        importExcelFile();
      }
      if (name === "confirm-import") {
        if (!hasPermission("入库管理-创建")) {
          toast("没有入库权限");
          return;
        }
        await confirmImport();
        return;
      }
      if (name === "download-template") downloadTemplate();
      if (name === "add-outbound-item") {
        const list = document.querySelector("[data-outbound-items]");
        if (list) {
          list.insertAdjacentHTML("beforeend", outboundItemRow(list.querySelectorAll("[data-outbound-row]").length));
          refreshOutboundForm(list.closest("form"));
        }
        return;
      }
      if (name === "add-inbound-item") {
        const list = document.querySelector("[data-inbound-items]");
        if (list) {
          list.insertAdjacentHTML("beforeend", inboundItemRow(list.querySelectorAll("[data-inbound-row]").length));
          refreshMaterialRows(list.closest("form"));
        }
        return;
      }
      if (name === "remove-outbound-item") {
        const row = action.closest("[data-outbound-row]");
        const form = action.closest("form");
        if (form.querySelectorAll("[data-outbound-row]").length <= 1) {
          toast("至少保留一个物资");
          return;
        }
        row.remove();
        refreshOutboundForm(form);
        return;
      }
      if (name === "remove-inbound-item") {
        const row = action.closest("[data-inbound-row]");
        const form = action.closest("form");
        if (form.querySelectorAll("[data-inbound-row]").length <= 1) {
          toast("至少保留一个物资");
          return;
        }
        row.remove();
        refreshMaterialRows(form);
        return;
      }
      if (name === "edit-material") {
        if (!hasPermission("物资管理-编辑")) {
          toast("没有物资编辑权限");
          return;
        }
        const material = (state.data.materials || []).find((m) => String(m.id) === action.getAttribute("data-id"));
        if (!material) {
          toast("物资数据不存在");
          return;
        }
        state.editMaterial = material;
        state.modal = "material";
        render();
        return;
      }
      if (name === "edit-user") {
        if (!hasPermission("权限管理-配置")) {
          toast("没有权限管理权限");
          return;
        }
        const user = (state.data.users || []).find((u) => String(u.id) === action.getAttribute("data-id"));
        if (!user) {
          toast("用户数据不存在");
          return;
        }
        state.editUser = user;
        state.modal = "user";
        render();
        return;
      }
      if (name === "delete-user") {
        if (!hasPermission("权限管理-配置")) {
          toast("没有权限管理权限");
          return;
        }
        if (!confirm("确定删除该用户吗？")) return;
        await api(`/users/${action.getAttribute("data-id")}`, { method: "DELETE", body: "{}" });
        toast("用户已删除");
        await loadData();
        return;
      }
      if (name === "export-inventory") {
        if (!hasPermission("库存统计-查看")) {
          toast("没有库存统计权限");
          return;
        }
        const columns = inventoryColumns();
        const rows = [columns.map((column) => column.header.replace(/ \(元\)/g, ""))].concat(
          (state.data.materials || []).map((m) => columns.map((column) => column.export(m)))
        );
        downloadCsv("库存统计.csv", rows);
        return;
      }
      if (name === "export-sales") {
        if (!hasPermission("销售记录-查看")) {
          toast("没有销售记录权限");
          return;
        }
        const summary = state.data.summary || {};
        const columns = salesColumns();
        const rows = [columns.map((column) => column.header.replace(/ \(元\)/g, ""))].concat(
          (state.data.rows || []).map((row) => columns.map((column) => column.export(row)))
        );
        rows.push(columns.map((column, index) => {
          if (index === 0) return "合计";
          if (column.key === "quantity") return summary.quantity || 0;
          if (column.key === "saleAmount") return summary.sale_amount || 0;
          if (column.key === "costAmount") return summary.cost_amount || 0;
          if (column.key === "commission") return summary.commission || 0;
          if (column.key === "profit") return summary.profit || 0;
          return "";
        }));
        downloadCsv("销售记录.csv", rows);
        return;
      }
      if (name === "reset-inventory") {
        state.query.inventory = {};
        resetPage("inventory");
        await loadData();
      }
      if (name === "reset-records") {
        const key = action.getAttribute("data-key");
        state.query[key] = {};
        resetPage(key);
        await loadData();
      }
      if (name === "reset-sales") {
        state.query.sales = {};
        resetPage("sales");
        await loadData();
      }
      if (name === "delete-material") {
        if (!hasPermission("物资管理-编辑")) {
          toast("没有物资编辑权限");
          return;
        }
        if (!confirm("确定删除该物资吗？相关记录会同步删除。")) return;
        await api(`/materials/${action.getAttribute("data-id")}`, { method: "DELETE", body: "{}" });
        toast("物资已删除");
        await loadData();
      }
    } catch (error) {
      toast(error.message);
    }
  });

  document.addEventListener("input", (event) => {
    const form = event.target.closest('[data-form="outbound"]');
    if (form) refreshOutboundForm(form);
    const inboundForm = event.target.closest('[data-form="inbound"]');
    if (inboundForm) refreshMaterialRows(inboundForm);
  });

  document.addEventListener("change", (event) => {
    const filterForm = event.target.closest("[data-live-filter]");
    if (filterForm && event.target.matches("select")) {
      const queryKey = queryKeyFromFilterForm(filterForm.getAttribute("data-form"));
      if (queryKey) {
        state.query[queryKey] = normalizeMaterialQuery({ ...(state.query[queryKey] || {}), ...formData(filterForm) });
        resetPage(queryKey);
        render();
        return;
      }
    }
    const form = event.target.closest('[data-form="outbound"]');
    if (form) refreshOutboundForm(form);
    const inboundForm = event.target.closest('[data-form="inbound"]');
    if (inboundForm) refreshMaterialRows(inboundForm);
  });

  window.addEventListener("popstate", () => {
    const next = normalizePath(location.pathname);
    state.route = !isAuthenticated() && next !== "/login" ? "/login" : next;
    loadData();
  });

  loadData();
})();
