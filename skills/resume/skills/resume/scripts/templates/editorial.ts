import type { TemplateConfig } from './types';

export const editorial: TemplateConfig = {
  name: 'editorial',
  label: 'Editorial',
  description: 'Serif, centered, editorial journal feel',
  layout: 'single-column',
  header: 'centered',
  contactSeparator: '·',
  pdf: {
    fontFamily: 'Times-Roman',
    fontFamilyBold: 'Times-Bold',
    fontFamilyItalic: 'Times-Italic',
    fontSize: 10.5,
    nameFontSize: 24,
    sectionFontSize: 10.5,
    pageMargin: { top: 42, bottom: 42, horizontal: 56 },
  },
  html: {
    fontFamily: 'Georgia, "Times New Roman", Times, serif',
  },
  colors: {
    foreground: '#1a1a1a',
    muted: '#555',
    accent: '#1f2937',
    border: '#1f2937',
  },
  sectionHeading: {
    uppercase: true,
    letterSpacing: 0.22,
    borderBottom: false,
    accentColored: false,
  },
  bullet: { character: '\u2014', indent: 10 },
  sectionGap: 16,
  jobGap: 10,
  lineHeight: 1.0,
  bulletGap: 3,
  allowJobWrap: false,
};
