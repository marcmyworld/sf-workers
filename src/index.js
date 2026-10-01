const ALLOWED_PROJECTS = {
  "chenfeng-builds": "Xiaomi 14 Civi / Civi 4 Pro",
  "groot-builds": "Redmi K70E / POCO X6 Pro"
};

const TELEGRAM_HANDLE = "xeon_man";

const FILE_EXTENSIONS = new Set([
  "zip", "img", "bin", "gz", "tar", "xz", "7z", "apk", "json", "txt", "md5", "sha256"
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (!path || path === "") {
      return renderHomeHub();
    }

    const match = path.match(/^\/?(?:projects?\/)?([^/]+)(?:\/files)?(?:\/(.*))?$/);
    if (!match) {
      return renderM3Error("Invalid Path");
    }

    const project = match[1].toLowerCase();
    const relativePath = match[2] || "";

    if (!ALLOWED_PROJECTS[project]) {
      return renderM3Error(project);
    }

    const lastSegment = relativePath.split("/").pop() || "";
    const extension = lastSegment.includes(".") ? lastSegment.split(".").pop().toLowerCase() : "";
    const isDirectFile = FILE_EXTENSIONS.has(extension) || url.searchParams.has("download");

    if (isDirectFile && relativePath) {
      return streamFileFromSourceForge(request, project, relativePath);
    }

    return renderDirectoryIndex(project, relativePath);
  }
};

async function streamFileFromSourceForge(request, project, filePath) {
  const directDownloadUrl = `https://downloads.sourceforge.net/project/${project}/${filePath}?use_mirror=autoselect`;

  const requestHeaders = new Headers();
  requestHeaders.set("User-Agent", "Wget/1.21.4");
  requestHeaders.set("Accept", "*/*");

  const clientRange = request.headers.get("Range");
  if (clientRange) {
    requestHeaders.set("Range", clientRange);
  }

  try {
    const response = await fetch(directDownloadUrl, {
      method: request.method,
      headers: requestHeaders,
      redirect: "follow"
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
    responseHeaders.delete("set-cookie");

    const filename = filePath.split("/").pop();
    if (filename) {
      responseHeaders.set("Content-Disposition", `attachment; filename="${filename}"`);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (err) {
    return new Response(`Download Streaming Error: ${err.message}`, { status: 502 });
  }
}

async function renderDirectoryIndex(project, subPath) {
  const sfUrl = `https://sourceforge.net/projects/${project}/files/${subPath}`;

  try {
    const sfResp = await fetch(sfUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" }
    });

    if (!sfResp.ok) {
      return renderM3Error(project, "Could not retrieve directory listing from SourceForge.");
    }

    const html = await sfResp.text();
    const items = parseSourceForgeHtml(html, project, subPath);

    return new Response(buildM3ExplorerHtml(project, subPath, items), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "public, max-age=60"
      }
    });
  } catch (err) {
    return renderM3Error(project, err.message);
  }
}

function parseSourceForgeHtml(html, project, currentSubPath) {
  const items = [];
  const rowRegex = /<tr[^>]*class="[^"]*(folder|file)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const type = match[1].toLowerCase();
    const content = match[2];

    const titleMatch = content.match(/<th[^>]*scope="row"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    let href = titleMatch[1];
    let name = titleMatch[2].replace(/<[^>]+>/g, "").trim();

    if (!name || name === "Parent Folder" || name === "..") continue;

    let date = "";
    const dateMatch = content.match(/headers="files_date_h"[^>]*>([\s\S]*?)<\/td>/i);
    if (dateMatch) {
      date = dateMatch[1].replace(/<[^>]+>/g, "").trim();
    }

    let size = "";
    const sizeMatch = content.match(/headers="files_size_h"[^>]*>([\s\S]*?)<\/td>/i);
    if (sizeMatch) {
      size = sizeMatch[1].replace(/<[^>]+>/g, "").trim();
    }

    const cleanPath = currentSubPath ? `${currentSubPath.replace(/\/+$/, "")}/${name}` : name;

    items.push({
      type: type,
      name: name,
      path: cleanPath,
      date: date || "Recent",
      size: type === "folder" ? "--" : (size || "Unknown")
    });
  }

  return items;
}

