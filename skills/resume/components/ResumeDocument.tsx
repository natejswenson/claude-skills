// No "use client" — this module imports @react-pdf/renderer and runs only
// on the server (/api/pdf route). Client PDF rendering has been removed.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { ResumeJSON } from "@/schemas/resume";
import { templates, type TemplateName, type TemplateConfig } from "@/lib/templates";

function buildStyles(config: TemplateConfig) {
  const { pdf, colors, sectionHeading, bullet, sectionGap, jobGap, lineHeight, bulletGap } = config;
  return StyleSheet.create({
    page: {
      paddingTop: pdf.pageMargin.top,
      paddingBottom: pdf.pageMargin.bottom,
      paddingHorizontal: pdf.pageMargin.horizontal,
      fontFamily: pdf.fontFamily,
      fontSize: pdf.fontSize,
      color: colors.foreground,
    },
    name: {
      fontSize: pdf.nameFontSize,
      fontFamily: pdf.fontFamilyBold,
      marginBottom: 4,
    },
    contactLine: {
      fontSize: pdf.fontSize - 1,
      color: colors.muted,
      marginBottom: 2,
    },
    headerSplit: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 4,
    },
    sectionHeading: {
      fontSize: pdf.sectionFontSize,
      fontFamily: pdf.fontFamilyBold,
      textTransform: sectionHeading.uppercase ? "uppercase" : "none",
      letterSpacing: sectionHeading.letterSpacing * pdf.sectionFontSize,
      borderBottomWidth: sectionHeading.borderBottom ? 1 : 0,
      borderBottomColor: colors.border,
      color: sectionHeading.accentColored ? colors.accent : colors.foreground,
      paddingBottom: 2,
      marginTop: sectionGap,
      marginBottom: 6,
    },
    summary: {
      lineHeight: lineHeight + 0.05,
    },
    jobBlock: {
      marginBottom: jobGap,
    },
    jobHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 2,
    },
    jobTitle: {
      fontFamily: pdf.fontFamilyBold,
      fontSize: pdf.fontSize,
    },
    jobDates: {
      fontSize: pdf.fontSize - 1,
      color: colors.muted,
    },
    company: {
      fontSize: pdf.fontSize,
      fontStyle: "italic",
      marginBottom: 3,
    },
    bullet: {
      flexDirection: "row",
      marginBottom: bulletGap,
      paddingLeft: bullet.indent,
    },
    bulletDot: {
      width: bullet.indent,
    },
    bulletText: {
      flex: 1,
      lineHeight,
    },
    skillsLine: {
      lineHeight: lineHeight + 0.05,
    },
    eduBlock: {
      marginBottom: 4,
    },
    eduLine: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
  });
}

// Pre-create all stylesheets at module scope to avoid per-render memory leaks
const allStyles: Record<TemplateName, ReturnType<typeof buildStyles>> = {
  modern: buildStyles(templates.modern),
  classic: buildStyles(templates.classic),
  technical: buildStyles(templates.technical),
  polished: buildStyles(templates.polished),
  timeline: buildStyles(templates.timeline),
  editorial: buildStyles(templates.editorial),
  spotlight: buildStyles(templates.spotlight),
};

