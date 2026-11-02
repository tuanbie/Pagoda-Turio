/**
 * Deployment-specific settings.
 */
export const siteConfig = {
  /** other ways to reach the developer (shown in the feedback form) */
  contact: {
    discord: 'https://discord.gg/GZxhCKnSC',
    email: 'vantuan201.work@gmail.com',
  },
  donation: {
    /** VietQR / NAPAS 247 code, served from public/ */
    qr: '/donate-qr.png',
    /** optional bank transfer details shown under the QR (leave empty to hide) */
    bank: '',
    accountName: '',
    accountNumber: '',
    /** optional external links (e.g. Buy Me a Coffee, PayPal) */
    links: [] as { label: string; url: string }[],
  },
};