function buildM3ExplorerHtml(project, subPath, items) {
  const deviceName = ALLOWED_PROJECTS[project] || "Xiaomi Device";
  const pathParts = subPath ? subPath.split("/").filter(Boolean) : [];

  let breadcrumbsHtml = `<a href="/${project}/files" class="crumb">files</a>`;
  let accumulatedPath = "";

  pathParts.forEach((part, idx) => {
    accumulatedPath += (idx === 0 ? "" : "/") + part;
    if (idx === pathParts.length - 1) {
      breadcrumbsHtml += `<span class="sep">/</span><span class="crumb active">${escapeHtml(part)}</span>`;
    } else {
      breadcrumbsHtml += `<span class="sep">/</span><a href="/${project}/files/${accumulatedPath}" class="crumb">${escapeHtml(part)}</a>`;
    }
  });

  let parentLinkHtml = "";
  if (pathParts.length > 0) {
    const parentPath = pathParts.slice(0, -1).join("/");
    const targetUrl = parentPath ? `/${project}/files/${parentPath}` : `/${project}/files`;
    parentLinkHtml = `
      <a href="${targetUrl}" class="item-row parent-row">
        <div class="item-icon">
          <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        </div>
        <div class="item-info">
          <div class="item-name">.. (Go to parent directory)</div>
        </div>
      </a>`;
  }

  let listHtml = parentLinkHtml;

  if (items.length === 0) {
    listHtml += `<div class="empty-state">No files found in this directory.</div>`;
  } else {
    items.forEach(item => {
      const isFolder = item.type === "folder";
      const iconSvg = isFolder
        ? `<svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`
        : `<svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>`;

      const targetUrl = isFolder
        ? `/${project}/files/${item.path}`
        : `/${project}/files/${item.path}?download=1`;

      listHtml += `
        <div class="item-row ${isFolder ? 'is-folder' : 'is-file'}">
          <a href="${targetUrl}" class="item-clickable">
            <div class="item-icon ${isFolder ? 'folder-icon' : 'file-icon'}">
              ${iconSvg}
            </div>
            <div class="item-info">
              <div class="item-name">${escapeHtml(item.name)}</div>
              <div class="item-meta">
                <span>${escapeHtml(item.date)}</span>
                ${!isFolder ? `<span class="meta-dot">•</span><span>${escapeHtml(item.size)}</span>` : ""}
              </div>
            </div>
          </a>
          ${!isFolder ? `
            <a href="${targetUrl}" class="download-button" title="Fast CDN Download">
              <svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>
              <span>Get</span>
            </a>` : ""}
        </div>`;
    });
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(project)} - Edge File Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;500;600;700;800&family=Google+Sans+Code&display=swap" rel="stylesheet">
  ${m3BaseStyles()}
</head>
<body>
  <div class="app-layout">
    <header class="app-bar">
      <div class="app-bar-brand">
        <a href="/" class="home-icon-link">
          <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
        </a>
        <div>
          <div class="project-title">${escapeHtml(project)}</div>
          <div class="device-subtitle">${escapeHtml(deviceName)}</div>
        </div>
      </div>
      <a href="https://t.me/${TELEGRAM_HANDLE}" target="_blank" class="contact-pill">@${TELEGRAM_HANDLE}</a>
    </header>

    <main class="content-body">
      <div class="breadcrumbs-container">
        ${breadcrumbsHtml}
      </div>

      <div class="file-list-card">
        ${listHtml}
      </div>
    </main>

    <footer class="app-footer">
      Powered by Cloudflare Enterprise Edge & • Direct Mirror Routing
    </footer>
  </div>
</body>
</html>`;
}

function renderHomeHub() {
  const cardsHtml = Object.entries(ALLOWED_PROJECTS).map(([proj, desc]) => `
    <a href="/${proj}/files" class="hub-card">
      <div class="hub-card-icon">
        <svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
      </div>
      <div class="hub-card-details">
        <div class="hub-project-name">${escapeHtml(proj)}</div>
        <div class="hub-device-name">${escapeHtml(desc)}</div>
      </div>
      <div class="hub-arrow">
        <svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
      </div>
    </a>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edge File Hub • Supported Projects</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${m3BaseStyles()}
</head>
<body>
  <div class="app-layout">
    <header class="app-bar home-app-bar">
      <div>
        <div class="project-title">Edge File Hub</div>
        <div class="device-subtitle">High-speed CDN routing for verified devices</div>
      </div>
      <a href="https://t.me/${TELEGRAM_HANDLE}" target="_blank" class="contact-pill">@${TELEGRAM_HANDLE}</a>
    </header>

    <main class="content-body">
      <div class="section-title">Select Device Repository</div>
      <div class="hub-grid">
        ${cardsHtml}
      </div>

      <div class="info-card">
        <div class="info-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        </div>
        <div>
          <div class="info-title">Need a project added?</div>
          <div class="info-desc">If your device repository is hosted on SourceForge and you want fast edge routing in India, request an addition below.</div>
          <a href="https://t.me/${TELEGRAM_HANDLE}" target="_blank" class="info-link">Request via @${TELEGRAM_HANDLE} &rarr;</a>
        </div>
      </div>
    </main>

    <footer class="app-footer">
      Material 3 Expressive • Cloudflare Edge Network
    </footer>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=UTF-8" }
  });
}

