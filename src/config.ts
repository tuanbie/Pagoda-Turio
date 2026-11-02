/**
 * Deployment-specific settings. Replace the donation placeholders with your own
 * details before going live — the demo values below are intentionally fake.
 */
export const siteConfig = {
  donation: {
    demo: true,
    bank: 'Demo Bank',
    accountName: 'SON TU TEMPLE',
    accountNumber: '0000 0000 0000',
    /** optional external links (e.g. Buy Me a Coffee, PayPal) */
    links: [] as { label: string; url: string }[],
  },
};
