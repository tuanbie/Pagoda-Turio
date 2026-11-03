/**
 * Deployment-specific settings.
 */
export const siteConfig = {
  /**
   * Who builds and runs this software. Shown next to every mention of money and in the
   * disclaimer, so visitors know they are supporting a developer, not a temple.
   * Put your real name or team name here before going live.
   */
  developer: {
    name: 'tuanbie',
    url: 'https://github.com/tuanbie',
  },
  /** other ways to reach the developer (shown in the feedback form) */
  contact: {
    discord: 'https://discord.gg/GZxhCKnSC',
    email: 'vantuan201.work@gmail.com',
  },
  /**
   * Voluntary support for the developer (server costs + development), like Buy Me a Coffee.
   * This is NOT a temple donation: never word it as "công đức" / "cúng dường" / an offering,
   * never place it inside the 3D temple, and keep the transfer memo about the software.
   */
  donation: {
    /** VietQR / NAPAS 247 code of the developer's personal account, served from public/ */
    qr: '/donate-qr.png',
    /** suggested transfer memo shown under the QR (no diacritics; leave empty to hide) */
    memo: 'UNG HO LAP TRINH VIEN',
    /** optional bank transfer details shown under the QR (leave empty to hide) */
    bank: '',
    accountName: '',
    accountNumber: '',
    /** optional external links (e.g. Buy Me a Coffee, PayPal, GitHub Sponsors) */
    links: [] as { label: string; url: string }[],
  },
};