function renderM3Error(attemptedProject, customMessage) {
  const displayProject = attemptedProject ? escapeHtml(attemptedProject) : "Unknown / Root";
  const desc = customMessage ? escapeHtml(customMessage) : "This high-speed edge proxy is configured only for authorized build pipelines.";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project Not Supported • Edge Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;500;700;800&family=Google+Sans+Code&display=swap" rel="stylesheet">
  ${m3BaseStyles()}
</head>
<body class="error-page-body">
  <div class="error-card">
    <div class="badge-icon">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
    </div>
    <h1 class="error-title">Project Not Supported</h1>
    <p class="error-description">${desc}</p>
    
    <div class="code-chip">Attempted: ${displayProject}</div>

    <div class="supported-pill">
      <span class="pill-header">Active Whitelist</span>
      <div>• chenfeng-builds (Xiaomi 14 Civi)</div>
      <div>• groot-builds (Redmi K70E / POCO X6 Pro)</div>
    </div>

    <a href="https://t.me/${TELEGRAM_HANDLE}" class="btn-primary" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
      Contact @${TELEGRAM_HANDLE} to Request
    </a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 403,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store, must-revalidate"
    }
  });
}

function m3BaseStyles() {
  return `<style>
    :root {
      --md-sys-color-primary: #6750A4;
      --md-sys-color-on-primary: #FFFFFF;
      --md-sys-color-primary-container: #EADDFF;
      --md-sys-color-on-primary-container: #21005D;
      --md-sys-color-surface: #FEF7FF;
      --md-sys-color-on-surface: #1D1B20;
      --md-sys-color-on-surface-variant: #49454F;
      --md-sys-color-outline: #79747E;
      --md-sys-color-outline-variant: #CAC4D0;
      --md-sys-color-surface-container-low: #F7F2FA;
      --md-sys-color-surface-container: #F3EDF7;
      --md-sys-color-surface-container-high: #ECE6F0;
      --md-sys-color-surface-container-highest: #E6E0E9;
      --md-sys-color-error-container: #F9DEDC;
      --md-sys-color-on-error-container: #410E0B;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --md-sys-color-primary: #D0BCFF;
        --md-sys-color-on-primary: #381E72;
        --md-sys-color-primary-container: #4F378B;
        --md-sys-color-on-primary-container: #EADDFF;
        --md-sys-color-surface: #141218;
        --md-sys-color-on-surface: #E6E0E9;
        --md-sys-color-on-surface-variant: #CAC4D0;
        --md-sys-color-outline: #938F99;
        --md-sys-color-outline-variant: #49454F;
        --md-sys-color-surface-container-low: #1D1B20;
        --md-sys-color-surface-container: #211F26;
        --md-sys-color-surface-container-high: #2B2930;
        --md-sys-color-surface-container-highest: #36343B;
        --md-sys-color-error-container: #8C1D18;
        --md-sys-color-on-error-container: #F9DEDC;
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Google Sans Flex', -apple-system, sans-serif;
      background-color: var(--md-sys-color-surface);
      color: var(--md-sys-color-on-surface);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .app-layout {
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
      padding: 24px 16px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .app-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      background-color: var(--md-sys-color-surface-container);
      border-radius: 28px;
      margin-bottom: 24px;
    }

    .app-bar-brand {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .home-icon-link {
      width: 44px;
      height: 44px;
      border-radius: 22px;
      background-color: var(--md-sys-color-surface-container-high);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--md-sys-color-on-surface);
      text-decoration: none;
      transition: background-color 0.2s;
    }
    .home-icon-link:hover { background-color: var(--md-sys-color-surface-container-highest); }
    .home-icon-link svg { width: 22px; height: 22px; fill: currentColor; }

    .project-title {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }
    .device-subtitle {
      font-size: 13px;
      color: var(--md-sys-color-on-surface-variant);
      margin-top: 2px;
    }

    .contact-pill {
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 100px;
      font-size: 13px;
      font-weight: 700;
    }

    .content-body { flex: 1; }

    .breadcrumbs-container {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding: 0 8px;
      font-size: 14px;
    }

    .crumb {
      text-decoration: none;
      color: var(--md-sys-color-primary);
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 8px;
    }
    .crumb.active { color: var(--md-sys-color-on-surface); font-weight: 700; }
    .sep { color: var(--md-sys-color-outline); }

    .file-list-card {
      background-color: var(--md-sys-color-surface-container-low);
      border-radius: 32px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: 20px;
      transition: background-color 0.15s ease;
      background-color: var(--md-sys-color-surface-container);
    }
    .item-row:hover { background-color: var(--md-sys-color-surface-container-high); }

    .item-clickable {
      display: flex;
      align-items: center;
      gap: 14px;
      text-decoration: none;
      color: inherit;
      flex: 1;
      overflow: hidden;
    }

    .item-icon {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .item-icon svg { width: 24px; height: 24px; fill: currentColor; }
    .folder-icon { background-color: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
    .file-icon { background-color: var(--md-sys-color-surface-container-highest); color: var(--md-sys-color-primary); }

    .item-info { overflow: hidden; }
    .item-name {
      font-size: 15px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-meta {
      font-size: 12px;
      color: var(--md-sys-color-on-surface-variant);
      margin-top: 2px;
      display: flex;
      gap: 6px;
    }
    .meta-dot { opacity: 0.5; }

    .download-button {
      display: flex;
      align-items: center;
      gap: 6px;
      background-color: var(--md-sys-color-primary);
      color: var(--md-sys-color-on-primary);
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 100px;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .download-button svg { width: 16px; height: 16px; fill: currentColor; }

    .hub-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 24px;
    }

    .hub-card {
      display: flex;
      align-items: center;
      gap: 18px;
      background-color: var(--md-sys-color-surface-container);
      border-radius: 28px;
      padding: 20px;
      text-decoration: none;
      color: inherit;
      transition: transform 0.2s, background-color 0.2s;
    }
    .hub-card:hover {
      background-color: var(--md-sys-color-surface-container-high);
      transform: translateY(-2px);
    }
    .hub-card-icon {
      width: 52px;
      height: 52px;
      border-radius: 18px;
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hub-card-icon svg { width: 28px; height: 28px; fill: currentColor; }
    .hub-card-details { flex: 1; }
    .hub-project-name { font-size: 18px; font-weight: 800; }
    .hub-device-name { font-size: 13px; color: var(--md-sys-color-on-surface-variant); margin-top: 3px; }
    .hub-arrow svg { width: 24px; height: 24px; fill: var(--md-sys-color-outline); }

    .info-card {
      background-color: var(--md-sys-color-surface-container-low);
      border-radius: 28px;
      padding: 22px;
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }
    .info-icon svg { width: 26px; height: 26px; fill: var(--md-sys-color-primary); }
    .info-title { font-size: 15px; font-weight: 700; }
    .info-desc { font-size: 13px; color: var(--md-sys-color-on-surface-variant); margin: 4px 0 10px; line-height: 1.4; }
    .info-link { font-size: 13px; font-weight: 700; color: var(--md-sys-color-primary); text-decoration: none; }

    .section-title {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--md-sys-color-on-surface-variant);
      margin: 12px 8px 16px;
    }

    .error-page-body {
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .error-card {
      background-color: var(--md-sys-color-surface-container);
      border-radius: 36px;
      padding: 44px 32px;
      max-width: 480px;
      width: 100%;
      text-align: center;
    }
    .badge-icon {
      width: 76px;
      height: 76px;
      background-color: var(--md-sys-color-error-container);
      color: var(--md-sys-color-on-error-container);
      border-radius: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 24px;
    }
    .badge-icon svg { width: 38px; height: 38px; fill: currentColor; }
    .error-title { font-size: 28px; font-weight: 800; }
    .error-description { font-size: 15px; color: var(--md-sys-color-on-surface-variant); margin: 12px 0 20px; line-height: 1.4; }
    .code-chip {
      background-color: var(--md-sys-color-surface-container-high);
      border: 1px solid var(--md-sys-color-outline-variant);
      font-family: 'Google Sans Code', monospace;
      font-size: 13px;
      padding: 6px 14px;
      border-radius: 10px;
      display: inline-block;
      margin-bottom: 24px;
    }
    .supported-pill {
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      padding: 12px 18px;
      border-radius: 18px;
      font-size: 13px;
      text-align: left;
      margin-bottom: 28px;
    }
    .pill-header { font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; display: block; margin-bottom: 4px; }
    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background-color: var(--md-sys-color-primary);
      color: var(--md-sys-color-on-primary);
      text-decoration: none;
      font-size: 15px;
      font-weight: 700;
      padding: 15px 24px;
      border-radius: 100px;
      width: 100%;
    }
    .btn-primary svg { width: 20px; height: 20px; fill: currentColor; }

    .app-footer {
      text-align: center;
      font-size: 12px;
      color: var(--md-sys-color-outline);
      margin-top: 32px;
      padding: 8px;
    }
  </style>`;
}

function escapeHtml(string) {
  return String(string)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
