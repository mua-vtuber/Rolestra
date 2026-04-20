/**
 * LineIcon — single-stroke SVG icon set.
 *
 * Ported verbatim from docs/Rolestra_sample/shared-components.jsx so the
 * mockup's visual identity is preserved. Paths use `currentColor` for stroke
 * so the icon inherits theme color from its container (no hardcoded colors).
 */

type IconName =
  | 'dashboard'
  | 'chat'
  | 'bell'
  | 'queue'
  | 'settings'
  | 'folder'
  | 'code'
  | 'pen'
  | 'document'
  | 'search'
  | 'spark'
  | 'plus'
  | 'send'
  | 'paperclip'
  | 'arrow_right'
  | 'check'
  | 'x';

export interface LineIconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  'aria-label'?: string;
}

export function LineIcon({ name, size = 16, stroke = 1.6, className, 'aria-label': ariaLabel }: LineIconProps) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const content = ICON_PATHS[name](common);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      className={className}
    >
      {content}
    </svg>
  );
}

type PathProps = React.SVGProps<SVGPathElement> | React.SVGProps<SVGCircleElement>;

const ICON_PATHS: Record<IconName, (c: PathProps) => React.ReactNode> = {
  dashboard: (c) => (
    <>
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M3 4.5h10v8H3z" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M3 8.5h10" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M7 12.5h2" />
    </>
  ),
  chat: (c) => <path {...(c as React.SVGProps<SVGPathElement>)} d="M3 4.5h10v7H7l-3 2z" />,
  bell: (c) => (
    <>
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M4 11h8" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M5.2 11V8a2.8 2.8 0 0 1 5.6 0v3" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M7 12.8a1.2 1.2 0 0 0 2 0" />
    </>
  ),
  queue: (c) => (
    <>
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M4 4.5h8" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M4 8h8" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M4 11.5h8" />
    </>
  ),
  settings: (c) => (
    <>
      <circle {...(c as React.SVGProps<SVGCircleElement>)} cx="8" cy="8" r="2.3" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M8 3.5v1.2M8 11.3v1.2M3.5 8h1.2M11.3 8h1.2M4.7 4.7l.9.9M10.4 10.4l.9.9M11.3 4.7l-.9.9M5.6 10.4l-.9.9" />
    </>
  ),
  folder: (c) => <path {...(c as React.SVGProps<SVGPathElement>)} d="M2.5 5h4l1 1.2h6v5.8h-11z" />,
  code: (c) => (
    <>
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M6 5.2 3.8 8 6 10.8" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M10 5.2 12.2 8 10 10.8" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M8.8 4.8 7.2 11.2" />
    </>
  ),
  pen: (c) => (
    <>
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M4 11.5 5 9l4.8-4.8 2.3 2.3L7.3 11.3Z" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M9.8 4.2 11 3l2 2-1.2 1.2" />
    </>
  ),
  document: (c) => (
    <>
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M4 3.5h5l3 3v6H4z" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M9 3.5v3h3" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M6 9h4M6 11h3" />
    </>
  ),
  search: (c) => (
    <>
      <circle {...(c as React.SVGProps<SVGCircleElement>)} cx="7" cy="7" r="3" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M9.5 9.5 12.5 12.5" />
    </>
  ),
  spark: (c) => (
    <path {...(c as React.SVGProps<SVGPathElement>)} d="M8 2.8 9.3 6.7 13.2 8 9.3 9.3 8 13.2 6.7 9.3 2.8 8 6.7 6.7Z" />
  ),
  plus: (c) => (
    <>
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M8 3.5v9" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M3.5 8h9" />
    </>
  ),
  send: (c) => <path {...(c as React.SVGProps<SVGPathElement>)} d="M3 8 13 3 10.5 13 7.5 9Z" />,
  paperclip: (c) => (
    <path
      {...(c as React.SVGProps<SVGPathElement>)}
      d="M10.5 4.5 5.5 9.5a2 2 0 1 0 2.8 2.8L12 8.6a3.2 3.2 0 1 0-4.6-4.6L3.5 7.9"
    />
  ),
  arrow_right: (c) => (
    <>
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M3 8h10" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="M9.5 4.5 13 8l-3.5 3.5" />
    </>
  ),
  check: (c) => (
    <path {...(c as React.SVGProps<SVGPathElement>)} d="M3.5 8.5 6.5 11.5 12.5 5" />
  ),
  x: (c) => (
    <>
      <path {...(c as React.SVGProps<SVGPathElement>)} d="m4 4 8 8" />
      <path {...(c as React.SVGProps<SVGPathElement>)} d="m12 4-8 8" />
    </>
  ),
};

export type { IconName };
