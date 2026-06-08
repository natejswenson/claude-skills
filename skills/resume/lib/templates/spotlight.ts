import type { TemplateConfig } from './types';

export const spotlight: TemplateConfig = {
  name: 'spotlight',
  label: 'Spotlight',
  description: 'Bold colored header band, clean body below',
  layout: 'single-column',
  header: 'band',
  contactSeparator: '·',
  band: {
    backgroundColor: '#8C0027',
    textColor: '#ffffff',
    mutedColor: 'rgba(255,255,255,0.8)',
    height: 110,
  },
  pdf: {
    fontFamily: 'Helvetica',
    fontFamilyBold: 'Helvetica-Bold',
    fontSize: 10,
    nameFontSize: 24,
    sectionFontSize: 10.5,
    pageMargin: { top: 0, bottom: 36, horizontal: 0 },
  },
  html: { fontFamily: "system-ui, -apple-system, sans-serif" },
  colors: {
    foreground: '#111',
    muted: '#555',
    accent: '#8C0027',
    border: '#e5e5e5',
  },
  sectionHeading: {
    uppercase: true,
    letterSpacing: 0.14,
    borderBottom: false,
    accentColored: true,
  },
  bullet: { character: '\u2013', indent: 8 },
  sectionGap: 14,
  jobGap: 10,
  lineHeight: 1.0,
  bulletGap: 2,
  allowJobWrap: false,
};