function ResumeHeader({ resume, config, styles: s }: { resume: ResumeJSON; config: TemplateConfig; styles: ReturnType<typeof buildStyles> }) {
  const contactParts: string[] = [];
  if (resume.contact.email) contactParts.push(resume.contact.email);
  if (resume.contact.phone) contactParts.push(resume.contact.phone);
  if (resume.contact.location) contactParts.push(resume.contact.location);

  const sep = `  ${config.contactSeparator}  `;

  if (config.header === "band" && config.band) {
    const band = config.band;
    return (
      <View
        style={{
          backgroundColor: band.backgroundColor,
          paddingTop: 24,
          paddingBottom: 18,
          paddingHorizontal: 48,
          marginBottom: 24,
        }}
      >
        <Text
          style={{
            fontSize: config.pdf.nameFontSize,
            fontFamily: config.pdf.fontFamilyBold,
            color: band.textColor,
            marginBottom: 6,
          }}
        >
          {resume.name}
        </Text>
        {contactParts.length > 0 && (
          <Text style={{ fontSize: config.pdf.fontSize - 0.5, color: band.mutedColor, marginBottom: 2 }}>
            {contactParts.join(sep)}
          </Text>
        )}
        {resume.contact.links.length > 0 && (
          <Text style={{ fontSize: config.pdf.fontSize - 1, color: band.mutedColor }}>
            {resume.contact.links.join(sep)}
          </Text>
        )}
      </View>
    );
  }

  if (config.header === "split") {
    return (
      <View style={s.headerSplit}>
        <View>
          <Text style={s.name}>{resume.name}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {contactParts.map((part, i) => (
            <Text key={i} style={s.contactLine}>{part}</Text>
          ))}
          {resume.contact.links.map((link, i) => (
            <Text key={`link-${i}`} style={s.contactLine}>{link}</Text>
          ))}
        </View>
      </View>
    );
  }

  return (
    <>
      <Text style={s.name}>{resume.name}</Text>
      {contactParts.length > 0 && (
        <Text style={s.contactLine}>{contactParts.join(sep)}</Text>
      )}
      {resume.contact.links.length > 0 && (
        <Text style={s.contactLine}>{resume.contact.links.join(sep)}</Text>
      )}
    </>
  );
}

/**
 * Single-column layout (modern, classic, technical)
 */
function SingleColumnLayout({ resume, config, s }: { resume: ResumeJSON; config: TemplateConfig; s: ReturnType<typeof buildStyles> }) {
  const body = (
    <>
      {resume.summary && (
        <>
          <Text style={s.sectionHeading}>Professional Summary</Text>
          <Text style={s.summary}>{resume.summary}</Text>
        </>
      )}

      {resume.experience.length > 0 && (
        <>
          <Text style={s.sectionHeading}>Work Experience</Text>
          {resume.experience.map((job, i) => (
            <View key={i} style={s.jobBlock} wrap={config.allowJobWrap}>
              <View style={s.jobHeader}>
                <Text style={s.jobTitle}>{job.title}</Text>
                <Text style={s.jobDates}>
                  {job.startDate} – {job.endDate}
                </Text>
              </View>
              <Text style={s.company}>
                {job.company}
                {job.location ? `, ${job.location}` : ""}
              </Text>
              {job.bullets.map((bullet, j) => (
                <View key={j} style={s.bullet}>
                  <Text style={s.bulletDot}>{config.bullet.character}</Text>
                  <Text style={s.bulletText}>{bullet}</Text>
                </View>
              ))}
            </View>
          ))}
        </>
      )}

      {resume.skills.length > 0 && (
        <>
          <Text style={s.sectionHeading}>Technical Skills</Text>
          <Text style={s.skillsLine}>
            {resume.skills.join(` ${config.contactSeparator} `)}
          </Text>
        </>
      )}

      {resume.education.length > 0 && (
        <>
          <Text style={s.sectionHeading}>Education</Text>
          {resume.education.map((edu, i) => (
            <View key={i} style={s.eduBlock}>
              <View style={s.eduLine}>
                <Text style={s.jobTitle}>{edu.degree}</Text>
                {edu.year && <Text style={s.jobDates}>{edu.year}</Text>}
              </View>
              <Text style={s.company}>{edu.school}</Text>
              {edu.details && <Text>{edu.details}</Text>}
            </View>
          ))}
        </>
      )}
    </>
  );

  // Spotlight: header band bleeds edge-to-edge; body needs its own padding.
  if (config.header === "band") {
    return (
      <Page size="LETTER" style={{ fontFamily: config.pdf.fontFamily, fontSize: config.pdf.fontSize, color: config.colors.foreground }}>
        <ResumeHeader resume={resume} config={config} styles={s} />
        <View style={{ paddingHorizontal: 48, paddingBottom: 36 }}>{body}</View>
      </Page>
    );
  }

  return (
    <Page size="LETTER" style={s.page}>
      <ResumeHeader resume={resume} config={config} styles={s} />
      {body}
    </Page>
  );
}

