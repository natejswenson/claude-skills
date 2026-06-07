export type TemplateName =
  | 'modern'
  | 'classic'
  | 'technical'
  | 'polished'
  | 'timeline'
  | 'editorial'
  | 'spotlight';

export interface TemplateConfig {
  name: TemplateName;
  label: string;
  description: string;

  layout: 'single-column' | 'sidebar' | 'timeline';
  header: 'centered' | 'split' | 'band';
  contactSeparator: string;

  sidebar?: {
    width: number;          // PDF points
    backgroundColor: string;
    textColor: string;
    mutedColor: string;
    position: 'left';
  };

  /** Spotlight-style full-width colored header band. */
  band?: {
    backgroundColor: string;
    textColor: string;
    mutedColor: string;
    height: number;
  };

  /** Timeline-style left-gutter chronology rail. */
  timeline?: {
    gutterWidth: number;
    ruleColor: string;
    ruleWidth: number;
  };

  pdf: {
    fontFamily: string;
    fontFamilyBold: string;
    fontFamilyItalic?: string;
    fontSize: number;
    nameFontSize: number;
    sectionFontSize: number;
    pageMargin: { top: number; bottom: number; horizontal: number };
  };
  html: {
    fontFamily: string;
  };

  colors: {
    foreground: string;
    muted: string;
    accent: string;
    border: string;
  };

  sectionHeading: {
    uppercase: boolean;
    letterSpacing: number;
    borderBottom: boolean;
    accentColored: boolean;
  };

  bullet: {
    character: string;
    indent: number;
  };

  sectionGap: number;
  jobGap: number;
  lineHeight: number;
  bulletGap: number;
  allowJobWrap: boolean;
}
