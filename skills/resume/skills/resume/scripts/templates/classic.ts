import type { TemplateConfig } from './types';

export const classic: TemplateConfig = {
  name: 'classic',
  label: 'Classic',
  description: 'Traditional serif layout for formal industries',
  layout: 'single-column',
  header: 'centered',
  contactSeparator: '\u2022',
  pdf: {
    fontFamily: 'Times-Roman',
    fontFamilyBold: 'Times-Bold',
    fontSize: 10,
    nameFontSize: 20,
    sectionFontSize: 11,
    pageMargin: { top: 36, bottom: 36, horizontal: 48 },
  },
  html: { fontFamily: "'Times New Roman', Georgia, serif" },
  colors: {
    foreground: '#111',
    muted: '#444',
    accent: '#111',
    border: '#111',
  },
  sectionHeading: {
    uppercase: true,
    letterSpacing: 0.1,
    borderBottom: true,
    accentColored: false,
  },
  bullet: { character: '\u2022', indent: 8 },
  sectionGap: 14,
  jobGap: 10,
  lineHeight: 1.0,
  bulletGap: 2,
  allowJobWrap: false,
};
