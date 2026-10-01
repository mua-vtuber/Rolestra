import { Menu, type MenuItemConstructorOptions, app } from 'electron';

type MenuLocale = 'ko' | 'en';

function resolveLocale(): MenuLocale {
  const locale = app.getLocale().toLowerCase();
  return locale.startsWith('ko') ? 'ko' : 'en';
}

const LABELS: Record<MenuLocale, {
  file: string;
  quit: string;
  edit: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  view: string;
  reload: string;
  forceReload: string;
  toggleDevTools: string;
  resetZoom: string;
  zoomIn: string;
  zoomOut: string;
  toggleFullscreen: string;
  window: string;
  minimize: string;
  close: string;
  help: string;
  about: string;
}> = {
  ko: {
    file: '파일',
    quit: '종료',
    edit: '편집',
    undo: '실행 취소',
    redo: '다시 실행',
    cut: '잘라내기',
    copy: '복사',
    paste: '붙여넣기',
    selectAll: '전체 선택',
    view: '보기',
    reload: '새로고침',
    forceReload: '강력 새로고침',
    toggleDevTools: '개발자 도구',
    resetZoom: '기본 확대/축소',
    zoomIn: '확대',
    zoomOut: '축소',
    toggleFullscreen: '전체 화면 전환',
    window: '창',
    minimize: '최소화',
    close: '닫기',
    help: '도움말',
    about: '정보',
  },
  en: {
    file: 'File',
    quit: 'Quit',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    reload: 'Reload',
    forceReload: 'Force Reload',
    toggleDevTools: 'Toggle Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    toggleFullscreen: 'Toggle Full Screen',
    window: 'Window',
    minimize: 'Minimize',
    close: 'Close',
    help: 'Help',
    about: 'About',
  },
};

export function configureApplicationMenu(): void {
  const locale = resolveLocale();
  const labels = LABELS[locale];
  const isDev = process.env.NODE_ENV === 'development' ||
    !!process.env.ELECTRON_RENDERER_URL;

  // Dev-only items: reload, force reload, devtools
  const devViewItems: MenuItemConstructorOptions[] = isDev
    ? [
        { label: labels.reload, role: 'reload' },
        { label: labels.forceReload, role: 'forceReload' },
        { label: labels.toggleDevTools, role: 'toggleDevTools' },
        { type: 'separator' },
      ]
    : [];

  const template: MenuItemConstructorOptions[] = [
    { label: labels.file, submenu: [{ label: labels.quit, role: 'quit' }] },
    {
      label: labels.edit,
      submenu: [
        { label: labels.undo, role: 'undo' },
        { label: labels.redo, role: 'redo' },
        { type: 'separator' },
        { label: labels.cut, role: 'cut' },
        { label: labels.copy, role: 'copy' },
        { label: labels.paste, role: 'paste' },
        { label: labels.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: labels.view,
      submenu: [
        ...devViewItems,
        { label: labels.resetZoom, role: 'resetZoom' },
        { label: labels.zoomIn, role: 'zoomIn' },
        { label: labels.zoomOut, role: 'zoomOut' },
        { type: 'separator' },
        { label: labels.toggleFullscreen, role: 'togglefullscreen' },
      ],
    },
    {
      label: labels.window,
      submenu: [
        { label: labels.minimize, role: 'minimize' },
        { label: labels.close, role: 'close' },
      ],
    },
    {
      label: labels.help,
      submenu: [
        { label: labels.about, role: 'about' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
