import type { SVGProps } from "react";

const PATHS = {
  home: ["M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"],
  megaphone: ["M3 11v2a1 1 0 0 0 1 1h2l8 4V6L6 10H4a1 1 0 0 0-1 1z", "M18 9a4 4 0 0 1 0 6", "M7 14l1 5h2.5l-.8-4.2"],
  vote: ["M3 14h18l-1.5 6h-15z", "M7 14V4h10v10", "M9.5 8.5l1.7 1.7 3.3-3.4"],
  wallet: [
    "M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2 2 2 0 0 1 2-2h12v3",
    "M16 14h.01",
  ],
  building: ["M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17", "M15 9h3a1 1 0 0 1 1 1v11", "M3 21h18", "M9 7h2M9 11h2M9 15h2"],
  users: [
    "M10 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z",
    "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20",
    "M16 4.8a3.5 3.5 0 0 1 0 6.4",
    "M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3",
  ],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5", "M9 13h6M9 17h6"],
  settings: ["M4 7h8M16 7h4M4 17h4M12 17h8", "M14 5v4M10 15v4"],
  user: ["M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "M4.5 20a7.5 7.5 0 0 1 15 0"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  plus: ["M12 5v14M5 12h14"],
  chevronRight: ["M9 6l6 6-6 6"],
  chevronLeft: ["M15 6l-6 6 6 6"],
  chevronDown: ["M6 9l6 6 6-6"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  x: ["M6 6l12 12M18 6L6 18"],
  alert: [
    "M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    "M12 9v4",
    "M12 17h.01",
  ],
  info: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M12 11v5", "M12 8h.01"],
  calendar: [
    "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
    "M4 10h16",
    "M8 3v4M16 3v4",
  ],
  bell: ["M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z", "M10 21h4"],
  menu: ["M4 6h16M4 12h16M4 18h16"],
  more: [
    "M4.5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0",
    "M10.5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0",
    "M16.5 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0",
  ],
  upload: ["M12 16V4", "M7 9l5-5 5 5", "M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"],
  download: ["M12 4v12", "M7 11l5 5 5-5", "M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"],
  search: ["M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z", "M20 20l-4-4"],
  phone: ["M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L15 13l4 1.5V18a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2z"],
  mail: ["M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M3 7l9 6.5L21 7"],
  edit: ["M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L4 16z", "M14 7l3 3"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13", "M10 11v6M14 11v6"],
  clock: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M12 7v5l3 2"],
  qr: [
    "M4 4h6v6H4z",
    "M14 4h6v6h-6z",
    "M4 14h6v6H4z",
    "M14 14h2v2h-2zM18 14h2v2h-2z",
    "M14 18h2v2h-2zM18 18h2v2h-2z",
  ],
  key: ["M8 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "M11 12l9-9", "M16 7l3 3"],
  link: [
    "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1",
    "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  ],
  help: [
    "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z",
    "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7",
    "M12 17h.01",
  ],
  heart: ["M12 20s-8-4.8-8-10.2A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 8 2.6C20 15.2 12 20 12 20z"],
} as const;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "title"> {
  name: IconName;
  /** Size in px (default 24). */
  size?: number;
  /** Accessible name. Omit for decorative icons (aria-hidden). */
  title?: string;
}

export function Icon({ name, size = 24, title, className, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