/**
 * Two-column sidebar layout (polished)
 * Left sidebar: name, contact, skills, education
 * Right main: summary, experience
 */
function SidebarLayout({ resume, config, s }: { resume: ResumeJSON; config: TemplateConfig; s: ReturnType<typeof buildStyles> }) {
  const sb = config.sidebar!;
  const sidebarHeading = {
    fontSize: 9,
    fontFamily: config.pdf.fontFamilyBold,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    color: sb.textColor,
    marginTop: 18,
    marginBottom: 6,
  };
  const sidebarText = {
    fontSize: 8.5,
    color: sb.mutedColor,
    lineHeight: 1.4,
    marginBottom: 2,
  };

  const contactParts: string[] = [];
  if (resume.contact.email) contactParts.push(resume.contact.email);
  if (resume.contact.phone) contactParts.push(resume.contact.phone);
  if (resume.contact.location) contactParts.push(resume.contact.location);

  return (
    <Page size="LETTER" style={{ fontFamily: config.pdf.fontFamily, fontSize: config.pdf.fontSize, color: config.colors.foreground }}>
      <View style={{ flexDirection: "row", minHeight: "100%" }}>
        {/* Sidebar */}
        <View style={{
          width: sb.width,
          backgroundColor: sb.backgroundColor,
          paddingTop: 36,
          paddingBottom: 36,
          paddingHorizontal: 18,
        }}>
          {/* Name */}
          <Text style={{
            fontSize: 16,
            fontFamily: config.pdf.fontFamilyBold,
            color: sb.textColor,
            marginBottom: 4,
          }}>
            {resume.name}
          </Text>

          {/* Contact */}
          <Text style={sidebarHeading}>Contact</Text>
          {contactParts.map((part, i) => (
            <Text key={i} style={sidebarText}>{part}</Text>
          ))}
          {resume.contact.links.map((link, i) => (
            <Text key={`link-${i}`} style={{ ...sidebarText, fontSize: 7.5 }}>{link}</Text>
          ))}

          {/* Skills */}
          {resume.skills.length > 0 && (
            <>
              <Text style={sidebarHeading}>Skills</Text>
              {resume.skills.map((skill, i) => (
                <Text key={i} style={sidebarText}>{skill}</Text>
              ))}
            </>
          )}

          {/* Education */}
          {resume.education.length > 0 && (
            <>
              <Text style={sidebarHeading}>Education</Text>
              {resume.education.map((edu, i) => (
                <View key={i} style={{ marginBottom: 6 }}>
                  <Text style={{ ...sidebarText, fontFamily: config.pdf.fontFamilyBold, color: sb.textColor, fontSize: 8.5 }}>
                    {edu.degree}
                  </Text>
                  <Text style={sidebarText}>{edu.school}</Text>
                  {edu.year && <Text style={sidebarText}>{edu.year}</Text>}
                </View>
              ))}
            </>
          )}
        </View>

        {/* Main content */}
        <View style={{
          flex: 1,
          paddingTop: 36,
          paddingBottom: 36,
          paddingLeft: 24,
          paddingRight: 36,
        }}>
          {resume.summary && (
            <>
              <Text style={s.sectionHeading}>Professional Summary</Text>
              <Text style={s.summary}>{resume.summary}</Text>
            </>
          )}

          {resume.experience.length > 0 && (
            <>
              <Text style={s.sectionHeading}>Experience</Text>
              {resume.experience.map((job, i) => (
                <View key={i} style={s.jobBlock} wrap={config.allowJobWrap}>
                  <View style={s.jobHeader}>
                    <Text style={s.jobTitle}>{job.title}</Text>
                    <Text style={s.jobDates}>
                      {job.startDate} – {job.endDate}
                    </Text>
                  </View>
                  <Text style={s.company}>
                    {job.company}
                    {job.location ? `, ${job.location}` : ""}
                  </Text>
                  {job.bullets.map((bullet, j) => (
                    <View key={j} style={s.bullet}>
                      <Text style={s.bulletDot}>{config.bullet.character}</Text>
                      <Text style={s.bulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </>
          )}
        </View>
      </View>
    </Page>
  );
}

/**
 * Timeline layout — enhancv-style chronology rail.
 * Header centered; each Experience job is a two-cell flex row (dates-gutter + content).
 * Standard section headings preserved for ATS parsers.
 */
function TimelineLayout({ resume, config, s }: { resume: ResumeJSON; config: TemplateConfig; s: ReturnType<typeof buildStyles> }) {
  const tl = config.timeline!;
  return (
    <Page size="LETTER" style={s.page}>
      <ResumeHeader resume={resume} config={config} styles={s} />

      {resume.summary && (
        <>
          <Text style={s.sectionHeading}>Professional Summary</Text>
          <Text style={s.summary}>{resume.summary}</Text>
        </>
      )}

      {resume.experience.length > 0 && (
        <>
          <Text style={s.sectionHeading}>Experience</Text>
          {resume.experience.map((job, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: config.jobGap }} wrap={config.allowJobWrap}>
              {/* Gutter — dates + accent rail */}
              <View style={{ width: tl.gutterWidth, paddingRight: 10, borderRightWidth: tl.ruleWidth, borderRightColor: tl.ruleColor }}>
                <Text style={{ fontSize: config.pdf.fontSize - 1, color: config.colors.accent, fontFamily: config.pdf.fontFamilyBold }}>
                  {job.startDate}
                </Text>
                <Text style={{ fontSize: config.pdf.fontSize - 1, color: config.colors.muted }}>
                  – {job.endDate}
                </Text>
              </View>
              {/* Content */}
              <View style={{ flex: 1, paddingLeft: 12 }}>
                <Text style={s.jobTitle}>{job.title}</Text>
                <Text style={s.company}>
                  {job.company}
                  {job.location ? `, ${job.location}` : ""}
                </Text>
                {job.bullets.map((bullet, j) => (
                  <View key={j} style={s.bullet}>
                    <Text style={s.bulletDot}>{config.bullet.character}</Text>
                    <Text style={s.bulletText}>{bullet}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </>
      )}

      {resume.skills.length > 0 && (
        <>
          <Text style={s.sectionHeading}>Skills</Text>
          <Text style={s.skillsLine}>
            {resume.skills.join(` ${config.contactSeparator} `)}
          </Text>
        </>
      )}

      {resume.education.length > 0 && (
        <>
          <Text style={s.sectionHeading}>Education</Text>
          {resume.education.map((edu, i) => (
            <View key={i} style={s.eduBlock}>
              <View style={s.eduLine}>
                <Text style={s.jobTitle}>{edu.degree}</Text>
                {edu.year && <Text style={s.jobDates}>{edu.year}</Text>}
              </View>
              <Text style={s.company}>{edu.school}</Text>
              {edu.details && <Text>{edu.details}</Text>}
            </View>
          ))}
        </>
      )}
    </Page>
  );
}

export function ResumeDocument({ resume, template = "modern" }: { resume: ResumeJSON; template?: TemplateName }) {
  const config = templates[template];
  const s = allStyles[template];

  return (
    <Document>
      {config.layout === "sidebar" ? (
        <SidebarLayout resume={resume} config={config} s={s} />
      ) : config.layout === "timeline" ? (
        <TimelineLayout resume={resume} config={config} s={s} />
      ) : (
        <SingleColumnLayout resume={resume} config={config} s={s} />
      )}
    </Document>
  );
}
