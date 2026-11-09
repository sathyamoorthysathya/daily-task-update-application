/** Allowed values for the profile's industry field (kept in sync with the frontend select). */
export const INDUSTRIES = [
  'Accounting & Finance',
  'Agriculture',
  'Automotive',
  'Banking & Financial Services',
  'Construction & Real Estate',
  'Consulting',
  'Education',
  'Energy & Utilities',
  'Government & Public Sector',
  'Healthcare & Life Sciences',
  'Hospitality & Tourism',
  'Information Technology',
  'Insurance',
  'Legal',
  'Logistics & Supply Chain',
  'Manufacturing',
  'Marketing & Advertising',
  'Media & Entertainment',
  'Non-profit',
  'Retail & E-commerce',
  'Telecommunications',
  'Other',
] as const;

export type Industry = (typeof INDUSTRIES)[number];
