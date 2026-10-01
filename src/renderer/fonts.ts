/**
 * Fonts bundled with the app (all OFL-1.1, from @fontsource). The token
 * font stacks name them (`theme-tokens.ts`), and the page's CSP is
 * `default-src 'self'`, so they must ship inside the app — Vite copies the
 * font files next to the renderer bundle and nothing loads from the
 * network. Only the weights the 2026-10-01 mockups use are imported:
 *   - IBM Plex Sans KR 400/500/600 — tactical body text (Hangul + Latin)
 *   - Space Grotesk 500/600/700 — tactical titles (Latin; Hangul falls
 *     through to IBM Plex Sans KR)
 *   - JetBrains Mono 400/500/700 — mono text and the whole retro theme
 *   - Nanum Gothic Coding 400/700 — Hangul in mono / retro text
 */
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/600.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/nanum-gothic-coding/400.css';
import '@fontsource/nanum-gothic-coding/700.css';
