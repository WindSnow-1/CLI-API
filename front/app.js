// =====================================================================
// GCLI2API 新版前端 — 路由、主题、仪表盘
// =====================================================================

// 页面名到 DOM id 映射
const PAGE_MAP = {
    'dashboard':          'dashboardPage',
    'oauth':              'oauthPage',
    'antigravity':        'antigravityPage',
    'upload':             'uploadPage',
    'manage':             'managePage',
    'antigravity-manage': 'antigravity-managePage',
    'config':             'configPage',
    'logs':               'logsPage',
    'about':              'aboutPage'
};

// 页面切换时自动加载数据
const PAGE_LOADERS = {
    'manage':             () => AppState.creds.refresh(),
    'antigravity-manage': () => AppState.antigravityCreds.refresh(),
    'config':             () => loadConfig(),
    'logs':               () => connectWebSocket(),
    'dashboard':          () => refreshDashboard()
};

let currentPage = 'dashboard';

function switchPage(page, navEl) {
    if (page === currentPage) return;

    // 更新导航高亮
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (navEl) navEl.classList.add('active');

    // 淡出当前页
    const curEl = document.getElementById(PAGE_MAP[currentPage]);
    const targetEl = document.getElementById(PAGE_MAP[page]);
    if (!targetEl) return;

    if (curEl) {
        curEl.style.transition = 'opacity 0.15s ease-out';
        curEl.style.opacity = '0';

        setTimeout(() => {
            curEl.classList.remove('active');
            curEl.style.transition = '';
            curEl.style.opacity = '';

            targetEl.style.opacity = '0';
            targetEl.classList.add('active');

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    targetEl.style.transition = 'opacity 0.2s ease-out';
                    targetEl.style.opacity = '1';
                    setTimeout(() => {
                        targetEl.style.transition = '';
                        targetEl.style.opacity = '';
                    }, 210);
                });
            });

            currentPage = page;
            if (PAGE_LOADERS[page]) PAGE_LOADERS[page]();
        }, 150);
    } else {
        targetEl.classList.add('active');
        currentPage = page;
        if (PAGE_LOADERS[page]) PAGE_LOADERS[page]();
    }

    // 移动端自动收起侧边栏
    if (window.innerWidth <= 768) {
        closeSidebar();
    }
}

// 覆盖 common.js 的 switchTab，让旧调用也能工作
// common.js 的 triggerTabDataLoad 会被 switchPage 的 PAGE_LOADERS 替代
function switchTab(tabName) {
    const navBtn = document.querySelector(`.nav-item[data-page="${tabName}"]`);
    switchPage(tabName, navBtn);
}

// =====================================================================
// 侧边栏（移动端）
// =====================================================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
}

// =====================================================================
// 暗色模式
// =====================================================================
function initTheme() {
    const saved = localStorage.getItem('gcli2api_theme');
    if (saved === 'dark') {
        applyTheme('dark');
    } else if (saved === 'light') {
        applyTheme('light');
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        applyTheme('dark');
    } else {
        applyTheme('light');
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    if (icon && label) {
        if (theme === 'dark') {
            icon.textContent = '☀'; // ☀ sun
            label.textContent = '亮色';
        } else {
            icon.textContent = '☾'; // ☾ moon
            label.textContent = '暗色';
        }
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('gcli2api_theme', next);
}

// =====================================================================
// 仪表盘
// =====================================================================
async function refreshDashboard() {
    try {
        const headers = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};

        // GCLI stats
        const gcliRes = await fetch('./creds/status?limit=20&mode=geminicli', { headers });
        if (gcliRes.ok) {
            const d = await gcliRes.json();
            const gs = d.stats || {};
            setText('dashGcliTotal', gs.total != null ? gs.total : '-');
            setText('dashGcliNormal', gs.normal != null ? gs.normal : '-');
            setText('dashGcliDisabled', gs.disabled != null ? gs.disabled : '-');

            renderErrorChart('gcliErrorChart', 'gcliErrorChartFallback', gs);
        } else {
            console.warn('Dashboard GCLI fetch failed:', gcliRes.status);
        }

        // Antigravity stats
        const agRes = await fetch('./creds/status?limit=20&mode=antigravity', { headers });
        if (agRes.ok) {
            const d = await agRes.json();
            const as2 = d.stats || {};
            setText('dashAgTotal', as2.total != null ? as2.total : '-');
            setText('dashAgNormal', as2.normal != null ? as2.normal : '-');
            setText('dashAgDisabled', as2.disabled != null ? as2.disabled : '-');

            renderErrorChart('agErrorChart', 'agErrorChartFallback', as2);
        } else {
            console.warn('Dashboard AG fetch failed:', agRes.status);
        }
    } catch (e) {
        console.error('Dashboard refresh error:', e);
    }
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function renderErrorChart(canvasId, fallbackId, stats) {
    const canvas = document.getElementById(canvasId);
    const fallback = document.getElementById(fallbackId);
    if (!canvas || !stats) return;

    const errorCounts = stats.error_code_distribution || stats.errorCodeDistribution;
    if (!errorCounts || Object.keys(errorCounts).length === 0) {
        canvas.style.display = 'none';
        if (fallback) {
            fallback.style.display = 'block';
            fallback.textContent = '暂无错误数据';
        }
        return;
    }

    // 如果没有 Chart.js，用简单的 HTML 柱状图
    if (typeof Chart === 'undefined') {
        canvas.style.display = 'none';
        if (fallback) {
            fallback.style.display = 'block';
            fallback.innerHTML = buildSimpleBarChart(errorCounts);
        }
        return;
    }

    // Chart.js 版本
    if (fallback) fallback.style.display = 'none';
    canvas.style.display = 'block';

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const labels = Object.keys(errorCounts);
    const values = Object.values(errorCounts);
    const colors = labels.map(code => {
        if (code === '400') return '#FF9500';
        if (code === '403') return '#FF3B30';
        if (code === '429') return '#AF52DE';
        if (code === '500') return '#FF2D55';
        return '#8E8E93';
    });

    // 销毁旧图表
    if (canvas._chartInstance) canvas._chartInstance.destroy();

    canvas._chartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: labels.map(c => `错误 ${c}`),
            datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: isDark ? '#fff' : '#333', padding: 12 }
                }
            }
        }
    });
}

