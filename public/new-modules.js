// ============================================================
// 商品装具调拨单打印工具 - 生产管理与库存管理模块
// ============================================================
// 此模块通过 Electron IPC 存入统一 SQLite，IndexedDB 仅用于首次迁移
// 新功能：原材料管理、供应商管理、生产管理、成品管理、库存日志
// ============================================================

(function() {
  'use strict';

  // ============================================================
  // 工具函数
  // ============================================================
  function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const pad = n => n.toString().padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function formatDateShort(date) {
    if (!date) return '';
    const d = new Date(date);
    const pad = n => n.toString().padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function now() {
    return new Date().toISOString();
  }

  function showToast(message, type) {
    type = type || 'success';
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 生成车间下拉选项（出库/领料时选择车间）
  function workshopOptions() {
    if (!state.workshops || state.workshops.length === 0) {
      return '<option value="">暂无车间，请先到"车间管理"添加</option>';
    }
    return '<option value="">请选择车间</option>' +
      state.workshops.map(function(w) {
        return '<option value="' + w.id + '">' + escapeHtml(w.name) + (w.manager ? ' (' + escapeHtml(w.manager) + ')' : '') + '</option>';
      }).join('');
  }

  // ============================================================
  // IndexedDB 数据库
  // ============================================================
  var DB_NAME = 'ProductionManagementDB';
  var DB_VERSION = 2;

  function openDB() {
    return new Promise(function(resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function(e) {
        var db = e.target.result;
        // 车间表
        if (!db.objectStoreNames.contains('workshops')) {
          var workshops = db.createObjectStore('workshops', { keyPath: 'id', autoIncrement: true });
          workshops.createIndex('name', 'name', { unique: false });
        }
        // 原材料表
        if (!db.objectStoreNames.contains('materials')) {
          var materials = db.createObjectStore('materials', { keyPath: 'id', autoIncrement: true });
          materials.createIndex('name', 'name', { unique: false });
          materials.createIndex('supplier_id', 'supplier_id', { unique: false });
        }
        // 原材料入库记录
        if (!db.objectStoreNames.contains('material_inbound')) {
          var inbound = db.createObjectStore('material_inbound', { keyPath: 'id', autoIncrement: true });
          inbound.createIndex('material_id', 'material_id', { unique: false });
          inbound.createIndex('created_at', 'created_at', { unique: false });
        }
        // 原材料出库记录
        if (!db.objectStoreNames.contains('material_outbound')) {
          var outbound = db.createObjectStore('material_outbound', { keyPath: 'id', autoIncrement: true });
          outbound.createIndex('material_id', 'material_id', { unique: false });
          outbound.createIndex('order_id', 'order_id', { unique: false });
        }
        // 供应商表
        if (!db.objectStoreNames.contains('suppliers')) {
          var suppliers = db.createObjectStore('suppliers', { keyPath: 'id', autoIncrement: true });
          suppliers.createIndex('name', 'name', { unique: false });
        }
        // 生产记录表
        if (!db.objectStoreNames.contains('productions')) {
          var productions = db.createObjectStore('productions', { keyPath: 'id', autoIncrement: true });
          productions.createIndex('order_id', 'order_id', { unique: false });
          productions.createIndex('status', 'status', { unique: false });
        }
        // 生产用料记录表
        if (!db.objectStoreNames.contains('production_materials')) {
          var prodMats = db.createObjectStore('production_materials', { keyPath: 'id', autoIncrement: true });
          prodMats.createIndex('production_id', 'production_id', { unique: false });
        }
        // 成品库存表
        if (!db.objectStoreNames.contains('finished_products')) {
          var fp = db.createObjectStore('finished_products', { keyPath: 'id', autoIncrement: true });
          fp.createIndex('order_id', 'order_id', { unique: false });
          fp.createIndex('product_name', 'product_name', { unique: false });
        }
        // 成品出入库记录表
        if (!db.objectStoreNames.contains('finished_product_logs')) {
          var fpl = db.createObjectStore('finished_product_logs', { keyPath: 'id', autoIncrement: true });
          fpl.createIndex('product_id', 'product_id', { unique: false });
          fpl.createIndex('order_id', 'order_id', { unique: false });
        }
        // 库存变更日志表
        if (!db.objectStoreNames.contains('stock_logs')) {
          var sl = db.createObjectStore('stock_logs', { keyPath: 'id', autoIncrement: true });
          sl.createIndex('stock_type', 'stock_type', { unique: false });
          sl.createIndex('created_at', 'created_at', { unique: false });
        }
      };
      request.onsuccess = function(e) { resolve(e.target.result); };
      request.onerror = function(e) { reject(e.target.error); };
    });
  }

  // Legacy IndexedDB is read only once. A failed migration never falls back to writing it.
  var inventoryReady = (async function() {
    if (!window.electronAPI) throw new Error('请在桌面应用中打开')
    var stores = {};
    if (!await window.electronAPI.inventoryMigrated()) {
      var db = await openDB();
      try {
        await Promise.all(Array.from(db.objectStoreNames).map(function(name) {
          return new Promise(function(resolve, reject) {
            var tx = db.transaction(name, 'readonly');
            var request = tx.objectStore(name).getAll();
            tx.oncomplete = function() { stores[name] = request.result; resolve(); };
            tx.onerror = function() { reject(tx.error); };
            tx.onabort = function() { reject(tx.error || new Error('读取旧库存失败')); };
          });
        }));
      } finally { db.close(); }
    }
    await window.electronAPI.migrateInventory(stores);
  })();
  window.inventoryReady = inventoryReady;
  inventoryReady.catch(function(error) { showToast('库存迁移失败：' + error.message, 'error'); });

  function getAllFromStore(storeName) {
    return inventoryReady.then(function() { return window.electronAPI.listInventory(storeName); });
  }
  function getById(storeName, id) {
    return getAllFromStore(storeName).then(function(rows) { return rows.find(function(row) { return row.id === id; }); });
  }
  function addToStore(storeName, data) {
    return inventoryReady.then(function() { return window.electronAPI.putInventory(storeName, data, true); });
  }
  function updateInStore(storeName, data) {
    return inventoryReady.then(function() { return window.electronAPI.putInventory(storeName, data); });
  }
  function deleteFromStore(storeName, id) {
    return inventoryReady.then(function() { return window.electronAPI.deleteInventory(storeName, id); });
  }
  function getByIndex(storeName, indexName, value) {
    return getAllFromStore(storeName).then(function(rows) { return rows.filter(function(row) { return row[indexName] === value; }); });
  }

  // ============================================================
  // 库存日志记录
  // ============================================================
  function addStockLog(stockType, itemId, itemName, changeType, quantity, beforeQty, afterQty, operator, remark) {
    var log = {
      stock_type: stockType,
      item_id: itemId,
      item_name: itemName,
      change_type: changeType,
      quantity: quantity,
      before_quantity: beforeQty,
      after_quantity: afterQty,
      operator: operator || '管理员',
      remark: remark || '',
      created_at: now()
    };
    return addToStore('stock_logs', log);
  }

  // ============================================================
  // 模块状态管理
  // ============================================================
  var state = {
    currentPage: 'materials',
    currentSubPage: 'list',
    // 缓存数据
    materials: [],
    suppliers: [],
    productions: [],
    finishedProducts: [],
    materialInbounds: [],
    materialOutbounds: [],
    stockLogs: [],
    finishedProductLogs: [],
    workshops: [],
    // 当前选中的项目
    selectedMaterial: null,
    selectedSupplier: null,
    selectedProduction: null,
    selectedProduct: null,
    // 筛选条件
    materialFilter: '',
    supplierFilter: '',
    productionFilter: '',
    productFilter: '',
    // 编辑状态
    editingSupplier: null,
  };

  // ============================================================
  // 渲染引擎
  // ============================================================
  var appContainer = null;

  function init() {
    // 等待页面加载完成后初始化
    function onReady() {
      addGlobalNavButton();
      setupApp();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
  }

  function setupApp() {
    // 检查是否已经初始化
    if (document.getElementById('new-modules-sidebar')) return;

    var root = document.getElementById('root');
    if (!root) return;

    // 创建新的布局容器
    var layout = document.createElement('div');
    layout.className = 'app-layout';
    layout.id = 'new-modules-sidebar';
    layout.style.display = 'none'; // 初始隐藏

    // 创建侧边栏
    var sidebar = document.createElement('div');
    sidebar.className = 'app-sidebar';
    sidebar.innerHTML = buildSidebarHTML();

    // 创建主内容区
    var main = document.createElement('div');
    main.className = 'app-main';
    main.id = 'new-modules-content';

    layout.appendChild(sidebar);
    layout.appendChild(main);

    // 插入到页面中
    root.parentNode.insertBefore(layout, root.nextSibling);

    // 绑定侧边栏事件
    sidebar.addEventListener('click', function(e) {
      var item = e.target.closest('.menu-item');
      if (item) {
        var page = item.getAttribute('data-page');
        if (page) {
          navigateTo(page);
        }
      }
    });

    // 加载数据并渲染默认页面
    loadAllData().then(function() { renderPage('materials'); }).catch(function(error) { showToast(error.message, 'error'); });
  }

  function buildSidebarHTML() {
    return '<div class="sidebar-header"><h2>📋 生产管理</h2></div>' +
      '<div class="sidebar-menu">' +
      '<div class="menu-section">库存管理</div>' +
      '<button class="menu-item active" data-page="materials"><span class="menu-icon">📦</span> 原材料管理</button>' +
      '<button class="menu-item" data-page="suppliers"><span class="menu-icon">🏭</span> 供应商管理</button>' +
      '<div class="menu-section">生产管理</div>' +
      '<button class="menu-item" data-page="workshops"><span class="menu-icon">🏗️</span> 车间管理</button>' +
      '<button class="menu-item" data-page="productions"><span class="menu-icon">⚙️</span> 生产任务</button>' +
      '<button class="menu-item" data-page="finished-products"><span class="menu-icon">🏗️</span> 成品管理</button>' +
      '<div class="menu-section">报表</div>' +
      '<button class="menu-item" data-page="report"><span class="menu-icon">📊</span> 收发存汇总表</button>' +
      '<div class="menu-section">系统</div>' +
      '<button class="menu-item" data-page="stock-logs"><span class="menu-icon">📝</span> 库存日志</button>' +
      '<button class="menu-item" id="back-to-old" style="color:#ff4d4f;"><span class="menu-icon">🔙</span> 返回原系统</button>' +
      '</div>';
  }

  function loadAllData() {
    return Promise.all([
      getAllFromStore('materials').then(function(d) { state.materials = d; }),
      getAllFromStore('suppliers').then(function(d) { state.suppliers = d; }),
      getAllFromStore('productions').then(function(d) { state.productions = d; }),
      getAllFromStore('finished_products').then(function(d) { state.finishedProducts = d; }),
      getAllFromStore('material_inbound').then(function(d) { state.materialInbounds = d; }),
      getAllFromStore('material_outbound').then(function(d) { state.materialOutbounds = d; }),
      getAllFromStore('stock_logs').then(function(d) { state.stockLogs = d; }),
      getAllFromStore('finished_product_logs').then(function(d) { state.finishedProductLogs = d; }),
      getAllFromStore('workshops').then(function(d) { state.workshops = d; }),
    ]);
  }

  function navigateTo(page) {
    state.currentPage = page;
    // 更新侧边栏高亮
    var items = document.querySelectorAll('#new-modules-sidebar .menu-item');
    items.forEach(function(item) {
      item.classList.toggle('active', item.getAttribute('data-page') === page);
    });
    renderPage(page);
  }

  // ============================================================
  // 页面渲染
  // ============================================================
  function renderPage(page) {
    var content = document.getElementById('new-modules-content');
    if (!content) return;

    switch (page) {
      case 'materials': renderMaterialsPage(content); break;
      case 'suppliers': renderSuppliersPage(content); break;
      case 'workshops': renderWorkshopsPage(content); break;
      case 'productions': renderProductionsPage(content); break;
      case 'finished-products': renderFinishedProductsPage(content); break;
      case 'report': renderReportPage(content); break;
      case 'stock-logs': renderStockLogsPage(content); break;
      default: renderMaterialsPage(content);
    }
  }

  // ============================================================
  // 原材料管理页面
  // ============================================================
  function renderMaterialsPage(container) {
    var html = '<div class="page-container">' +
      '<div class="page-header">' +
      '<h1>📦 原材料管理</h1>' +
      '<div class="header-actions">' +
      '<button class="btn btn-primary" onclick="window.__newModule && window.__newModule.showInboundDialog()">📥 入库</button>' +
      '<button class="btn" onclick="window.__newModule && window.__newModule.showOutboundDialog()">📤 出库</button>' +
      '<button class="btn" onclick="window.__newModule && window.__newModule.showAddMaterialDialog()">➕ 新增原材料</button>' +
      '<button class="btn" onclick="window.__newModule && window.__newModule.refreshMaterials()">🔄 刷新</button>' +
      '</div>' +
      '</div>';

    // 统计卡片
    var total = state.materials.length;
    var totalQty = state.materials.reduce(function(s, m) { return s + (m.quantity || 0); }, 0);
    var lowStock = state.materials.filter(function(m) { return (m.quantity || 0) <= (m.min_quantity || 0); });
    html += '<div class="stats-row">' +
      '<div class="stat-card"><div class="stat-value">' + total + '</div><div class="stat-label">原材料种类</div></div>' +
      '<div class="stat-card success"><div class="stat-value">' + totalQty.toFixed(1) + '</div><div class="stat-label">总库存量</div></div>' +
      '<div class="stat-card ' + (lowStock.length > 0 ? 'danger' : '') + '"><div class="stat-value">' + lowStock.length + '</div><div class="stat-label">库存不足</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + state.suppliers.length + '</div><div class="stat-label">供应商数</div></div>' +
      '</div>';

    // 搜索和筛选
    html += '<div class="filter-bar">' +
      '<span class="filter-label">🔍</span>' +
      '<input type="text" id="material-search" placeholder="搜索原材料名称..." value="' + escapeHtml(state.materialFilter) + '" oninput="window.__newModule && window.__newModule.filterMaterials()">' +
      '<span class="filter-label">库存不足</span>' +
      '<input type="checkbox" id="material-low-filter" onchange="window.__newModule && window.__newModule.filterMaterials()">' +
      '</div>';

    // 表格
    html += '<table class="data-table">' +
      '<thead><tr>' +
      '<th>名称</th><th>规格</th><th>单位</th><th>库存数量</th><th>最低库存</th><th>供应商</th><th>状态</th><th>操作</th>' +
      '</tr></thead><tbody>';

    var filtered = getFilteredMaterials();
    if (filtered.length === 0) {
      html += '<tr><td colspan="8" style="text-align:center;padding:40px;color:#999;">暂无原材料数据，点击"新增原材料"开始添加</td></tr>';
    } else {
      filtered.forEach(function(m) {
        var isLow = (m.quantity || 0) <= (m.min_quantity || 0);
        var supplier = state.suppliers.find(function(s) { return s.id === m.supplier_id; });
        html += '<tr class="' + (isLow ? 'row-low-stock' : '') + '">' +
          '<td><strong>' + escapeHtml(m.name) + '</strong></td>' +
          '<td>' + escapeHtml(m.spec || '-') + '</td>' +
          '<td>' + escapeHtml(m.unit || '-') + '</td>' +
          '<td style="font-weight:700;' + (isLow ? 'color:#cf1322' : '') + '">' + (m.quantity || 0) + '</td>' +
          '<td>' + (m.min_quantity || 0) + '</td>' +
          '<td>' + (supplier ? escapeHtml(supplier.name) : '-') + '</td>' +
          '<td>' + (isLow ? '<span class="status-badge low-stock">⚠️ 不足</span>' : '<span class="status-badge in-stock">✅ 充足</span>') + '</td>' +
          '<td>' +
          '<div class="table-actions">' +
          '<button class="btn-link" onclick="window.__newModule.showInboundForMaterial(' + m.id + ')">入库</button>' +
          '<button class="btn-link" onclick="window.__newModule.showOutboundForMaterial(' + m.id + ')">出库</button>' +
          '<button class="btn-link danger" onclick="window.__newModule.deleteMaterial(' + m.id + ')">删除</button>' +
          '</div>' +
          '</td></tr>';
      });
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  function getFilteredMaterials() {
    var list = state.materials.slice();
    var keyword = (state.materialFilter || '').toLowerCase();
    var onlyLow = document.getElementById('material-low-filter') && document.getElementById('material-low-filter').checked;

    if (keyword) {
      list = list.filter(function(m) { return m.name.toLowerCase().indexOf(keyword) >= 0; });
    }
    if (onlyLow) {
      list = list.filter(function(m) { return (m.quantity || 0) <= (m.min_quantity || 0); });
    }
    return list;
  }

  // ============================================================
  // 原材料入库弹窗
  // ============================================================
  function showInboundDialog(materialId) {
    var material = null;
    if (materialId) {
      material = state.materials.find(function(m) { return m.id === materialId; });
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'inbound-modal';

    var options = state.materials.map(function(m) {
      var selected = material && material.id === m.id ? 'selected' : '';
      return '<option value="' + m.id + '" ' + selected + '>' + escapeHtml(m.name) + ' (' + escapeHtml(m.spec || '') + ') - 当前库存: ' + (m.quantity || 0) + '</option>';
    }).join('');

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>📥 原材料入库</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>原材料 *</label><select id="inbound-material-id">' + options + '</select></div>' +
      '<div class="form-field"><label>入库数量 *</label><input type="number" id="inbound-qty" min="0.01" step="0.01" value="1"></div>' +
      '<div class="form-field"><label>单价</label><input type="number" id="inbound-price" min="0" step="0.01" value="0"></div>' +
      '<div class="form-field"><label>总价</label><input type="number" id="inbound-total" min="0" step="0.01" value="0" readonly></div>' +
      '<div class="form-field"><label>供应商</label><select id="inbound-supplier"><option value="">无</option>' +
      state.suppliers.map(function(s) { return '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="form-field"><label>操作人员</label><input type="text" id="inbound-operator" value="管理员"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="inbound-remark" rows="2"></textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'inbound-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmInbound()">确认入库</button>' +
      '</div></div>';

    document.body.appendChild(overlay);

    // 自动计算总价
    document.getElementById('inbound-qty').addEventListener('input', function() {
      var qty = parseFloat(this.value) || 0;
      var price = parseFloat(document.getElementById('inbound-price').value) || 0;
      document.getElementById('inbound-total').value = (qty * price).toFixed(2);
    });
    document.getElementById('inbound-price').addEventListener('input', function() {
      var qty = parseFloat(document.getElementById('inbound-qty').value) || 0;
      var price = parseFloat(this.value) || 0;
      document.getElementById('inbound-total').value = (qty * price).toFixed(2);
    });
  }

  function confirmInbound() {
    var materialId = parseInt(document.getElementById('inbound-material-id').value);
    var qty = parseFloat(document.getElementById('inbound-qty').value);
    var price = parseFloat(document.getElementById('inbound-price').value) || 0;
    var total = parseFloat(document.getElementById('inbound-total').value) || 0;
    var supplierId = document.getElementById('inbound-supplier').value ? parseInt(document.getElementById('inbound-supplier').value) : null;
    var operator = document.getElementById('inbound-operator').value || '管理员';
    var remark = document.getElementById('inbound-remark').value || '';

    if (!materialId) { showToast('请选择原材料', 'error'); return; }
    if (!qty || qty <= 0) { showToast('请输入有效的入库数量', 'error'); return; }

    var material = state.materials.find(function(m) { return m.id === materialId; });
    if (!material) { showToast('原材料不存在', 'error'); return; }

    var beforeQty = material.quantity || 0;
    var afterQty = beforeQty + qty;

    // 更新原材料库存
    material.quantity = afterQty;
    material.updated_at = now();

    var inboundRecord = {
      material_id: materialId,
      quantity: qty,
      unit_price: price,
      total_price: total,
      supplier_id: supplierId,
      operator: operator,
      remark: remark,
      created_at: now()
    };

    updateInStore('materials', material).then(function() {
      return addToStore('material_inbound', inboundRecord);
    }).then(function() {
      return addStockLog('material', materialId, material.name, 'inbound', qty, beforeQty, afterQty, operator, remark);
    }).then(function() {
      showToast('入库成功！' + material.name + ' +' + qty + ' ' + (material.unit || ''));
      document.getElementById('inbound-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('入库失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 原材料出库弹窗
  // ============================================================
  function showOutboundDialog(materialId) {
    var material = null;
    if (materialId) {
      material = state.materials.find(function(m) { return m.id === materialId; });
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'outbound-modal';

    var options = state.materials.map(function(m) {
      var selected = material && material.id === m.id ? 'selected' : '';
      return '<option value="' + m.id + '" ' + selected + '>' + escapeHtml(m.name) + ' (' + escapeHtml(m.spec || '') + ') - 库存: ' + (m.quantity || 0) + '</option>';
    }).join('');

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>📤 原材料出库</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>原材料 *</label><select id="outbound-material-id">' + options + '</select></div>' +
      '<div class="form-field"><label>出库数量 *</label><input type="number" id="outbound-qty" min="0.01" step="0.01" value="1"></div>' +
      '<div class="form-field"><label>车间 *</label><select id="outbound-workshop-id">' + workshopOptions() + '</select></div>' +
      '<div class="form-field"><label>操作人员</label><input type="text" id="outbound-operator" value="管理员"></div>' +
      '<div class="form-field"><label>用途说明</label><input type="text" id="outbound-purpose" placeholder="如: 生产领料"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="outbound-remark" rows="2"></textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'outbound-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmOutbound()">确认出库</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
  }

  function confirmOutbound() {
    var materialId = parseInt(document.getElementById('outbound-material-id').value);
    var qty = parseFloat(document.getElementById('outbound-qty').value);
    var workshopId = document.getElementById('outbound-workshop-id').value ? parseInt(document.getElementById('outbound-workshop-id').value) : null;
    var operator = document.getElementById('outbound-operator').value || '管理员';
    var purpose = document.getElementById('outbound-purpose').value || '';
    var remark = document.getElementById('outbound-remark').value || '';

    if (!materialId) { showToast('请选择原材料', 'error'); return; }
    if (!qty || qty <= 0) { showToast('请输入有效的出库数量', 'error'); return; }
    if (!workshopId) { showToast('请选择车间', 'error'); return; }

    var workshop = state.workshops.find(function(w) { return w.id === workshopId; });
    var material = state.materials.find(function(m) { return m.id === materialId; });
    if (!material) { showToast('原材料不存在', 'error'); return; }

    var beforeQty = material.quantity || 0;
    if (qty > beforeQty) { showToast('库存不足！当前库存: ' + beforeQty, 'error'); return; }

    var afterQty = beforeQty - qty;
    material.quantity = afterQty;
    material.updated_at = now();

    var remarkWithWorkshop = (workshop ? '车间: ' + workshop.name + '; ' : '') + (remark || purpose);

    var outboundRecord = {
      material_id: materialId,
      quantity: qty,
      workshop_id: workshopId,
      workshop_name: workshop ? workshop.name : '',
      purpose: purpose,
      operator: operator,
      remark: remark,
      created_at: now()
    };

    updateInStore('materials', material).then(function() {
      return addToStore('material_outbound', outboundRecord);
    }).then(function() {
      return addStockLog('material', materialId, material.name, 'outbound', -qty, beforeQty, afterQty, operator, remarkWithWorkshop);
    }).then(function() {
      showToast('出库成功！' + material.name + ' -' + qty + ' ' + (material.unit || ''));
      document.getElementById('outbound-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('出库失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 新增原材料弹窗
  // ============================================================
  function showAddMaterialDialog() {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'add-material-modal';

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>➕ 新增原材料</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>原材料名称 *</label><input type="text" id="new-mat-name" placeholder="请输入名称"></div>' +
      '<div class="form-field"><label>规格</label><input type="text" id="new-mat-spec" placeholder="如: 25kg/袋"></div>' +
      '<div class="form-field"><label>单位 *</label><select id="new-mat-unit"><option value="个">个</option><option value="千克">千克</option><option value="米">米</option><option value="件">件</option><option value="袋">袋</option><option value="桶">桶</option><option value="箱">箱</option><option value="瓶">瓶</option><option value="套">套</option></select></div>' +
      '<div class="form-field"><label>初始库存</label><input type="number" id="new-mat-qty" value="0" min="0" step="0.01"></div>' +
      '<div class="form-field"><label>最低库存预警值</label><input type="number" id="new-mat-min" value="0" min="0" step="0.01"></div>' +
      '<div class="form-field"><label>供应商</label><select id="new-mat-supplier"><option value="">无</option>' +
      state.suppliers.map(function(s) { return '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="new-mat-remark" rows="2"></textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'add-material-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmAddMaterial()">确认添加</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
  }

  function confirmAddMaterial() {
    var name = document.getElementById('new-mat-name').value.trim();
    var spec = document.getElementById('new-mat-spec').value.trim();
    var unit = document.getElementById('new-mat-unit').value;
    var qty = parseFloat(document.getElementById('new-mat-qty').value) || 0;
    var minQty = parseFloat(document.getElementById('new-mat-min').value) || 0;
    var supplierId = document.getElementById('new-mat-supplier').value ? parseInt(document.getElementById('new-mat-supplier').value) : null;
    var remark = document.getElementById('new-mat-remark').value.trim();

    if (!name) { showToast('请输入原材料名称', 'error'); return; }

    var material = {
      name: name,
      spec: spec,
      unit: unit,
      quantity: qty,
      min_quantity: minQty,
      supplier_id: supplierId,
      remark: remark,
      created_at: now(),
      updated_at: now()
    };

    addToStore('materials', material).then(function(id) {
      showToast('原材料添加成功！');
      document.getElementById('add-material-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('添加失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 删除原材料
  // ============================================================
  function deleteMaterial(id) {
    if (!confirm('确定要删除该原材料吗？')) return;
    deleteFromStore('materials', id).then(function() {
      showToast('删除成功');
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('删除失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 供应商管理页面
  // ============================================================
  function renderSuppliersPage(container) {
    var html = '<div class="page-container">' +
      '<div class="page-header">' +
      '<h1>🏭 供应商管理</h1>' +
      '<div class="header-actions">' +
      '<button class="btn btn-primary" onclick="window.__newModule.showAddSupplierDialog()">➕ 添加供应商</button>' +
      '<button class="btn" onclick="window.__newModule.refreshSuppliers()">🔄 刷新</button>' +
      '</div>' +
      '</div>';

    html += '<div class="filter-bar">' +
      '<span class="filter-label">🔍</span>' +
      '<input type="text" id="supplier-search" placeholder="搜索供应商名称..." oninput="window.__newModule.filterSuppliers()">' +
      '</div>';

    html += '<table class="data-table">' +
      '<thead><tr>' +
      '<th>供应商名称</th><th>联系方式</th><th>地址</th><th>提供材料</th><th>操作</th>' +
      '</tr></thead><tbody>';

    var keyword = (state.supplierFilter || '').toLowerCase();
    var filtered = keyword ? state.suppliers.filter(function(s) { return s.name.toLowerCase().indexOf(keyword) >= 0; }) : state.suppliers;

    if (filtered.length === 0) {
      html += '<tr><td colspan="5" style="text-align:center;padding:40px;color:#999;">暂无供应商数据</td></tr>';
    } else {
      filtered.forEach(function(s) {
        html += '<tr>' +
          '<td><strong>' + escapeHtml(s.name) + '</strong></td>' +
          '<td>' + escapeHtml(s.contact || '-') + '</td>' +
          '<td>' + escapeHtml(s.address || '-') + '</td>' +
          '<td>' + escapeHtml(s.materials || '-') + '</td>' +
          '<td>' +
          '<div class="table-actions">' +
          '<button class="btn-link" onclick="window.__newModule.showEditSupplierDialog(' + s.id + ')">编辑</button>' +
          '<button class="btn-link" onclick="window.__newModule.showSupplierRecords(' + s.id + ')">供货记录</button>' +
          '<button class="btn-link danger" onclick="window.__newModule.deleteSupplier(' + s.id + ')">删除</button>' +
          '</div>' +
          '</td></tr>';
      });
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // ============================================================
  // 添加供应商弹窗
  // ============================================================
  function showAddSupplierDialog() {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'add-supplier-modal';

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>➕ 添加供应商</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>供应商名称 *</label><input type="text" id="new-supp-name" placeholder="请输入名称"></div>' +
      '<div class="form-field"><label>联系方式</label><input type="text" id="new-supp-contact" placeholder="电话/邮箱"></div>' +
      '<div class="form-field"><label>地址</label><input type="text" id="new-supp-address" placeholder="地址"></div>' +
      '<div class="form-field"><label>提供材料</label><input type="text" id="new-supp-materials" placeholder="如: 钢材,木材,油漆"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="new-supp-remark" rows="2"></textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'add-supplier-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmAddSupplier()">确认添加</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
  }

  function confirmAddSupplier() {
    var name = document.getElementById('new-supp-name').value.trim();
    var contact = document.getElementById('new-supp-contact').value.trim();
    var address = document.getElementById('new-supp-address').value.trim();
    var materials = document.getElementById('new-supp-materials').value.trim();
    var remark = document.getElementById('new-supp-remark').value.trim();

    if (!name) { showToast('请输入供应商名称', 'error'); return; }

    var supplier = {
      name: name,
      contact: contact,
      address: address,
      materials: materials,
      remark: remark,
      created_at: now(),
      updated_at: now()
    };

    addToStore('suppliers', supplier).then(function() {
      showToast('供应商添加成功！');
      document.getElementById('add-supplier-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('添加失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 编辑供应商弹窗
  // ============================================================
  function showEditSupplierDialog(id) {
    var supplier = state.suppliers.find(function(s) { return s.id === id; });
    if (!supplier) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'edit-supplier-modal';

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>✏️ 编辑供应商</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>供应商名称 *</label><input type="text" id="edit-supp-name" value="' + escapeHtml(supplier.name) + '"></div>' +
      '<div class="form-field"><label>联系方式</label><input type="text" id="edit-supp-contact" value="' + escapeHtml(supplier.contact || '') + '"></div>' +
      '<div class="form-field"><label>地址</label><input type="text" id="edit-supp-address" value="' + escapeHtml(supplier.address || '') + '"></div>' +
      '<div class="form-field"><label>提供材料</label><input type="text" id="edit-supp-materials" value="' + escapeHtml(supplier.materials || '') + '"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="edit-supp-remark" rows="2">' + escapeHtml(supplier.remark || '') + '</textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'edit-supplier-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmEditSupplier(' + id + ')">保存修改</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
  }

  function confirmEditSupplier(id) {
    var supplier = state.suppliers.find(function(s) { return s.id === id; });
    if (!supplier) return;

    supplier.name = document.getElementById('edit-supp-name').value.trim();
    supplier.contact = document.getElementById('edit-supp-contact').value.trim();
    supplier.address = document.getElementById('edit-supp-address').value.trim();
    supplier.materials = document.getElementById('edit-supp-materials').value.trim();
    supplier.remark = document.getElementById('edit-supp-remark').value.trim();
    supplier.updated_at = now();

    if (!supplier.name) { showToast('请输入供应商名称', 'error'); return; }

    updateInStore('suppliers', supplier).then(function() {
      showToast('供应商信息已更新！');
      document.getElementById('edit-supplier-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('更新失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 供应商供货记录
  // ============================================================
  function showSupplierRecords(id) {
    var supplier = state.suppliers.find(function(s) { return s.id === id; });
    if (!supplier) return;

    var records = state.materialInbounds.filter(function(r) { return r.supplier_id === id; });

    var overlay = document.createElement('div');
    overlay.className = 'detail-overlay';
    overlay.id = 'supplier-records-modal';

    var html = '<div class="detail-dialog" style="min-width:600px;">' +
      '<h3>📋 供货记录 - ' + escapeHtml(supplier.name) + '</h3>';

    if (records.length === 0) {
      html += '<p style="text-align:center;color:#999;padding:20px;">暂无供货记录</p>';
    } else {
      html += '<table class="data-table" style="font-size:13px;">' +
        '<thead><tr><th>日期</th><th>原材料</th><th>数量</th><th>单价</th><th>总价</th><th>操作人</th></tr></thead><tbody>';
      records.forEach(function(r) {
        var mat = state.materials.find(function(m) { return m.id === r.material_id; });
        html += '<tr>' +
          '<td>' + formatDate(r.created_at) + '</td>' +
          '<td>' + (mat ? escapeHtml(mat.name) : '已删除') + '</td>' +
          '<td>' + r.quantity + '</td>' +
          '<td>' + (r.unit_price || 0).toFixed(2) + '</td>' +
          '<td>' + (r.total_price || 0).toFixed(2) + '</td>' +
          '<td>' + escapeHtml(r.operator || '-') + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div class="detail-actions"><button class="btn" onclick="document.getElementById(\'supplier-records-modal\').remove()">关闭</button></div></div>';

    overlay.innerHTML = html;
    document.body.appendChild(overlay);
  }

  // ============================================================
  // 删除供应商
  // ============================================================
  function deleteSupplier(id) {
    if (!confirm('确定要删除该供应商吗？')) return;
    deleteFromStore('suppliers', id).then(function() {
      showToast('删除成功');
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('删除失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 车间管理页面
  // ============================================================
  function renderWorkshopsPage(container) {
    var html = '<div class="page-container">' +
      '<div class="page-header">' +
      '<h1>🏗️ 车间管理</h1>' +
      '<div class="header-actions">' +
      '<button class="btn btn-primary" onclick="window.__newModule.showAddWorkshopDialog()">➕ 添加车间</button>' +
      '<button class="btn" onclick="window.__newModule.refreshWorkshops()">🔄 刷新</button>' +
      '</div>' +
      '</div>';

    html += '<table class="data-table">' +
      '<thead><tr>' +
      '<th>车间名称</th><th>负责人</th><th>联系方式</th><th>备注</th><th>操作</th>' +
      '</tr></thead><tbody>';

    if (state.workshops.length === 0) {
      html += '<tr><td colspan="5" style="text-align:center;padding:40px;color:#999;">暂无车间信息，点击"添加车间"开始添加</td></tr>';
    } else {
      state.workshops.forEach(function(w) {
        html += '<tr>' +
          '<td><strong>' + escapeHtml(w.name) + '</strong></td>' +
          '<td>' + escapeHtml(w.manager || '-') + '</td>' +
          '<td>' + escapeHtml(w.phone || '-') + '</td>' +
          '<td>' + escapeHtml(w.remark || '-') + '</td>' +
          '<td>' +
          '<div class="table-actions">' +
          '<button class="btn-link" onclick="window.__newModule.showEditWorkshopDialog(' + w.id + ')">编辑</button>' +
          '<button class="btn-link danger" onclick="window.__newModule.deleteWorkshop(' + w.id + ')">删除</button>' +
          '</div>' +
          '</td></tr>';
      });
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  function showAddWorkshopDialog() {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'add-workshop-modal';

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>➕ 添加车间</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>车间名称 *</label><input type="text" id="new-ws-name" placeholder="请输入车间名称"></div>' +
      '<div class="form-field"><label>负责人</label><input type="text" id="new-ws-manager" placeholder="负责人姓名"></div>' +
      '<div class="form-field"><label>联系方式</label><input type="text" id="new-ws-phone" placeholder="电话"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="new-ws-remark" rows="2"></textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'add-workshop-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmAddWorkshop()">确认添加</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
  }

  function confirmAddWorkshop() {
    var name = document.getElementById('new-ws-name').value.trim();
    var manager = document.getElementById('new-ws-manager').value.trim();
    var phone = document.getElementById('new-ws-phone').value.trim();
    var remark = document.getElementById('new-ws-remark').value.trim();

    if (!name) { showToast('请输入车间名称', 'error'); return; }

    var workshop = {
      name: name,
      manager: manager,
      phone: phone,
      remark: remark,
      created_at: now(),
      updated_at: now()
    };

    addToStore('workshops', workshop).then(function() {
      showToast('车间添加成功！');
      document.getElementById('add-workshop-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('添加失败: ' + err.message, 'error');
    });
  }

  function showEditWorkshopDialog(id) {
    var workshop = state.workshops.find(function(w) { return w.id === id; });
    if (!workshop) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'edit-workshop-modal';

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>✏️ 编辑车间</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>车间名称 *</label><input type="text" id="edit-ws-name" value="' + escapeHtml(workshop.name) + '"></div>' +
      '<div class="form-field"><label>负责人</label><input type="text" id="edit-ws-manager" value="' + escapeHtml(workshop.manager || '') + '"></div>' +
      '<div class="form-field"><label>联系方式</label><input type="text" id="edit-ws-phone" value="' + escapeHtml(workshop.phone || '') + '"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="edit-ws-remark" rows="2">' + escapeHtml(workshop.remark || '') + '</textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'edit-workshop-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmEditWorkshop(' + id + ')">保存修改</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
  }

  function confirmEditWorkshop(id) {
    var workshop = state.workshops.find(function(w) { return w.id === id; });
    if (!workshop) return;

    workshop.name = document.getElementById('edit-ws-name').value.trim();
    workshop.manager = document.getElementById('edit-ws-manager').value.trim();
    workshop.phone = document.getElementById('edit-ws-phone').value.trim();
    workshop.remark = document.getElementById('edit-ws-remark').value.trim();
    workshop.updated_at = now();

    if (!workshop.name) { showToast('请输入车间名称', 'error'); return; }

    updateInStore('workshops', workshop).then(function() {
      showToast('车间信息已更新！');
      document.getElementById('edit-workshop-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('更新失败: ' + err.message, 'error');
    });
  }

  function deleteWorkshop(id) {
    if (!confirm('确定要删除该车间吗？')) return;
    deleteFromStore('workshops', id).then(function() {
      showToast('删除成功');
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('删除失败: ' + err.message, 'error');
    });
  }

  function refreshWorkshops() {
    loadAllData().then(function() { renderPage('workshops'); });
  }

  // ============================================================
  // 生产管理页面
  // ============================================================
  function renderProductionsPage(container) {
    var html = '<div class="page-container">' +
      '<div class="page-header">' +
      '<h1>⚙️ 生产任务管理</h1>' +
      '<div class="header-actions">' +
      '<button class="btn btn-primary" onclick="window.__newModule.showCreateProductionDialog()">➕ 新建生产任务</button>' +
      '<button class="btn" onclick="window.__newModule.refreshProductions()">🔄 刷新</button>' +
      '</div>' +
      '</div>';

    // 统计卡片
    var total = state.productions.length;
    var pending = state.productions.filter(function(p) { return p.status === 'pending'; }).length;
    var inProgress = state.productions.filter(function(p) { return p.status === 'production'; }).length;
    var completed = state.productions.filter(function(p) { return p.status === 'completed'; }).length;

    html += '<div class="stats-row">' +
      '<div class="stat-card"><div class="stat-value">' + total + '</div><div class="stat-label">总任务数</div></div>' +
      '<div class="stat-card warning"><div class="stat-value">' + pending + '</div><div class="stat-label">待生产</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + inProgress + '</div><div class="stat-label">生产中</div></div>' +
      '<div class="stat-card success"><div class="stat-value">' + completed + '</div><div class="stat-label">已完成</div></div>' +
      '</div>';

    html += '<div class="filter-bar">' +
      '<span class="filter-label">🔍</span>' +
      '<input type="text" id="production-search" placeholder="搜索订单号或负责人..." oninput="window.__newModule.filterProductions()">' +
      '<span class="filter-label">状态</span>' +
      '<select id="production-status-filter" onchange="window.__newModule.filterProductions()">' +
      '<option value="">全部</option>' +
      '<option value="pending">待生产</option>' +
      '<option value="production">生产中</option>' +
      '<option value="completed">已完成</option>' +
      '<option value="warehoused">成品入库</option>' +
      '<option value="shipped">已出库</option>' +
      '</select>' +
      '</div>';

    html += '<table class="data-table">' +
      '<thead><tr>' +
      '<th>订单编号</th><th>生产负责人</th><th>状态</th><th>开始时间</th><th>完成时间</th><th>操作</th>' +
      '</tr></thead><tbody>';

    var filtered = getFilteredProductions();
    if (filtered.length === 0) {
      html += '<tr><td colspan="6" style="text-align:center;padding:40px;color:#999;">暂无生产任务</td></tr>';
    } else {
      filtered.forEach(function(p) {
        var statusMap = { pending: '待生产', production: '生产中', completed: '已完成', warehoused: '成品入库', shipped: '已出库' };
        var statusText = statusMap[p.status] || p.status;
        html += '<tr>' +
          '<td><strong>' + escapeHtml(p.order_no || '订单#' + p.order_id) + '</strong></td>' +
          '<td>' + escapeHtml(p.manager || '-') + '</td>' +
          '<td><span class="status-badge ' + p.status + '">' + statusText + '</span></td>' +
          '<td>' + (p.start_time ? formatDate(p.start_time) : '-') + '</td>' +
          '<td>' + (p.finish_time ? formatDate(p.finish_time) : '-') + '</td>' +
          '<td>' +
          '<div class="table-actions">' +
          getProductionActions(p) +
          '<button class="btn-link" onclick="window.__newModule.showProductionDetail(' + p.id + ')">详情</button>' +
          '</div>' +
          '</td></tr>';
      });
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  function getFilteredProductions() {
    var list = state.productions.slice();
    var keyword = '';
    var searchEl = document.getElementById('production-search');
    if (searchEl) keyword = searchEl.value.toLowerCase();
    var statusFilter = '';
    var statusEl = document.getElementById('production-status-filter');
    if (statusEl) statusFilter = statusEl.value;

    if (keyword) {
      list = list.filter(function(p) {
        return (p.order_no || '').toLowerCase().indexOf(keyword) >= 0 ||
               (p.manager || '').toLowerCase().indexOf(keyword) >= 0;
      });
    }
    if (statusFilter) {
      list = list.filter(function(p) { return p.status === statusFilter; });
    }
    return list;
  }

  function getProductionActions(p) {
    var actions = '';
    switch (p.status) {
      case 'pending':
        actions += '<button class="btn-link" onclick="window.__newModule.startProduction(' + p.id + ')">开始生产</button>';
        break;
      case 'production':
        actions += '<button class="btn-link" onclick="window.__newModule.showAddMaterialToProduction(' + p.id + ')">领料</button>';
        actions += '<button class="btn-link" onclick="window.__newModule.completeProduction(' + p.id + ')">完成生产</button>';
        break;
      case 'completed':
        actions += '<button class="btn-link" onclick="window.__newModule.showWarehouseDialog(' + p.id + ')">成品入库</button>';
        break;
      case 'warehoused':
        actions += '<button class="btn-link" onclick="window.__newModule.showShipDialog(' + p.id + ')">出库发货</button>';
        break;
    }
    return actions;
  }

  // ============================================================
  // 新建生产任务
  // ============================================================
  function showCreateProductionDialog() {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'create-production-modal';

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>➕ 新建生产任务</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>订单编号 *</label><input type="text" id="prod-order-no" list="production-orders" placeholder="选择或输入订单编号"><datalist id="production-orders"></datalist></div>' +
      '<div class="form-field"><label>生产负责人 *</label><input type="text" id="prod-manager" placeholder="负责人姓名"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="prod-remark" rows="2"></textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'create-production-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmCreateProduction()">确认创建</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
    window.electronAPI.getOrders().then(function(orders) {
      var list = document.getElementById('production-orders');
      if (list) list.innerHTML = orders.map(function(o) {
        return '<option value="' + escapeHtml(o.orderNo || o.documentNo) + '">' + escapeHtml(o.receiver) + '</option>';
      }).join('');
    }).catch(function(error) { showToast('加载订单失败：' + error.message, 'error'); });
  }

  async function confirmCreateProduction() {
    var orderNo = document.getElementById('prod-order-no').value.trim();
    var manager = document.getElementById('prod-manager').value.trim();
    var remark = document.getElementById('prod-remark').value.trim();

    if (!orderNo) { showToast('请输入订单编号', 'error'); return; }
    if (!manager) { showToast('请输入生产负责人', 'error'); return; }

    var linkedOrder;
    try {
      var orders = await window.electronAPI.getOrders();
      linkedOrder = orders.find(function(o) { return (o.orderNo || o.documentNo) === orderNo; });
    } catch (error) { showToast('加载订单失败：' + error.message, 'error'); return; }
    var production = {
      order_no: orderNo,
      order_id: linkedOrder ? linkedOrder.id : 0,
      manager: manager,
      status: 'pending',
      start_time: null,
      finish_time: null,
      remark: remark,
      created_at: now(),
      updated_at: now()
    };

    addToStore('productions', production).then(function() {
      showToast('生产任务创建成功！');
      document.getElementById('create-production-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('创建失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 开始生产
  // ============================================================
  function startProduction(id) {
    if (!confirm('确定开始该生产任务吗？')) return;

    var p = state.productions.find(function(x) { return x.id === id; });
    if (!p) return;

    p.status = 'production';
    p.start_time = now();
    p.updated_at = now();

    updateInStore('productions', p).then(function() {
      showToast('生产任务已开始！');
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('操作失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 完成生产
  // ============================================================
  function completeProduction(id) {
    if (!confirm('确定完成该生产任务吗？')) return;

    var p = state.productions.find(function(x) { return x.id === id; });
    if (!p) return;

    p.status = 'completed';
    p.finish_time = now();
    p.updated_at = now();

    updateInStore('productions', p).then(function() {
      showToast('生产任务已完成！');
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('操作失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 生产领料
  // ============================================================
  function showAddMaterialToProduction(productionId) {
    var p = state.productions.find(function(x) { return x.id === productionId; });
    if (!p) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'add-pm-modal';

    var matOptions = state.materials.map(function(m) {
      return '<option value="' + m.id + '">' + escapeHtml(m.name) + ' (' + escapeHtml(m.spec || '') + ') - 库存: ' + (m.quantity || 0) + ' ' + escapeHtml(m.unit || '') + '</option>';
    }).join('');

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>📋 领料 - ' + escapeHtml(p.order_no || '订单#' + p.order_id) + '</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>原材料 *</label><select id="pm-material-id">' + matOptions + '</select></div>' +
      '<div class="form-field"><label>使用数量 *</label><input type="number" id="pm-qty" min="0.01" step="0.01" value="1"></div>' +
      '<div class="form-field"><label>车间 *</label><select id="pm-workshop-id">' + workshopOptions() + '</select></div>' +
      '<div class="form-field"><label>操作人员</label><input type="text" id="pm-operator" value="管理员"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="pm-remark" rows="2" placeholder="如: 用于生产 ' + escapeHtml(p.order_no || '') + '"></textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'add-pm-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmAddMaterialToProduction(' + productionId + ')">确认领料</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
  }

  function confirmAddMaterialToProduction(productionId) {
    var materialId = parseInt(document.getElementById('pm-material-id').value);
    var qty = parseFloat(document.getElementById('pm-qty').value);
    var workshopId = document.getElementById('pm-workshop-id').value ? parseInt(document.getElementById('pm-workshop-id').value) : null;
    var operator = document.getElementById('pm-operator').value || '管理员';
    var remark = document.getElementById('pm-remark').value || '';

    if (!materialId) { showToast('请选择原材料', 'error'); return; }
    if (!qty || qty <= 0) { showToast('请输入有效的领料数量', 'error'); return; }
    if (!workshopId) { showToast('请选择车间', 'error'); return; }

    var workshop = state.workshops.find(function(w) { return w.id === workshopId; });
    var material = state.materials.find(function(m) { return m.id === materialId; });
    if (!material) { showToast('原材料不存在', 'error'); return; }

    var beforeQty = material.quantity || 0;
    if (qty > beforeQty) { showToast('库存不足！当前库存: ' + beforeQty, 'error'); return; }

    var afterQty = beforeQty - qty;
    material.quantity = afterQty;
    material.updated_at = now();

    var pmRecord = {
      production_id: productionId,
      material_id: materialId,
      quantity: qty,
      workshop_id: workshopId,
      workshop_name: workshop ? workshop.name : '',
      created_at: now()
    };

    var outboundRecord = {
      material_id: materialId,
      quantity: qty,
      production_id: productionId,
      workshop_id: workshopId,
      workshop_name: workshop ? workshop.name : '',
      operator: operator,
      remark: '生产领料: ' + remark,
      created_at: now()
    };

    var remarkWithWorkshop = (workshop ? '车间: ' + workshop.name + '; ' : '') + '生产领料: ' + remark;

    updateInStore('materials', material).then(function() {
      return addToStore('production_materials', pmRecord);
    }).then(function() {
      return addToStore('material_outbound', outboundRecord);
    }).then(function() {
      return addStockLog('material', materialId, material.name, 'production_use', -qty, beforeQty, afterQty, operator, remarkWithWorkshop);
    }).then(function() {
      showToast('领料成功！' + material.name + ' -' + qty + ' ' + (material.unit || ''));
      document.getElementById('add-pm-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('领料失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 生产详情
  // ============================================================
  function showProductionDetail(id) {
    var p = state.productions.find(function(x) { return x.id === id; });
    if (!p) return;

    var statusMap = { pending: '待生产', production: '生产中', completed: '已完成', warehoused: '成品入库', shipped: '已出库' };

    // 获取用料记录
    getByIndex('production_materials', 'production_id', id).then(function(pmRecords) {
      var overlay = document.createElement('div');
      overlay.className = 'detail-overlay';
      overlay.id = 'prod-detail-modal';

      var html = '<div class="detail-dialog" style="min-width:600px;">' +
        '<h3>📋 生产任务详情</h3>' +
        '<div class="detail-row"><span class="detail-label">订单编号</span><span class="detail-value"><strong>' + escapeHtml(p.order_no || '') + '</strong></span></div>' +
        '<div class="detail-row"><span class="detail-label">生产负责人</span><span class="detail-value">' + escapeHtml(p.manager || '-') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">状态</span><span class="detail-value"><span class="status-badge ' + p.status + '">' + (statusMap[p.status] || p.status) + '</span></span></div>' +
        '<div class="detail-row"><span class="detail-label">开始时间</span><span class="detail-value">' + (p.start_time ? formatDate(p.start_time) : '-') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">完成时间</span><span class="detail-value">' + (p.finish_time ? formatDate(p.finish_time) : '-') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">备注</span><span class="detail-value">' + escapeHtml(p.remark || '-') + '</span></div>' +
        '<h4 style="margin-top:16px;margin-bottom:8px;font-size:15px;color:#333;">📦 用料清单</h4>';

      if (pmRecords.length === 0) {
        html += '<p style="color:#999;padding:12px 0;">暂无领料记录</p>';
      } else {
        html += '<table class="data-table" style="font-size:13px;">' +
          '<thead><tr><th>材料名称</th><th>规格</th><th>使用数量</th><th>单位</th><th>领料时间</th></tr></thead><tbody>';
        pmRecords.forEach(function(r) {
          var mat = state.materials.find(function(m) { return m.id === r.material_id; });
          html += '<tr>' +
            '<td>' + (mat ? escapeHtml(mat.name) : '已删除') + '</td>' +
            '<td>' + (mat ? escapeHtml(mat.spec || '-') : '-') + '</td>' +
            '<td>' + r.quantity + '</td>' +
            '<td>' + (mat ? escapeHtml(mat.unit || '-') : '-') + '</td>' +
            '<td>' + formatDate(r.created_at) + '</td></tr>';
        });
        html += '</tbody></table>';
      }

      html += '<div class="detail-actions"><button class="btn" onclick="document.getElementById(\'prod-detail-modal\').remove()">关闭</button></div></div>';

      overlay.innerHTML = html;
      document.body.appendChild(overlay);
    });
  }

  // ============================================================
  // 成品入库弹窗
  // ============================================================
  function showWarehouseDialog(productionId) {
    var p = state.productions.find(function(x) { return x.id === productionId; });
    if (!p) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'warehouse-modal';

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>🏗️ 成品入库 - ' + escapeHtml(p.order_no || '') + '</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>产品名称 *</label><input type="text" id="fp-name" placeholder="成品名称" value="' + escapeHtml(p.order_no || '') + '成品"></div>' +
      '<div class="form-field"><label>入库数量 *</label><input type="number" id="fp-qty" min="0.01" step="0.01" value="1"></div>' +
      '<div class="form-field"><label>操作人员</label><input type="text" id="fp-operator" value="管理员"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="fp-remark" rows="2"></textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'warehouse-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmWarehouse(' + productionId + ')">确认入库</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
  }

  function confirmWarehouse(productionId) {
    var p = state.productions.find(function(x) { return x.id === productionId; });
    if (!p) return;

    var name = document.getElementById('fp-name').value.trim();
    var qty = parseFloat(document.getElementById('fp-qty').value);
    var operator = document.getElementById('fp-operator').value || '管理员';
    var remark = document.getElementById('fp-remark').value.trim();

    if (!name) { showToast('请输入产品名称', 'error'); return; }
    if (!qty || qty <= 0) { showToast('请输入有效的入库数量', 'error'); return; }

    // 检查是否已有该订单的成品记录
    getByIndex('finished_products', 'order_id', p.order_id || 0).then(function(existing) {
      if (existing && existing.length > 0) {
        // 更新现有成品
        var fp = existing[0];
        var beforeQty = fp.quantity || 0;
        fp.quantity = beforeQty + qty;
        fp.updated_at = now();

        return updateInStore('finished_products', fp).then(function() {
          return { fp: fp, beforeQty: beforeQty, isNew: false };
        });
      } else {
        // 新建成品记录
        var fp = {
          product_name: name,
          quantity: qty,
          order_id: p.order_id || 0,
          order_no: p.order_no,
          production_id: productionId,
          remark: remark,
          created_at: now(),
          updated_at: now()
        };
        return addToStore('finished_products', fp).then(function(id) {
          fp.id = id;
          return { fp: fp, beforeQty: 0, isNew: true };
        });
      }
    }).then(function(result) {
      // 更新生产状态
      p.status = 'warehoused';
      p.updated_at = now();
      return updateInStore('productions', p).then(function() {
        return result;
      });
    }).then(function(result) {
      // 记录日志
      var log = {
        product_id: result.fp.id,
        type: 'inbound',
        quantity: qty,
        order_id: p.order_id || 0,
        operator: operator,
        remark: '生产入库: ' + remark,
        created_at: now()
      };
      return addToStore('finished_product_logs', log).then(function() {
        return addStockLog('finished_product', result.fp.id, result.fp.product_name, 'inbound', qty, result.beforeQty, result.beforeQty + qty, operator, '生产入库');
      });
    }).then(function() {
      showToast('成品入库成功！');
      document.getElementById('warehouse-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('入库失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 出库发货弹窗
  // ============================================================
  function showShipDialog(productionId) {
    var p = state.productions.find(function(x) { return x.id === productionId; });
    if (!p) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'ship-modal';

    // 查找该订单的成品
    getByIndex('finished_products', 'order_id', p.order_id || 0).then(function(products) {
      var fpOptions = products.map(function(fp) {
        return '<option value="' + fp.id + '">' + escapeHtml(fp.product_name) + ' - 库存: ' + (fp.quantity || 0) + '</option>';
      }).join('');

      if (!fpOptions) {
        fpOptions = '<option value="">暂无成品库存</option>';
      }

      overlay.innerHTML = '<div class="modal-dialog">' +
        '<h3>🚚 出库发货 - ' + escapeHtml(p.order_no || '') + '</h3>' +
        '<div class="modal-body">' +
        '<div class="form-grid">' +
        '<div class="form-field"><label>成品 *</label><select id="ship-product-id">' + fpOptions + '</select></div>' +
        '<div class="form-field"><label>出库数量 *</label><input type="number" id="ship-qty" min="0.01" step="0.01" value="1"></div>' +
        '<div class="form-field"><label>车间 *</label><select id="ship-workshop-id">' + workshopOptions() + '</select></div>' +
        '<div class="form-field"><label>操作人员</label><input type="text" id="ship-operator" value="管理员"></div>' +
        '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="ship-remark" rows="2"></textarea></div>' +
        '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn" onclick="document.getElementById(\'ship-modal\').remove()">取消</button>' +
        '<button class="btn btn-primary" onclick="window.__newModule.confirmShip(' + productionId + ')">确认出库</button>' +
        '</div></div>';

      document.body.appendChild(overlay);
    });
  }

  function confirmShip(productionId) {
    var p = state.productions.find(function(x) { return x.id === productionId; });
    if (!p) return;

    var productId = parseInt(document.getElementById('ship-product-id').value);
    var qty = parseFloat(document.getElementById('ship-qty').value);
    var workshopId = document.getElementById('ship-workshop-id').value ? parseInt(document.getElementById('ship-workshop-id').value) : null;
    var operator = document.getElementById('ship-operator').value || '管理员';
    var remark = document.getElementById('ship-remark').value.trim();

    if (!productId) { showToast('请选择成品', 'error'); return; }
    if (!qty || qty <= 0) { showToast('请输入有效的出库数量', 'error'); return; }
    if (!workshopId) { showToast('请选择车间', 'error'); return; }

    var workshop = state.workshops.find(function(w) { return w.id === workshopId; });
    var fp = state.finishedProducts.find(function(x) { return x.id === productId; });
    if (!fp) { showToast('成品不存在', 'error'); return; }

    var beforeQty = fp.quantity || 0;
    if (qty > beforeQty) { showToast('库存不足！当前库存: ' + beforeQty, 'error'); return; }

    var afterQty = beforeQty - qty;
    fp.quantity = afterQty;
    fp.updated_at = now();

    p.status = 'shipped';
    p.updated_at = now();

    var remarkWithWorkshop = (workshop ? '车间: ' + workshop.name + '; ' : '') + '出库发货: ' + remark;

    var log = {
      product_id: productId,
      type: 'outbound',
      quantity: qty,
      order_id: p.order_id || 0,
      workshop_id: workshopId,
      workshop_name: workshop ? workshop.name : '',
      operator: operator,
      remark: remarkWithWorkshop,
      created_at: now()
    };

    updateInStore('finished_products', fp).then(function() {
      return updateInStore('productions', p);
    }).then(function() {
      return addToStore('finished_product_logs', log);
    }).then(function() {
      return addStockLog('finished_product', fp.id, fp.product_name, 'outbound', -qty, beforeQty, afterQty, operator, remarkWithWorkshop);
    }).then(function() {
      showToast('出库成功！' + fp.product_name + ' -' + qty);
      document.getElementById('ship-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('出库失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 成品管理页面
  // ============================================================
  function renderFinishedProductsPage(container) {
    var html = '<div class="page-container">' +
      '<div class="page-header">' +
      '<h1>🏗️ 成品管理</h1>' +
      '<div class="header-actions">' +
      '<button class="btn" onclick="window.__newModule.refreshFinishedProducts()">🔄 刷新</button>' +
      '</div>' +
      '</div>';

    // 统计
    var total = state.finishedProducts.length;
    var totalQty = state.finishedProducts.reduce(function(s, fp) { return s + (fp.quantity || 0); }, 0);

    html += '<div class="stats-row">' +
      '<div class="stat-card"><div class="stat-value">' + total + '</div><div class="stat-label">成品种类</div></div>' +
      '<div class="stat-card success"><div class="stat-value">' + totalQty.toFixed(1) + '</div><div class="stat-label">总库存量</div></div>' +
      '</div>';

    // 子导航
    html += '<div class="sub-nav">' +
      '<button class="sub-nav-item ' + (state.currentSubPage === 'list' ? 'active' : '') + '" onclick="window.__newModule.setCurrentSubPage(\'list\')">成品库存</button>' +
      '<button class="sub-nav-item ' + (state.currentSubPage === 'inbound' ? 'active' : '') + '" onclick="window.__newModule.setCurrentSubPage(\'inbound\')">入库记录</button>' +
      '<button class="sub-nav-item ' + (state.currentSubPage === 'outbound' ? 'active' : '') + '" onclick="window.__newModule.setCurrentSubPage(\'outbound\')">出库记录</button>' +
      '</div>';

    if (state.currentSubPage === 'list') {
      html += renderFinishedProductList();
    } else if (state.currentSubPage === 'inbound') {
      html += renderFinishedProductInboundLogs();
    } else if (state.currentSubPage === 'outbound') {
      html += renderFinishedProductOutboundLogs();
    }

    html += '</div>';
    container.innerHTML = html;
  }

  function renderFinishedProductList() {
    var html = '<table class="data-table">' +
      '<thead><tr>' +
      '<th>产品名称</th><th>库存数量</th><th>来源订单</th><th>入库时间</th><th>操作</th>' +
      '</tr></thead><tbody>';

    if (state.finishedProducts.length === 0) {
      html += '<tr><td colspan="5" style="text-align:center;padding:40px;color:#999;">暂无成品库存</td></tr>';
    } else {
      state.finishedProducts.forEach(function(fp) {
        html += '<tr>' +
          '<td><strong>' + escapeHtml(fp.product_name) + '</strong></td>' +
          '<td style="font-weight:700;">' + (fp.quantity || 0) + '</td>' +
          '<td>' + escapeHtml(fp.order_no || '-') + '</td>' +
          '<td>' + formatDate(fp.created_at) + '</td>' +
          '<td>' +
          '<div class="table-actions">' +
          '<button class="btn-link" onclick="window.__newModule.showManualOutboundDialog(' + fp.id + ')">出库</button>' +
          '</div>' +
          '</td></tr>';
      });
    }

    html += '</tbody></table>';
    return html;
  }

  function renderFinishedProductInboundLogs() {
    var logs = state.finishedProductLogs.filter(function(l) { return l.type === 'inbound'; });
    var html = '<table class="data-table">' +
      '<thead><tr><th>时间</th><th>成品名称</th><th>数量</th><th>来源订单</th><th>操作人</th><th>备注</th></tr></thead><tbody>';

    if (logs.length === 0) {
      html += '<tr><td colspan="6" style="text-align:center;padding:40px;color:#999;">暂无入库记录</td></tr>';
    } else {
      logs.forEach(function(l) {
        var fp = state.finishedProducts.find(function(x) { return x.id === l.product_id; });
        html += '<tr>' +
          '<td>' + formatDate(l.created_at) + '</td>' +
          '<td>' + (fp ? escapeHtml(fp.product_name) : '已删除') + '</td>' +
          '<td style="color:#52c41a;font-weight:700;">+' + l.quantity + '</td>' +
          '<td>' + (fp ? escapeHtml(fp.order_no || '-') : '-') + '</td>' +
          '<td>' + escapeHtml(l.operator || '-') + '</td>' +
          '<td>' + escapeHtml(l.remark || '-') + '</td></tr>';
      });
    }

    html += '</tbody></table>';
    return html;
  }

  function renderFinishedProductOutboundLogs() {
    var logs = state.finishedProductLogs.filter(function(l) { return l.type === 'outbound'; });
    var html = '<table class="data-table">' +
      '<thead><tr><th>时间</th><th>成品名称</th><th>数量</th><th>关联订单</th><th>操作人</th><th>备注</th></tr></thead><tbody>';

    if (logs.length === 0) {
      html += '<tr><td colspan="6" style="text-align:center;padding:40px;color:#999;">暂无出库记录</td></tr>';
    } else {
      logs.forEach(function(l) {
        var fp = state.finishedProducts.find(function(x) { return x.id === l.product_id; });
        html += '<tr>' +
          '<td>' + formatDate(l.created_at) + '</td>' +
          '<td>' + (fp ? escapeHtml(fp.product_name) : '已删除') + '</td>' +
          '<td style="color:#cf1322;font-weight:700;">-' + l.quantity + '</td>' +
          '<td>' + (fp ? escapeHtml(fp.order_no || '-') : '-') + '</td>' +
          '<td>' + escapeHtml(l.operator || '-') + '</td>' +
          '<td>' + escapeHtml(l.remark || '-') + '</td></tr>';
      });
    }

    html += '</tbody></table>';
    return html;
  }

  // ============================================================
  // 手动成品出库弹窗
  // ============================================================
  function showManualOutboundDialog(productId) {
    var fp = state.finishedProducts.find(function(x) { return x.id === productId; });
    if (!fp) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'manual-outbound-modal';

    overlay.innerHTML = '<div class="modal-dialog">' +
      '<h3>🚚 成品出库 - ' + escapeHtml(fp.product_name) + '</h3>' +
      '<div class="modal-body">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label>当前库存</label><input type="text" value="' + (fp.quantity || 0) + '" readonly></div>' +
      '<div class="form-field"><label>出库数量 *</label><input type="number" id="mo-qty" min="0.01" step="0.01" value="1"></div>' +
      '<div class="form-field"><label>车间 *</label><select id="mo-workshop-id">' + workshopOptions() + '</select></div>' +
      '<div class="form-field"><label>操作人员</label><input type="text" id="mo-operator" value="管理员"></div>' +
      '<div class="form-field" style="grid-column:1/-1"><label>备注</label><textarea id="mo-remark" rows="2"></textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn" onclick="document.getElementById(\'manual-outbound-modal\').remove()">取消</button>' +
      '<button class="btn btn-primary" onclick="window.__newModule.confirmManualOutbound(' + productId + ')">确认出库</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
  }

  function confirmManualOutbound(productId) {
    var fp = state.finishedProducts.find(function(x) { return x.id === productId; });
    if (!fp) return;

    var qty = parseFloat(document.getElementById('mo-qty').value);
    var workshopId = document.getElementById('mo-workshop-id').value ? parseInt(document.getElementById('mo-workshop-id').value) : null;
    var operator = document.getElementById('mo-operator').value || '管理员';
    var remark = document.getElementById('mo-remark').value.trim();

    if (!qty || qty <= 0) { showToast('请输入有效的出库数量', 'error'); return; }
    if (!workshopId) { showToast('请选择车间', 'error'); return; }

    var workshop = state.workshops.find(function(w) { return w.id === workshopId; });

    var beforeQty = fp.quantity || 0;
    if (qty > beforeQty) { showToast('库存不足！当前库存: ' + beforeQty, 'error'); return; }

    var afterQty = beforeQty - qty;
    fp.quantity = afterQty;
    fp.updated_at = now();

    var remarkWithWorkshop = (workshop ? '车间: ' + workshop.name + '; ' : '') + '手动出库: ' + remark;

    var log = {
      product_id: productId,
      type: 'outbound',
      quantity: qty,
      order_id: fp.order_id || 0,
      workshop_id: workshopId,
      workshop_name: workshop ? workshop.name : '',
      operator: operator,
      remark: remarkWithWorkshop,
      created_at: now()
    };

    updateInStore('finished_products', fp).then(function() {
      return addToStore('finished_product_logs', log);
    }).then(function() {
      return addStockLog('finished_product', fp.id, fp.product_name, 'outbound', -qty, beforeQty, afterQty, operator, remarkWithWorkshop);
    }).then(function() {
      showToast('出库成功！');
      document.getElementById('manual-outbound-modal').remove();
      return loadAllData();
    }).then(function() {
      renderPage(state.currentPage);
    }).catch(function(err) {
      showToast('出库失败: ' + err.message, 'error');
    });
  }

  // ============================================================
  // 收发存汇总表（可查看 + 打印）
  // ============================================================
  function renderReportPage(container) {
    var today = new Date().toISOString().slice(0, 10);
    var firstDay = today.slice(0, 8) + '01';

    var html = '<div class="page-container">' +
      '<div class="page-header">' +
      '<h1>📊 收发存汇总表</h1>' +
      '<div class="header-actions">' +
      '<button class="btn btn-primary" onclick="window.__newModule.printReport()">🖨️ 打印汇总表</button>' +
      '</div>' +
      '</div>' +
      '<div class="filter-bar">' +
      '<span class="filter-label">起始日期</span>' +
      '<input type="date" id="report-date-from" value="' + firstDay + '">' +
      '<span class="filter-label">结束日期</span>' +
      '<input type="date" id="report-date-to" value="' + today + '">' +
      '<button class="btn btn-primary" onclick="window.__newModule.queryReport()">🔍 查询</button>' +
      '</div>' +
      '<div id="report-content"><div class="loading">加载中...</div></div>' +
      '</div>';

    container.innerHTML = html;
    queryReport();
  }

  function getDateOnly(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var pad = function(n) { return n.toString().padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function queryReport() {
    var content = document.getElementById('report-content');
    if (!content) return;
    var fromEl = document.getElementById('report-date-from');
    var toEl = document.getElementById('report-date-to');
    var dateFrom = fromEl ? fromEl.value : '';
    var dateTo = toEl ? toEl.value : '';

    // �期初/入库/出库统计
    var matInboundByMat = {};   // 本期原材料入库
    var matOutboundByMat = {};  // 本期原材料出库
    var matBeforeByMat = {};    // 期初结存（之前累计 入库-出库）
    var matCumInbound = {};     // 累计入库
    var matCumOutbound = {};    // 累计出库

    state.materialInbounds.forEach(function(r) {
      var day = getDateOnly(r.created_at);
      var m = r.material_id;
      if (day < dateFrom) { matCumInbound[m] = (matCumInbound[m] || 0) + r.quantity; }
      if (day >= dateFrom && day <= dateTo) { matInboundByMat[m] = (matInboundByMat[m] || 0) + r.quantity; }
    });
    state.materialOutbounds.forEach(function(r) {
      var day = getDateOnly(r.created_at);
      var m = r.material_id;
      if (day < dateFrom) { matCumOutbound[m] = (matCumOutbound[m] || 0) + r.quantity; }
      if (day >= dateFrom && day <= dateTo) { matOutboundByMat[m] = (matOutboundByMat[m] || 0) + r.quantity; }
    });
    state.materials.forEach(function(mat) {
      var m = mat.id;
      matBeforeByMat[m] = (matCumInbound[m] || 0) - (matCumOutbound[m] || 0);
    });

    // 成品收发存：finished_product_logs 有 type=inbound/outbound
    var fpInboundById = {};     // 本期成品入库
    var fpOutboundById = {};    // 本期成品出库
    var fpBeforeById = {};      // 期初结存
    var fpCumInbound = {};
    var fpCumOutbound = {};

    state.finishedProductLogs.forEach(function(l) {
      var day = getDateOnly(l.created_at);
      var pid = l.product_id;
      if (l.type === 'inbound') {
        if (day < dateFrom) { fpCumInbound[pid] = (fpCumInbound[pid] || 0) + l.quantity; }
        if (day >= dateFrom && day <= dateTo) { fpInboundById[pid] = (fpInboundById[pid] || 0) + l.quantity; }
      } else if (l.type === 'outbound') {
        if (day < dateFrom) { fpCumOutbound[pid] = (fpCumOutbound[pid] || 0) + l.quantity; }
        if (day >= dateFrom && day <= dateTo) { fpOutboundById[pid] = (fpOutboundById[pid] || 0) + l.quantity; }
      }
    });
    state.finishedProducts.forEach(function(fp) {
      var pid = fp.id;
      fpBeforeById[pid] = (fpCumInbound[pid] || 0) - (fpCumOutbound[pid] || 0);
    });

    // 渲染
    var html = '';

    // 原材料收发存
    html += '<div class="report-section"><h2>📦 原材料收发存汇总（' + (dateFrom || '全部') + ' 至 ' + (dateTo || '全部') + '）</h2>';
    html += '<table class="data-table report-table">' +
      '<thead><tr><th>原材料</th><th>规格</th><th>单位</th><th>期初结存</th><th>本期入库</th><th>本期出库</th><th>期末结存</th></tr></thead><tbody>';
    var matRows = state.materials.slice();
    if (matRows.length === 0) {
      html += '<tr><td colspan="7" style="text-align:center;padding:30px;color:#999;">暂无原材料数据</td></tr>';
    } else {
      matRows.forEach(function(mat) {
        var before = matBeforeByMat[mat.id] || 0;
        var inbound = matInboundByMat[mat.id] || 0;
        var outbound = matOutboundByMat[mat.id] || 0;
        var closing = before + inbound - outbound;
        html += '<tr>' +
          '<td><strong>' + escapeHtml(mat.name) + '</strong></td>' +
          '<td>' + escapeHtml(mat.spec || '-') + '</td>' +
          '<td>' + escapeHtml(mat.unit || '-') + '</td>' +
          '<td>' + before + '</td>' +
          '<td style="color:#52c41a;">+' + inbound + '</td>' +
          '<td style="color:#cf1322;">-' + outbound + '</td>' +
          '<td style="font-weight:700;">' + closing + '</td></tr>';
      });
    }
    html += '</tbody></table></div>';

    // 成品收发存
    html += '<div class="report-section"><h2>🏗️ 成品收发存汇总（' + (dateFrom || '全部') + ' 至 ' + (dateTo || '全部') + '）</h2>';
    html += '<table class="data-table report-table">' +
      '<thead><tr><th>成品名称</th><th>来源订单</th><th>期初结存</th><th>本期入库</th><th>本期出库</th><th>期末结存</th></tr></thead><tbody>';
    var fpRows = state.finishedProducts.slice();
    if (fpRows.length === 0) {
      html += '<tr><td colspan="6" style="text-align:center;padding:30px;color:#999;">暂无成品数据</td></tr>';
    } else {
      fpRows.forEach(function(fp) {
        var before = fpBeforeById[fp.id] || 0;
        var inbound = fpInboundById[fp.id] || 0;
        var outbound = fpOutboundById[fp.id] || 0;
        var closing = before + inbound - outbound;
        html += '<tr>' +
          '<td><strong>' + escapeHtml(fp.product_name) + '</strong></td>' +
          '<td>' + escapeHtml(fp.order_no || '-') + '</td>' +
          '<td>' + before + '</td>' +
          '<td style="color:#52c41a;">+' + inbound + '</td>' +
          '<td style="color:#cf1322;">-' + outbound + '</td>' +
          '<td style="font-weight:700;">' + closing + '</td></tr>';
      });
    }
    html += '</tbody></table></div>';

    content.innerHTML = html;
  }

  function printReport() {
    var content = document.getElementById('report-content');
    if (!content || content.innerHTML.trim() === '' || content.innerHTML.indexOf('加载中') >= 0) {
      showToast('请先查询汇总数据', 'error');
      return;
    }
    window.print();
  }

  // ============================================================
  // 库存日志页面
  // ============================================================
  function renderStockLogsPage(container) {
    var html = '<div class="page-container">' +
      '<div class="page-header">' +
      '<h1>📝 库存变更日志</h1>' +
      '<div class="header-actions">' +
      '<button class="btn" onclick="window.__newModule.refreshStockLogs()">🔄 刷新</button>' +
      '</div>' +
      '</div>';

    html += '<div class="filter-bar">' +
      '<span class="filter-label">类型</span>' +
      '<select id="log-type-filter" onchange="window.__newModule.filterStockLogs()">' +
      '<option value="">全部</option>' +
      '<option value="material">原材料</option>' +
      '<option value="finished_product">成品</option>' +
      '</select>' +
      '<span class="filter-label">操作</span>' +
      '<select id="log-change-filter" onchange="window.__newModule.filterStockLogs()">' +
      '<option value="">全部</option>' +
      '<option value="inbound">入库</option>' +
      '<option value="outbound">出库</option>' +
      '<option value="production_use">生产领料</option>' +
      '</select>' +
      '</div>';

    // 排序：最新的在前
    var logs = state.stockLogs.slice().sort(function(a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });

    var typeFilter = '';
    var changeFilter = '';
    var typeEl = document.getElementById('log-type-filter');
    var changeEl = document.getElementById('log-change-filter');
    if (typeEl) typeFilter = typeEl.value;
    if (changeEl) changeFilter = changeEl.value;

    if (typeFilter) logs = logs.filter(function(l) { return l.stock_type === typeFilter; });
    if (changeFilter) logs = logs.filter(function(l) { return l.change_type === changeFilter; });

    html += '<table class="data-table">' +
      '<thead><tr>' +
      '<th>时间</th><th>类型</th><th>项目</th><th>操作</th><th>数量变化</th><th>变更前</th><th>变更后</th><th>操作人</th><th>备注</th>' +
      '</tr></thead><tbody>';

    if (logs.length === 0) {
      html += '<tr><td colspan="9" style="text-align:center;padding:40px;color:#999;">暂无日志记录</td></tr>';
    } else {
      logs.forEach(function(l) {
        var typeLabel = l.stock_type === 'material' ? '原材料' : '成品';
        var changeLabel = { inbound: '入库', outbound: '出库', production_use: '生产领料' }[l.change_type] || l.change_type;
        var qtyStr = l.quantity > 0 ? '+' + l.quantity : String(l.quantity);
        var qtyColor = l.quantity > 0 ? '#52c41a' : '#cf1322';

        html += '<tr>' +
          '<td>' + formatDate(l.created_at) + '</td>' +
          '<td><span class="tag ' + (l.stock_type === 'material' ? 'tag-blue' : 'tag-green') + '">' + typeLabel + '</span></td>' +
          '<td>' + escapeHtml(l.item_name || '-') + '</td>' +
          '<td>' + changeLabel + '</td>' +
          '<td style="color:' + qtyColor + ';font-weight:700;">' + qtyStr + '</td>' +
          '<td>' + (l.before_quantity != null ? l.before_quantity : '-') + '</td>' +
          '<td>' + (l.after_quantity != null ? l.after_quantity : '-') + '</td>' +
          '<td>' + escapeHtml(l.operator || '-') + '</td>' +
          '<td>' + escapeHtml(l.remark || '-') + '</td></tr>';
      });
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // ============================================================
  // 辅助函数 - 刷新和筛选
  // ============================================================
  function refreshMaterials() {
    loadAllData().then(function() { renderPage('materials'); });
  }

  function refreshSuppliers() {
    loadAllData().then(function() { renderPage('suppliers'); });
  }

  function refreshProductions() {
    loadAllData().then(function() { renderPage('productions'); });
  }

  function refreshFinishedProducts() {
    loadAllData().then(function() { renderPage('finished-products'); });
  }

  function refreshStockLogs() {
    loadAllData().then(function() { renderPage('stock-logs'); });
  }

  function filterMaterials() {
    var el = document.getElementById('material-search');
    if (el) state.materialFilter = el.value;
    renderPage('materials');
  }

  function filterSuppliers() {
    var el = document.getElementById('supplier-search');
    if (el) state.supplierFilter = el.value;
    renderPage('suppliers');
  }

  function filterProductions() {
    renderPage('productions');
  }

  function filterStockLogs() {
    renderPage('stock-logs');
  }

  function setCurrentSubPage(page) {
    state.currentSubPage = page;
    renderPage('finished-products');
  }

  // ============================================================
  // 暴露到 window 供 HTML onclick 调用
  // ============================================================
  var api = {
    // 导航
    navigateTo: navigateTo,
    // 原材料
    renderMaterialsPage: renderMaterialsPage,
    showInboundDialog: showInboundDialog,
    showInboundForMaterial: showInboundDialog,
    confirmInbound: confirmInbound,
    showOutboundDialog: showOutboundDialog,
    showOutboundForMaterial: showOutboundDialog,
    confirmOutbound: confirmOutbound,
    showAddMaterialDialog: showAddMaterialDialog,
    confirmAddMaterial: confirmAddMaterial,
    deleteMaterial: deleteMaterial,
    refreshMaterials: refreshMaterials,
    filterMaterials: filterMaterials,
    // 供应商
    renderSuppliersPage: renderSuppliersPage,
    showAddSupplierDialog: showAddSupplierDialog,
    confirmAddSupplier: confirmAddSupplier,
    showEditSupplierDialog: showEditSupplierDialog,
    confirmEditSupplier: confirmEditSupplier,
    showSupplierRecords: showSupplierRecords,
    deleteSupplier: deleteSupplier,
    refreshSuppliers: refreshSuppliers,
    filterSuppliers: filterSuppliers,
    // 生产
    renderProductionsPage: renderProductionsPage,
    showCreateProductionDialog: showCreateProductionDialog,
    confirmCreateProduction: confirmCreateProduction,
    startProduction: startProduction,
    completeProduction: completeProduction,
    showAddMaterialToProduction: showAddMaterialToProduction,
    confirmAddMaterialToProduction: confirmAddMaterialToProduction,
    showProductionDetail: showProductionDetail,
    refreshProductions: refreshProductions,
    filterProductions: filterProductions,
    // 成品
    renderFinishedProductsPage: renderFinishedProductsPage,
    showWarehouseDialog: showWarehouseDialog,
    confirmWarehouse: confirmWarehouse,
    showShipDialog: showShipDialog,
    confirmShip: confirmShip,
    showManualOutboundDialog: showManualOutboundDialog,
    confirmManualOutbound: confirmManualOutbound,
    refreshFinishedProducts: refreshFinishedProducts,
    setCurrentSubPage: setCurrentSubPage,
    // 日志
    renderStockLogsPage: renderStockLogsPage,
    refreshStockLogs: refreshStockLogs,
    filterStockLogs: filterStockLogs,
    // 车间
    renderWorkshopsPage: renderWorkshopsPage,
    showAddWorkshopDialog: showAddWorkshopDialog,
    confirmAddWorkshop: confirmAddWorkshop,
    showEditWorkshopDialog: showEditWorkshopDialog,
    confirmEditWorkshop: confirmEditWorkshop,
    deleteWorkshop: deleteWorkshop,
    refreshWorkshops: refreshWorkshops,
    // 收发存汇总表
    renderReportPage: renderReportPage,
    queryReport: queryReport,
    printReport: printReport,
  };

  window.__newModule = api;

  // ============================================================
  // 添加导航按钮到原系统（不再使用右下角浮动按钮，避免打印时遮挡）
  // ============================================================
  function addGlobalNavButton() {
    // 监听 DOM，把"生产管理"按钮注入到原系统页面的顶部导航栏
    var observer = new MutationObserver(function() {
      try {
        var root = document.getElementById('root');
        if (!root || root.style.display === 'none') return;
        if (document.getElementById('global-nav-toggle')) return;
        var btnGroup = document.querySelector('#root .page-header .btn-group');
        if (!btnGroup) return;
        var btn = document.createElement('button');
        btn.id = 'global-nav-toggle';
        btn.className = 'btn btn-primary';
        btn.textContent = '📋 生产管理';
        btn.addEventListener('click', function() {
          if (window.__newModule) window.__newModule.toggleNewSystem();
        });
        btnGroup.appendChild(btn);
      } catch (e) {}
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  api.toggleNewSystem = function() {
    var oldRoot = document.getElementById('root');
    var newLayout = document.getElementById('new-modules-sidebar');

    if (newLayout.style.display === 'none' || !newLayout.style.display) {
      // 切换到新系统
      oldRoot.style.display = 'none';
      newLayout.style.display = 'flex';
      // 隐藏顶部导航按钮（新系统内部通过侧边栏"返回原系统"切换）
      var navBtn = document.getElementById('global-nav-toggle');
      if (navBtn) navBtn.style.display = 'none';
      // 加载数据
      loadAllData().then(function() {
        renderPage(state.currentPage);
      });
    } else {
      // 切换回原系统
      newLayout.style.display = 'none';
      oldRoot.style.display = '';
      var navBtn = document.getElementById('global-nav-toggle');
      if (navBtn) navBtn.style.display = '';
    }
  };

  // 监听"返回原系统"按钮
  document.addEventListener('click', function(e) {
    if (e.target.closest('#back-to-old')) {
      api.toggleNewSystem();
    }
  });

  // 初始化
  init();

})();
