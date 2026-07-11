/**
 * Job posting fixtures for the Haiku 4.5 perf optimization suite.
 *
 * Each job carries:
 *   - id          — stable identifier referenced by the cohort matrix
 *   - archetype   — resume cohort this job pairs with (matches resumes/*.txt)
 *   - ats         — which ATS source the URL came from (drives extraction
 *                   testing; "paste" = no URL, paste-fallback edge case)
 *   - title, company  — surface metadata
 *   - sourceUrl   — live URL captured during fixture build; may rot
 *   - text        — cached job description used by the tailoring scorer.
 *                   Style intentionally mirrors that ATS's typical layout
 *                   (Greenhouse → "About the role / What you'll do" sections;
 *                   Lever → terser skills-list; Workday → formal bullets;
 *                   LinkedIn → mixed; Ashby → startup-casual).
 *
 * 9 archetypes × ~3 ATS = 25 URL-backed fixtures + 4 paste-only edge
 * cases = 29 fixtures total. Distribution favors Workday/LinkedIn
 * because that reflects the real-world prevalence users will paste.
 */

export const JOBS = [
  // ============================================================
  // 01 — SWE mid-level
  // ============================================================
  {
    id: "j01-swe-greenhouse",
    archetype: "swe-mid",
    ats: "greenhouse",
    title: "Senior Software Engineer (ReactJS, Node)",
    company: "2U",
    sourceUrl: "https://boards.greenhouse.io/2u/jobs/6230243002",
    text: `Senior Software Engineer (ReactJS, Node)

About the role
The Learning Experience Engineering team at 2U builds the digital classroom experience used by 250,000+ learners across 80+ university programs. We're hiring a Senior Software Engineer to make material technical contributions to our React + Node.js platform, partnering with product and pedagogy teams to ship learner-impacting features.

What you'll do
- Design, build, and maintain user-facing React applications (TypeScript, modern hooks, Redux Toolkit) used by hundreds of thousands of learners
- Build and own backend services in Node.js / Express that serve coursework, assessments, and analytics
- Improve our deploy pipeline and developer ergonomics — we ship continuously and value tooling investment
- Partner with senior engineers on architecture decisions for a multi-tenant platform spanning 80+ programs
- Mentor mid-level engineers; participate in interview loops and team hiring

What we're looking for
- 5+ years of professional software engineering with at least 3 in TypeScript / JavaScript
- Strong React (hooks, context, modern state management) and Node.js production experience
- Comfortable across the stack — we don't strictly silo frontend vs backend
- Track record of shipping production features with measurable user impact
- Excellent written communication; we're a remote-first team and writing matters

Nice to have
- Experience with edtech, LMS, or learner-facing platforms
- AWS infrastructure familiarity (Lambda, RDS, S3)
- Open source contributions

Compensation: $120,000 – $157,000 base + bonus + equity. Remote-first.`,
  },
  {
    id: "j02-swe-lever",
    archetype: "swe-mid",
    ats: "lever",
    title: "Junior Software Engineer (Full Stack, React and Node)",
    company: "CSC Generation",
    sourceUrl: "https://jobs.lever.co/cscgeneration-2/a5b3aef8-b02a-4436-832d-60be4fdc66cc/",
    text: `Junior Software Engineer (Full Stack, React and Node)
CSC Generation · Remote

We're a venture-backed e-commerce holding company building modern infrastructure for legacy retail brands. Looking for a junior full-stack engineer (1–3 years of experience) to ship features across our React + Node + Postgres stack.

Responsibilities
- Build customer-facing storefront features using React, Next.js, and TypeScript
- Develop backend services in Node.js (Express, NestJS) connecting to Postgres and Redis
- Write tests, review PRs, and ship to production at least weekly
- Pair with senior engineers to grow your skills

Requirements
- 1+ years of professional software development experience
- Comfortable with TypeScript, React, and Node.js fundamentals
- Familiar with relational databases and REST APIs
- Strong written and verbal communication
- Bonus: experience with e-commerce, AWS, or Docker

This is a high-growth environment — if you ship more than you talk, you'll thrive here.`,
  },
  {
    id: "j03-swe-workday",
    archetype: "swe-mid",
    ats: "workday",
    title: "Software Engineer, Labs",
    company: "Pax8",
    sourceUrl: "https://pax8inc.wd12.myworkdayjobs.com/en-US/Pax8Careers/job/United-States/Software-Engineer--Labs_R-101775",
    text: `Software Engineer, Labs

Job Description
Pax8 is hiring a Software Engineer to join the Labs team, a small group focused on building human-AI interfaces for our cloud commerce marketplace serving 35,000+ MSPs globally.

Position Summary
The Software Engineer, Labs designs, develops, and maintains experimental product surfaces that integrate large language models with our existing platform. This role partners closely with product, design, and ML to take ideas from prototype to production.

Essential Responsibilities
- Develop full-stack features in TypeScript / React / Node.js
- Integrate LLM APIs (OpenAI, Anthropic, internal model gateway) into user-facing flows
- Maintain robust testing, observability, and deployment automation
- Collaborate with cross-functional partners across Product, Design, and ML

Qualifications
- 3+ years of full-stack software engineering experience
- Proficiency in TypeScript, React, and Node.js
- Familiarity with cloud-native deployment patterns (AWS, GCP, or Azure)
- Experience integrating third-party APIs in production
- Bachelor's degree in Computer Science or equivalent practical experience

Preferred
- Prior LLM / generative AI integration experience
- Experience with multi-tenant SaaS at scale
- Contributions to open source

Pax8 is committed to creating an inclusive workplace.`,
  },

  // ============================================================
  // 02 — Sales AE (Mid-Market SaaS)
  // ============================================================
  {
    id: "j04-sales-greenhouse",
    archetype: "sales-ae",
    ats: "greenhouse",
    title: "Mid-Market Account Executive",
    company: "Calm",
    sourceUrl: "https://boards.greenhouse.io/calm/jobs/4761649002",
    text: `Mid-Market Account Executive — Calm Business

About the role
Calm Business is the workplace mental health arm of Calm, the world's #1 app for sleep, meditation, and stress. We sell into HR and Total Rewards leaders at mid-market companies (1K–10K employees). We're hiring a Mid-Market Account Executive to own a named-account territory and grow our footprint in the segment.

What you'll do
- Carry a $1.2M ARR quota across ~75 named mid-market accounts
- Run full-cycle sales: prospecting, discovery, demo, proposal, negotiation, and close
- Partner with SDRs on territory planning and outbound campaigns
- Navigate multi-stakeholder buying processes (HR, Benefits, Wellness, Procurement)
- Use MEDDPICC (or equivalent) to qualify and forecast
- Contribute to product feedback loops with the Calm Business product team

What we're looking for
- 3+ years of quota-carrying B2B SaaS sales experience, ideally selling HR or benefits tech
- Track record of meeting or exceeding quota for at least 2 of the last 3 years
- Strong outbound discipline and pipeline-generation skills
- Comfortable with Salesforce, Outreach, Gong
- Bonus: experience with Force Management, Challenger, or MEDDPICC frameworks

Compensation: $130K base + $130K variable (OTE $260K) + equity.`,
  },
  {
    id: "j05-sales-lever",
    archetype: "sales-ae",
    ats: "lever",
    title: "Account Executive, Mid Market",
    company: "Highlight",
    sourceUrl: "https://jobs.lever.co/Highlight/004fbc6f-23f6-463c-bc4e-4d366648146f",
    text: `Account Executive, Mid Market
Highlight · Remote / NY

Highlight is a Series B consumer insights platform. We help brands like Pepsi, Hersheys, and Conagra run product testing studies with real consumers in days, not months.

The role
We're hiring a Mid-Market Account Executive to sell into mid-sized CPG brands ($100M–$2B revenue). You'll own a territory of named accounts and run the full sales cycle from outbound to close.

You'll
- Own a $700K–$900K annual quota
- Self-source ~50% of pipeline through targeted outbound
- Run discovery, demo, proposal, and close cycles (typical deal cycle: 60–90 days, $40K–$80K ACV)
- Partner with marketing on ABM campaigns and event follow-up
- Contribute to product roadmap based on customer feedback

You bring
- 4–7 years of B2B SaaS sales, with at least 2 in a quota-carrying AE role
- Experience selling into CPG, market research, or insights platforms is a strong plus
- Track record of building pipeline through outbound (not just closing inbound)
- Familiarity with MEDDPICC, Command of the Message, or equivalent frameworks
- Comfort with Salesforce, Outreach, Gong, LinkedIn Sales Navigator

We pay competitively and offer meaningful equity.`,
  },
  {
    id: "j06-sales-linkedin",
    archetype: "sales-ae",
    ats: "linkedin",
    title: "Mid-Market Account Executive (AI SaaS)",
    company: "DualEntry",
    sourceUrl: "https://www.linkedin.com/jobs/view/mid-market-account-executive-ai-saas-at-dualentry-4269653841",
    text: `Mid-Market Account Executive (AI SaaS)
DualEntry · Full-time · Mid-Senior Level

DualEntry is a high-growth AI startup automating financial close workflows for mid-market companies. We've grown from $0 to $8M ARR in 18 months and are hiring our first dedicated mid-market AE to expand the segment.

Role
- Own a $1M+ ARR quota in your first year
- Sell into Controllers, VPs of Finance, and CFOs at $50M–$1B revenue companies
- Run a full sales cycle averaging 45–60 days
- Partner with Sales Engineering on technical demos and POCs
- Help shape the playbook for the segment as the first dedicated MM AE

Requirements
- 3–6 years of B2B SaaS sales experience, with at least 2 in a closing role
- Strong outbound DNA — you build pipeline, not wait for it
- Comfortable selling technical products to finance buyers
- Track record of consistent quota attainment

OTE: $230K – $280K. Equity. Remote-first.

Seniority level: Mid-Senior level
Employment type: Full-time
Job function: Sales
Industries: Software Development`,
  },

  // ============================================================
  // 03 — Registered Nurse (ICU)
  // ============================================================
  {
    id: "j07-rn-workday-rochester",
    archetype: "rn-clinical",
    ats: "workday",
    title: "Critical Care ICU – Registered Nurse, Level I",
    company: "University of Rochester Medical Center",
    sourceUrl: "https://rochester.wd5.myworkdayjobs.com/en-US/UR_Nursing/job/Critical-Care-ICU--Nurse-Residency-Program---Med-Surg--hiring-now-for-March-2026-start----Registered-Nurse--Level-I_R262401",
    text: `Critical Care ICU – Nurse Residency Program – Med/Surg
Registered Nurse, Level I — Hiring for March 2026 start

Department: Strong Memorial Hospital, Medical/Surgical Critical Care
Location: 601 Elmwood Ave, Rochester, NY
Compensation: $37.00 – $40.70 / hour
Schedule: Rotating shifts, 36 hours/week

Position Summary
The Registered Nurse provides direct patient care to critically ill adult patients in the Medical-Surgical ICU. The Level I designation is for new graduate nurses or RNs with less than 1 year of experience entering our 12-month Nurse Residency Program.

Essential Responsibilities
- Provide direct nursing care for assigned patients in accordance with the New York State Nurse Practice Act
- Administer medications, perform assessments, and document care in EPIC
- Collaborate with multidisciplinary team including physicians, respiratory therapists, and pharmacists
- Participate in unit-based council and quality improvement initiatives
- Complete the 12-month Nurse Residency Program curriculum

Required Qualifications
- BSN from an accredited nursing program
- Valid New York State RN license OR Compact license (NLC) at time of hire
- BLS certification (American Heart Association)
- Ability to obtain ACLS within 6 months of hire

Preferred
- Prior critical care clinical rotation experience
- Strong assessment and prioritization skills

The University of Rochester is an Equal Opportunity Employer.`,
  },
  {
    id: "j08-rn-workday-allina",
    archetype: "rn-clinical",
    ats: "workday",
    title: "RN Critical Care Float Pool",
    company: "Allina Health",
    sourceUrl: "https://allina.wd5.myworkdayjobs.com/External/job/RN-Critical-Care-Float-Pool_R-0070279",
    text: `RN Critical Care Float Pool

Department: Critical Care Float Pool
Location: Minneapolis, MN
Schedule: 36 hours / week, 12-hour shifts, rotating

Position Summary
The Critical Care Float Pool RN provides direct nursing care across multiple ICU settings (Med-Surg, Cardiovascular, and Neuro ICUs). After six months in the float pool, RNs receive cross-training in the Emergency Department, with additional opportunities in PACU and select outpatient areas.

Essential Responsibilities
- Float across Med-Surg ICU, CVICU, and Neuro ICU based on staffing needs
- Provide direct patient care to acutely ill adults including hemodynamic monitoring, vasopressor titration, ventilator management, and post-op recovery
- Use EPIC for documentation and order entry
- Collaborate with physicians, advanced practice providers, and ancillary services
- Mentor newer staff and participate in unit-based education

Required Qualifications
- 2+ years of recent ICU experience required
- BSN preferred; ADN with active enrollment in BSN program acceptable
- Active Minnesota or Compact RN license
- BLS, ACLS required at hire; PALS within 6 months
- TNCC preferred

Allina Health offers competitive compensation, comprehensive benefits, and a 401(k) with employer match.`,
  },
  {
    id: "j09-rn-linkedin",
    archetype: "rn-clinical",
    ats: "linkedin",
    title: "Clinical Nurse (Registered Nurse) CICU – Cardiac Intensive Care Unit",
    company: "The University of Kansas Health System",
    sourceUrl: "https://www.linkedin.com/jobs/view/clinical-nurse-registered-nurse-cicu-cardiac-intensive-care-unit-at-the-university-of-kansas-health-system-3632141925",
    text: `Clinical Nurse (Registered Nurse) — Cardiac Intensive Care Unit (CICU)
The University of Kansas Health System · Kansas City, KS · Full-time

Position Overview
The CICU Clinical Nurse provides expert nursing care to critically ill cardiac patients including post-cardiac surgery, heart failure, and acute coronary syndrome populations. Our 24-bed CICU is staffed by RNs trained in advanced hemodynamic monitoring, IABP, Impella, and ECMO support.

Responsibilities
- Provide direct patient care to assigned cardiac ICU patients (typical ratio 1:1 or 1:2)
- Monitor and manage vasoactive drips, mechanical circulatory support, and post-cardiotomy patients
- Collaborate with cardiothoracic surgery, cardiology, and critical care intensivist teams
- Participate in unit education, simulation training, and skills validation
- Mentor newly hired RNs and nursing students during clinical placements

Qualifications
- BSN from an accredited program required
- Active Kansas RN license or Compact license
- BLS and ACLS at hire; CCRN within 18 months of eligibility
- Prior critical care experience preferred

Seniority: Mid-Senior level
Employment type: Full-time
Industry: Hospital & Health Care`,
  },

  // ============================================================
  // 04 — Retail Store Manager
  // ============================================================
  {
    id: "j10-retail-workday-skechers",
    archetype: "retail-mgr",
    ats: "workday",
    title: "Retail Store Manager",
    company: "Skechers",
    sourceUrl: "https://skechers.wd5.myworkdayjobs.com/en-US/One-career-site/job/Retail-Store-Manager_JR124111",
    text: `Retail Store Manager

Position Summary
The Retail Store Manager leads and inspires a team to deliver exceptional customer service, achieve sales goals, and maintain visual merchandising standards. The Store Manager is responsible for total store P&L including sales, payroll, shrink, and operational compliance.

Essential Job Functions
- Drive store sales performance against monthly, quarterly, and annual targets
- Recruit, hire, train, and develop the store team (typical staff: 12–25 associates)
- Manage payroll budget and weekly scheduling to optimize coverage and labor cost
- Execute visual merchandising standards per corporate directives
- Oversee inventory accuracy, shrink controls, and cycle counts
- Ensure operational compliance with all corporate policies and applicable laws

Qualifications
- 3+ years of retail management experience, with at least 2 in a Store Manager or equivalent role
- Proven track record of driving sales growth and developing team members
- Strong organizational, leadership, and conflict-resolution skills
- Comfort with retail KPIs (UPT, AOV, conversion, comp sales)
- Ability to work nights, weekends, and holidays as required by business needs

Education
- High school diploma required; bachelor's degree preferred

Skechers is an Equal Opportunity Employer.`,
  },
  {
    id: "j11-retail-greenhouse-tecovas",
    archetype: "retail-mgr",
    ats: "greenhouse",
    title: "Retail Store Manager (Baton Rouge)",
    company: "Tecovas",
    sourceUrl: "https://boards.greenhouse.io/tecovas/jobs/6291609002",
    text: `Retail Store Manager — Baton Rouge

About Tecovas
Tecovas is a fast-growing direct-to-consumer Western brand best known for handmade cowboy boots. We've grown from a single online store to 30+ retail locations across the country, and we're just getting started.

The opportunity
We're looking for a Full-Time Store Manager to lead and inspire by taking a forward-thinking, omni-channel approach to the retail experience. You'll be the face of Tecovas in Baton Rouge — leading a team of 8–15 associates, driving sales, and delivering the kind of customer experience our brand is known for.

What you'll do
- Lead a team to deliver against store sales, conversion, AOV, and customer-experience KPIs
- Recruit, hire, train, and develop store associates and assistant managers
- Manage payroll budget, scheduling, and operational excellence (inventory, shrink, store standards)
- Partner with the omni team to integrate online + in-store customer journeys
- Build a culture rooted in genuine hospitality and craftsmanship

What we're looking for
- 4+ years of retail leadership, with at least 2 as a Store Manager
- Track record of driving comp sales growth and developing internal talent
- Comfort with omni-channel retail (BOPIS, ship-from-store, endless aisle)
- Genuine passion for hospitality and brand-building

Compensation: $75K – $90K + bonus + equity.`,
  },
  {
    id: "j12-retail-workday-loft",
    archetype: "retail-mgr",
    ats: "workday",
    title: "Store Manager — Shops at River Park",
    company: "LOFT (Knitwell Group)",
    sourceUrl: "https://knitwellgroup.wd1.myworkdayjobs.com/en-US/US_Retail_Jobs/job/Store-Manager--Shops-at-River-Park_R-2024272",
    text: `Store Manager — LOFT, Shops at River Park

Position Summary
As Store Manager for LOFT at Shops at River Park, you will lead the customer and associate experience while driving a profitable business through focused execution of customer experience, operational performance, and visual standards.

Key Responsibilities
- Lead the day-to-day operations of the store, including sales, customer experience, and team development
- Recruit, train, and develop a high-performing team of associates and supervisors
- Drive store profitability through payroll management, shrink reduction, and inventory accuracy
- Execute visual merchandising and brand standards per corporate guidelines
- Build a customer-first culture grounded in inclusive, personalized service

Qualifications
- 3+ years of retail management experience, ideally in apparel
- Demonstrated success leading a team to achieve sales and operational targets
- Strong communication, coaching, and conflict-resolution skills
- Comfort with retail KPIs and standard scheduling tools
- Flexibility to work nights, weekends, and peak retail seasons

Knitwell Group includes the LOFT, Ann Taylor, Lane Bryant, Talbots, and Chico's brands. We are committed to building a diverse and inclusive workplace.`,
  },

  // ============================================================
  // 05 — Restaurant General Manager
  // ============================================================
  {
    id: "j13-restaurant-workday-shakeshack",
    archetype: "restaurant-gm",
    ats: "workday",
    title: "Restaurant General Manager",
    company: "Shake Shack",
    sourceUrl: "https://shakeshack.wd5.myworkdayjobs.com/External/job/Restaurant-General-Manager_JR12194",
    text: `Restaurant General Manager

Job Description
Shake Shack is hiring a General Manager to lead one of our high-volume Shacks. The GM is responsible for the total restaurant experience: hospitality, team development, operations, and financial performance.

Position Summary
The General Manager owns the full P&L for a restaurant generating $4M–$8M in annual revenue and leads a team of 35–70 team members across two dayparts.

Essential Functions
- Lead total restaurant operations including hospitality, food safety, labor, and financial performance
- Recruit, hire, train, develop, and retain a high-performing team
- Own the restaurant P&L including food cost, labor cost, controllable expenses, and overall margin
- Build a culture of hospitality grounded in Shake Shack's Stand For Something Good values
- Partner with Area Director and corporate teams on initiatives, openings, and brand programs

Qualifications
- 5+ years of restaurant management experience, with at least 2 in a GM or equivalent role at a high-volume concept
- Demonstrated ability to develop team members and reduce turnover
- Strong financial acumen — comfortable with cost lines, scheduling, and labor management
- ServSafe Manager Certification (or willingness to obtain within 60 days of hire)
- Fluent English; bilingual Spanish a strong plus in many markets

Shake Shack offers competitive base pay, bonus eligibility, equity, and best-in-class benefits.`,
  },
  {
    id: "j14-restaurant-linkedin",
    archetype: "restaurant-gm",
    ats: "linkedin",
    title: "Restaurant Manager — Fine Dining",
    company: "Gecko Hospitality (Corporate)",
    sourceUrl: "https://www.linkedin.com/jobs/view/restaurant-manager-fine-dining-at-gecko-hospitality-corporate-3784876354",
    text: `Restaurant Manager — Fine Dining
Gecko Hospitality · Shrewsbury, MA · Full-time

About the role
We are searching for a passionate, hospitality-driven Restaurant Manager for an established fine dining concept in Shrewsbury, MA. The restaurant features a contemporary American menu, an extensive wine program, and a loyal regional clientele.

Responsibilities
- Lead front-of-house operations for a 120-seat fine dining concept generating $5M+ annual revenue
- Oversee a team of 25 servers, hosts, runners, bartenders, and sommeliers
- Maintain a 4.7+ Google rating through proactive guest recovery and service consistency
- Partner with the Executive Chef on menu rollouts, wine pairings, and tasting events
- Manage labor cost, scheduling, and FOH cost lines

Qualifications
- 5+ years of fine dining management experience required
- Strong wine knowledge; certified sommelier preferred
- Track record of building and retaining FOH teams in a high-standard environment
- Hospitality-first mindset with strong guest-facing presence
- ServSafe Manager certification

Compensation: $75K – $95K base + bonus + comprehensive benefits.

Seniority level: Mid-Senior level
Employment type: Full-time
Industry: Restaurants`,
  },

  // ============================================================
  // 06 — Marketing Coordinator
  // ============================================================
  {
    id: "j15-mktg-ashby-sanguine",
    archetype: "mktg-coord",
    ats: "ashby",
    title: "B2B Marketing Manager — SaaS Growth & Campaigns",
    company: "Sanguine",
    sourceUrl: "https://jobs.ashbyhq.com/sanguinesa/20c8fd2b-1ea5-4b12-8175-6f9edfa81950",
    text: `B2B Marketing Manager — SaaS Growth & Campaigns
Sanguine · Remote

Hey 👋

Sanguine is a marketing services company embedded with high-growth B2B SaaS companies. We're looking for a Marketing Manager to drive marketing execution for one of our flagship SaaS clients — a Series B vertical SaaS platform doing $20M+ ARR.

What you'll own
- The full B2B SaaS marketing mix: paid, content, webinars, email, lifecycle
- Campaign execution end-to-end — from brief to launch to measurement
- HubSpot administration, segmentation, and reporting
- Working alongside the in-house team as an embedded contributor

About you
- 2–4 years of B2B SaaS marketing experience (in-house or agency)
- Hands-on with HubSpot, Mailchimp, or comparable tooling
- Comfortable owning end-to-end campaigns and reporting on outcomes
- Strong written communication — you can write a brief, an email, and a webinar abstract
- Curious and self-directed; we don't micromanage

Bonus
- Experience with content marketing, webinars, or event marketing
- Familiarity with B2B lifecycle / nurture flows

Sanguine is fully remote. We pay competitively and we keep meetings short.`,
  },
  {
    id: "j16-mktg-lever-leantaas",
    archetype: "mktg-coord",
    ats: "lever",
    title: "Content Marketing Manager",
    company: "LeanTaaS",
    sourceUrl: "https://jobs.lever.co/leantaas/585fad14-8fd6-4db5-b7b4-443bb02fda6c",
    text: `Content Marketing Manager
LeanTaaS · Remote

LeanTaaS provides AI-powered software to help health systems run their operations more efficiently. We work with 150+ health systems and 700+ hospitals.

The role
Develop, create, and optimize high-impact content across the LeanTaaS product portfolio. This role is weighted most heavily toward content strategy, writing, and website content performance.

Responsibilities
- Own the editorial calendar and execution for blog, long-form, webinars, and customer stories
- Write and publish 2–4 pieces per month directly; manage a roster of freelance writers and SMEs
- Partner with product marketing on launch content (product pages, one-pagers, decks)
- Drive measurable improvement in organic traffic, MQLs, and content-attributed pipeline
- Maintain SEO hygiene and technical content standards

Requirements
- 2–5 years of content marketing experience in B2B SaaS
- Strong writing portfolio — ideally including healthcare or healthtech work
- Hands-on with HubSpot, WordPress, or similar CMS
- Comfortable measuring content performance via GA4, HubSpot, or Looker

Bonus
- Prior healthcare / healthtech marketing experience
- Experience working with hospital operations or clinical buyers`,
  },
  {
    id: "j17-mktg-lever-willow",
    archetype: "mktg-coord",
    ats: "lever",
    title: "Marketing Manager — Global SaaS Company",
    company: "Willow",
    sourceUrl: "https://jobs.lever.co/willowinc/ab1c289d-4446-4ddb-af3d-d6854b72fa1d",
    text: `Marketing Manager — Global SaaS Company
Willow · Hybrid (NYC)

Willow is the global leader in connected building digital twins. We're hiring a Marketing Manager to lead customer marketing initiatives and support key marketing functions including webinars, trade shows, and customer experiences.

What you'll do
- Lead customer marketing programs (case studies, customer councils, executive events)
- Plan and execute 8–12 webinars per year across product, customer, and partner topics
- Own logistics for 4–6 trade shows per year (RealComm, NEXUS, IBcon)
- Partner with product marketing on launch campaigns and sales enablement
- Manage agency relationships and creative production

Requirements
- 3–6 years of B2B marketing experience, ideally at a SaaS or PropTech company
- Hands-on event and webinar production experience
- Strong project management skills — you can run 6 projects in parallel without dropping balls
- Comfort with HubSpot, Salesforce, and standard MarTech stack
- Excellent written and verbal communication

Willow operates globally — you'll partner with teams in NY, London, and Sydney.`,
  },

  // ============================================================
  // 07 — Senior Financial Analyst / Accountant
  // ============================================================
  {
    id: "j18-accountant-workday-groupon",
    archetype: "accountant",
    ats: "workday",
    title: "Senior Financial Systems Analyst (NetSuite, Coupa, Snaplogic)",
    company: "Groupon",
    sourceUrl: "https://groupon.wd5.myworkdayjobs.com/es/jobs/job/Senior-Financial-Systems-Analyst--Netsuite--Coupa--Snaplogic-_R28830-1",
    text: `Senior Financial Systems Analyst (NetSuite, Coupa, Snaplogic)

Job Description
Groupon is hiring a Senior Financial Systems Analyst to support the financial systems landscape across NetSuite, Coupa, and Snaplogic. This role partners closely with the Controllership, FP&A, and IT teams to maintain and evolve the financial systems supporting global operations.

Essential Responsibilities
- Provide functional and technical support for NetSuite (GL, AP, AR, ARM, multi-book)
- Maintain and improve Coupa procure-to-pay configurations and integrations
- Develop and maintain Snaplogic data pipelines connecting financial systems
- Partner with the technical accounting team on ASC 606 and ASC 842 system configurations
- Lead month-end close systems support and resolve user-reported issues
- Document procedures, configurations, and process flows

Qualifications
- 4+ years of financial systems experience, with deep NetSuite functional / technical expertise
- Strong working knowledge of GAAP, ASC 606, and ASC 842
- Experience with Coupa or comparable procure-to-pay platform
- Excellent analytical, documentation, and communication skills

Preferred
- CPA or progress toward CPA
- Experience supporting public-company financial close processes
- Prior SaaS or marketplace company experience`,
  },
  {
    id: "j19-accountant-linkedin-goto",
    archetype: "accountant",
    ats: "linkedin",
    title: "Senior Financial Analyst",
    company: "GoTo",
    sourceUrl: "https://www.linkedin.com/jobs/view/senior-financial-analyst-at-goto-3511345552",
    text: `Senior Financial Analyst
GoTo · Remote · Full-time

About the role
GoTo is hiring a Senior Financial Analyst to join our FP&A team supporting our SaaS revenue lines. You'll partner with business unit leaders, build models, and own monthly forecast cycles.

Responsibilities
- Build and maintain financial models supporting forecasts, budgets, and long-range plans
- Partner with business leaders to develop monthly reporting packages
- Analyze SaaS metrics (ARR, NRR, churn, expansion) and provide insight to leadership
- Support quarterly board materials and investor reporting
- Drive process improvements and automation in FP&A workflows

Requirements
- 3–5 years of FP&A experience, preferably in mid-to-large-scale SaaS
- Familiarity with ASC 606 and revenue recognition principles
- Proficiency in NetSuite, Tableau, and Salesforce
- Advanced Excel modeling skills (INDEX/MATCH, dynamic arrays, scenario analysis)
- CPA or CFA progress is a plus

Seniority level: Mid-Senior level
Employment type: Full-time
Industries: Software Development`,
  },
  {
    id: "j20-accountant-linkedin-forter",
    archetype: "accountant",
    ats: "linkedin",
    title: "Senior Financial Analyst",
    company: "Forter",
    sourceUrl: "https://www.linkedin.com/jobs/view/senior-financial-analyst-at-forter-3082545289",
    text: `Senior Financial Analyst
Forter · New York, NY · Full-time

About Forter
Forter is the trust platform for digital commerce. We protect the world's largest brands from fraud while enabling more legitimate transactions.

The role
The Senior Financial Analyst supports management and investor reporting, analyzes company performance, and supports budgeting, reforecasting, and cross-functional partnership with go-to-market and product teams.

Responsibilities
- Build and maintain financial models supporting our annual budget and quarterly reforecasts
- Drive monthly reporting cycle including variance analysis and KPI reporting
- Partner with sales, marketing, and customer success on cohort and unit-economics analysis
- Support board and investor reporting deliverables
- Identify and drive automation opportunities across FP&A processes

Requirements
- 3–5 years of FP&A or strategic finance experience in B2B SaaS
- Proficiency in Excel modeling, NetSuite, and BI tools (Tableau, Looker, or similar)
- Familiarity with SaaS metrics and ASC 606 revenue recognition
- Strong communication; comfortable presenting to senior leadership

Seniority level: Mid-Senior level
Employment type: Full-time`,
  },

  // ============================================================
  // 08 — HVAC Service Technician
  // ============================================================
  {
    id: "j21-hvac-linkedin-nj",
    archetype: "hvac-tech",
    ats: "linkedin",
    title: "HVAC Service Technician",
    company: "New Jersey Resources",
    sourceUrl: "https://www.linkedin.com/jobs/view/hvac-service-technician-at-new-jersey-resources-2784777181",
    text: `HVAC Service Technician
New Jersey Resources · Lakewood, NJ · Full-time

NJR is hiring an experienced HVAC Service Technician to join our central NJ workforce. We service residential and light commercial customers across the region.

Responsibilities
- Perform service, repair, and maintenance on residential heating and cooling equipment
- Diagnose and repair gas furnaces, heat pumps, central AC systems, and indoor air quality equipment
- Run 6–8 service calls per day across an assigned territory
- Build customer relationships and recommend preventative maintenance plans
- Maintain accurate paperwork, parts inventory, and service ticket documentation

Requirements
- 7–10 years of residential HVAC service experience
- EPA Section 608 Universal certification (Type I, II, III)
- Master HVAC license, or in process of obtaining
- Valid driver's license with clean record
- Strong customer service and communication skills

Preferred
- NATE certification (Air Conditioning, Heat Pumps)
- Experience with ServiceTitan or comparable field-service software

Seniority level: Mid-Senior level
Employment type: Full-time
Industry: Utilities`,
  },
  {
    id: "j22-hvac-linkedin-jll",
    archetype: "hvac-tech",
    ats: "linkedin",
    title: "Apartment Service Technician (HVAC / EPA Certified)",
    company: "JLL Living",
    sourceUrl: "https://www.linkedin.com/jobs/view/apartment-service-technician-hvac-epa-certified-at-jll-living-poland-4345035057",
    text: `Apartment Service Technician (HVAC / EPA Certified)
JLL Living · Full-time

The role
We're hiring an Apartment Service Technician with HVAC certification to join our property management team supporting a 350-unit luxury apartment community. You'll handle resident service requests, preventative maintenance, and unit turns.

Responsibilities
- Diagnose and repair HVAC systems including residential split systems, package units, and PTACs
- Respond to resident service requests within agreed SLAs
- Complete preventative maintenance on common-area systems
- Support apartment unit turns including HVAC inspections and repairs
- Maintain accurate work-order documentation in property management software

Requirements
- 3+ years of HVAC service experience, preferably in multifamily
- EPA Section 608 certification required
- Familiarity with electrical, plumbing, and appliance repair sufficient for an on-call generalist role
- Valid driver's license
- Strong customer-service mindset; you'll interact with residents daily

Compensation: Competitive hourly + benefits + on-site housing discount.`,
  },

  // ============================================================
  // 09 — Elementary School Teacher
  // ============================================================
  {
    id: "j23-teacher-linkedin-leander",
    archetype: "teacher-elem",
    ats: "linkedin",
    title: "2025/2026 Elementary School Teacher (Reading Specialist)",
    company: "Leander ISD",
    sourceUrl: "https://www.linkedin.com/jobs/view/2025-2026-elementary-school-teacher-5-reading-specialist-at-leander-isd-4215028832",
    text: `2025/2026 Elementary School Teacher — Reading Specialist
Leander ISD · Leander, TX · Full-time

Position Summary
Leander ISD is hiring an Elementary School Teacher with a focus on reading specialist responsibilities for the 2025/2026 school year. The reading specialist supports K–5 students through targeted literacy intervention and partners with classroom teachers on Tier 1 instruction.

Responsibilities
- Provide direct instruction to students individually and in small groups to develop literacy skills
- Implement comprehensive literacy programs by coaching and supporting classroom teachers in best practices
- Use diagnostic and progress-monitoring assessments to inform instruction
- Partner with the campus RTI/MTSS team on tiered intervention planning
- Participate in district-level literacy professional development and PLCs

Qualifications
- Texas Teacher Certification (Elementary or Reading Specialist)
- Master's degree in Reading Education or related field preferred
- Experience implementing the Science of Reading
- Strong knowledge of phonics, phonemic awareness, fluency, vocabulary, and comprehension instruction
- 3+ years of elementary classroom teaching experience preferred

Leander ISD is a high-performing district north of Austin with 40,000+ students and is committed to instructional excellence.

Seniority level: Entry level
Employment type: Full-time
Industry: Primary and Secondary Education`,
  },
  {
    id: "j24-teacher-linkedin-northampton",
    archetype: "teacher-elem",
    ats: "linkedin",
    title: "Reading Specialist — Elementary",
    company: "Northampton County Public Schools",
    sourceUrl: "https://www.linkedin.com/jobs/view/reading-specialist-elementary-at-northampton-county-public-schools-3028635106",
    text: `Reading Specialist — Elementary
Northampton County Public Schools · Machipongo, VA · Full-time

Position Summary
Northampton County Public Schools is hiring a Reading Specialist to support K–5 students at our elementary campus. The Reading Specialist provides direct intervention to students reading below grade level and supports classroom teachers in implementing evidence-based literacy practices.

Essential Functions
- Deliver Tier 2 and Tier 3 reading interventions to identified students
- Administer and analyze literacy assessments (DIBELS, PALS, district benchmarks)
- Coach K–5 classroom teachers on the Science of Reading and explicit instruction
- Co-lead the campus literacy team and contribute to school-wide goals
- Communicate progress with families and case manage student progress
- Participate in IEP/504 meetings as a literacy resource

Qualifications
- Virginia Teaching License with Reading Specialist endorsement (or in progress)
- Master's degree in Reading or Literacy preferred
- 3+ years of elementary teaching experience
- LETRS or comparable Science of Reading training preferred
- Strong collaboration and coaching skills

Northampton County Public Schools serves the Eastern Shore of Virginia and is committed to equitable outcomes for every student.

Seniority level: Mid-Senior level
Employment type: Full-time`,
  },

  // ============================================================
  // PASTE-ONLY EDGE CASES (no source URL — paste-fallback path)
  // ============================================================
  {
    id: "j25-paste-restaurant-small",
    archetype: "restaurant-gm",
    ats: "paste",
    title: "Restaurant General Manager (Independent)",
    company: "Salt & Sail Bistro",
    sourceUrl: null,
    text: `Salt & Sail Bistro is hiring a General Manager.

We are a 90-seat coastal-American bistro in Newport, RI doing about $2.4M in annual revenue. Independently owned, no corporate parent, no franchise. Looking for a hands-on GM who knows what it's like to run a small restaurant where the buck stops with you.

Day-to-day:
- Manage a team of about 28 people (18 FOH, 10 BOH including kitchen)
- Own the schedule, payroll, ordering, vendor relationships, and Square POS
- Front of house presence on busy nights — we expect the GM on the floor Friday and Saturday
- Help the chef plan menu pricing, food costing, and weekly specials
- Handle guest complaints, vendor disputes, the occasional health-dept walk-through

What we're looking for:
- 5+ years restaurant management, with at least 2 as a GM at an independent or small group
- Solid food and labor cost discipline (we run food at 30%, labor at 32%)
- Hospitality-first attitude — we are not a corporate concept
- ServSafe Manager
- Bilingual English/Spanish a big plus given our kitchen team

Pay: $72K base + bonus tied to food/labor cost and guest review scores.`,
  },
  {
    id: "j26-paste-hvac-small",
    archetype: "hvac-tech",
    ats: "paste",
    title: "HVAC Service Technician — Family-Owned Shop",
    company: "Greene's Heating & Cooling",
    sourceUrl: null,
    text: `Greene's Heating & Cooling is hiring an experienced HVAC Service Technician to join our team in Lexington, KY.

We're a third-generation family-owned HVAC company with 14 trucks on the road serving residential and light commercial customers. We don't do high-pressure sales. We do honest service work and we treat our techs like family.

The job:
- Service and repair residential split systems, heat pumps, gas furnaces, mini-splits
- 5–7 calls per day average, dispatched from our Lexington office
- Light installs as needed (we have a dedicated install crew but service techs help during peak)
- Build customer relationships — many of our calls are repeat customers

You bring:
- 3+ years of residential HVAC service experience
- EPA Section 608 (Universal preferred)
- Clean driving record
- Tools of the trade
- A good attitude — we're a small shop and culture matters

Pay: $32–$40/hr DOE plus full benefits (health, dental, paid vacation, simple IRA match). Take-home truck and gas card. Year-round work — no layoffs.

Bonus: NATE certification and ServiceTitan experience.`,
  },
  {
    id: "j27-paste-teacher-rural",
    archetype: "teacher-elem",
    ats: "paste",
    title: "2nd Grade Classroom Teacher",
    company: "Hillsdale Christian Academy",
    sourceUrl: null,
    text: `Hillsdale Christian Academy — 2nd Grade Classroom Teacher
Position open for the 2026–2027 school year.

Hillsdale Christian Academy is a small private school in rural Ohio serving about 240 students K–12. We are hiring a 2nd grade classroom teacher to lead a class of about 18 students.

Position responsibilities:
- Plan and deliver daily instruction across all subjects (reading, math, science, social studies)
- Implement our Science of Reading-aligned literacy curriculum (Open Court Reading)
- Co-plan with the K–2 grade-level team weekly
- Communicate with families through weekly newsletters and parent-teacher conferences
- Participate in chapel, assemblies, and one extracurricular per term

What we're looking for:
- Ohio teaching license (Elementary K–5)
- Bachelor's degree in Education or related field; Master's preferred
- 2+ years of classroom experience preferred but new graduates with strong recommendations welcomed
- Personal Christian faith and alignment with the school's statement of beliefs
- Strong classroom management

Compensation: $42,000 – $48,000 based on experience plus tuition discount for staff children. We are a small school with a strong sense of community.`,
  },
  {
    id: "j28-paste-retail-boutique",
    archetype: "retail-mgr",
    ats: "paste",
    title: "Boutique Store Manager",
    company: "Field & Forge Mercantile",
    sourceUrl: null,
    text: `Field & Forge Mercantile is hiring a Store Manager for our flagship Asheville, NC location.

We're a small-batch home goods and apparel boutique. Our customers are people who care about where things are made and who made them. Most of what we sell is sourced from US makers we've personally visited.

Role:
- Run day-to-day store operations: open and close, scheduling, register, vendor receiving
- Lead a team of 5 part-time associates
- Curate visual displays in partnership with the owner
- Build customer relationships — we have a tight repeat-customer base
- Manage Shopify POS, inventory counts, and weekly sales reporting
- Help plan and host 1–2 in-store events per month (trunk shows, maker meet-and-greets)

We're looking for:
- 3+ years of retail experience with at least 1 in a supervisory/lead role
- Real interest in small-batch goods and the craft economy — our customers can tell when staff care
- Strong Shopify or Square POS experience
- Comfort with a small-business environment (you'll wear several hats)
- Visual merchandising sense — we change the floor every 4–6 weeks

Pay: $52K base + quarterly profit-share + 30% staff discount.`,
  },
];

/**
 * Sanity-check: every JOB.archetype maps to a resume file in resumes/.
 * Throws at module load if the matrix is broken (e.g., typo in archetype).
 */
const VALID_ARCHETYPES = new Set([
  "swe-mid",
  "sales-ae",
  "rn-clinical",
  "retail-mgr",
  "restaurant-gm",
  "mktg-coord",
  "accountant",
  "hvac-tech",
  "teacher-elem",
]);

for (const j of JOBS) {
  if (!VALID_ARCHETYPES.has(j.archetype)) {
    throw new Error(`fixture ${j.id}: unknown archetype "${j.archetype}"`);
  }
  if (!j.id || !j.text) {
    throw new Error(`fixture ${j.id}: missing required fields`);
  }
}

/**
 * ATS distribution summary, computed at module load for harness reporting.
 */
export const ATS_DISTRIBUTION = JOBS.reduce((acc, j) => {
  acc[j.ats] = (acc[j.ats] || 0) + 1;
  return acc;
}, {});

export const ARCHETYPE_DISTRIBUTION = JOBS.reduce((acc, j) => {
  acc[j.archetype] = (acc[j.archetype] || 0) + 1;
  return acc;
}, {});