function buildSimpleBarChart(errorCounts) {
    const entries = Object.entries(errorCounts);
    if (entries.length === 0) return '<div style="padding:20px;text-align:center;">暂无错误数据</div>';

    const max = Math.max(...entries.map(e => e[1]));
    const colorMap = { '400': '#FF9500', '403': '#FF3B30', '429': '#AF52DE', '500': '#FF2D55' };

    let html = '<div style="padding:8px 0;">';
    for (const [code, count] of entries) {
        const pct = max > 0 ? (count / max * 100) : 0;
        const color = colorMap[code] || '#8E8E93';
        html += `<div style="display:flex;align-items:center;margin:6px 0;font-size:13px;">
            <span style="width:60px;flex-shrink:0;">错误 ${code}</span>
            <div style="flex:1;height:20px;background:var(--bg-tertiary);border-radius:4px;overflow:hidden;margin:0 8px;">
                <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
            </div>
            <span style="width:40px;text-align:right;flex-shrink:0;">${count}</span>
        </div>`;
    }
    html += '</div>';
    return html;
}

// =====================================================================
// Collapsible sections
// =====================================================================
function toggleProjectIdSection() {
    const section = document.getElementById('projectIdSection');
    const icon = document.getElementById('projectIdToggleIcon');
    if (!section) return;
    const isOpen = section.style.display !== 'none' && section.style.display !== '';
    section.style.display = isOpen ? 'none' : 'block';
    if (icon) icon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
}

function toggleCallbackUrlSection() {
    const section = document.getElementById('callbackUrlSection');
    const icon = document.getElementById('callbackUrlToggleIcon');
    if (!section) return;
    const isOpen = section.style.display !== 'none' && section.style.display !== '';
    section.style.display = isOpen ? 'none' : 'block';
    if (icon) icon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}

function toggleAntigravityCallbackUrlSection() {
    const section = document.getElementById('antigravityCallbackUrlSection');
    const icon = document.getElementById('antigravityCallbackUrlToggleIcon');
    if (!section) return;
    const isOpen = section.style.display !== 'none' && section.style.display !== '';
    section.style.display = isOpen ? 'none' : 'block';
    if (icon) icon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}

// =====================================================================
// 工具函数
// =====================================================================
function cpUrl(el) {
    navigator.clipboard.writeText(el.textContent).then(function () {
        el.style.background = 'var(--accent-light, #b7f0b7)';
        setTimeout(function () { el.style.background = ''; }, 800);
    });
}

// =====================================================================
// 初始化
// =====================================================================
document.addEventListener('DOMContentLoaded', function () {
    initTheme();

    // 初始折叠
    const pis = document.getElementById('projectIdSection');
    if (pis) pis.style.display = 'none';
    const cus = document.getElementById('callbackUrlSection');
    if (cus) cus.style.display = 'none';
    const acus = document.getElementById('antigravityCallbackUrlSection');
    if (acus) acus.style.display = 'none';

    // 版本信息（about 页面）
    if (typeof fetchAndDisplayVersion === 'function') {
        // 会在 window.onload 的 autoLogin 成功后调用
    }
});
