/**
 * Job-posting fixtures for the résumé-generator benchmark.
 * 5 high-fit (DevOps/Platform/SRE/AI-LLMOps/Staff) + 2 low-fit controls
 * (Frontend, UX) so the discrimination check has >=2 control points.
 * Real companies/roles; sourceUrl captured at authoring time (may rot);
 * `text` is the cached JD body the scorer consumes.
 */
export const BENCHMARK_JOBS = [
  {
    id: "j1-senior-devops",
    archetype: "nate-devops",
    fit: "high",
    control: false,
    ats: "greenhouse",
    title: "Senior DevOps Engineer",
    company: "Duetto Research",
    sourceUrl: "https://job-boards.greenhouse.io/duettoresearch/jobs/7811208",
    text: `Senior DevOps Engineer

About the role
Duetto is the leading cloud-native Revenue Strategy platform for the hospitality industry, processing billions of pricing and demand signals for hotels and casino-resorts worldwide. Our DevOps team owns the infrastructure that keeps that platform fast, reliable, and secure. We're looking for a Senior DevOps Engineer who can take ownership of our AWS footprint end to end — from provisioning to pipelines to production observability — and raise the bar on how we ship software.

What you'll do
- Own and evolve our AWS infrastructure across EC2, EKS, ECS, Lambda, S3, RDS, and VPC networking, treating everything as code.
- Author and maintain reusable Terraform modules; we are actively migrating selected stacks to OpenTofu and you'll help drive that.
- Design, build, and maintain CI/CD pipelines in GitHub Actions and Jenkins — fast feedback, automated testing gates, safe progressive deployments.
- Operate and tune our Kubernetes (EKS) clusters: autoscaling, ingress, secrets management, and workload reliability.
- Build observability with Datadog — dashboards, monitors, SLOs — so we catch issues before customers do.
- Automate toil with Python and shell; partner with engineering to improve developer velocity and reduce mean time to recovery.
- Participate in an on-call rotation and lead blameless postmortems.

Requirements
- 7+ years in DevOps, SRE, or infrastructure engineering, with deep hands-on AWS experience across multiple services.
- Strong proficiency with Terraform (or OpenTofu) for infrastructure-as-code in production.
- Production experience with CI/CD tooling including GitHub Actions and Jenkins; GitLab CI a plus.
- Solid Kubernetes operations experience (EKS preferred) and container fundamentals (Docker).
- Scripting fluency in Python and/or JavaScript.
- Experience with a modern observability stack — Datadog strongly preferred.

Nice to have
- Exposure to LLM/AI workloads or MLOps pipelines.
- Cost-optimization and FinOps experience on AWS.
- Security and compliance automation (SOC 2, least-privilege IAM).`,
  },
  {
    id: "j2-platform-eng",
    archetype: "nate-devops",
    fit: "high",
    control: false,
    ats: "lever",
    title: "Senior Platform Engineer",
    company: "Gridware",
    sourceUrl: "https://jobs.lever.co/gridware/c01925b9-1458-4a12-a981-6fb6c6f8d968",
    text: `Senior Platform Engineer
Gridware · Remote (US)

Gridware builds sensing hardware and software that detects faults on the electric grid before they cause wildfires and outages. As we scale, our engineering org needs an internal developer platform that lets product teams ship safely without becoming infrastructure experts. You'll lead the design, build, and rollout of that platform — treating developer experience as a product.

What you'll own
- Internal developer platform: self-service tooling, paved paths, and golden templates that let engineers provision services, environments, and pipelines without filing tickets.
- Infrastructure as code: own reusable Terraform/OpenTofu modules and the patterns teams build on.
- Kubernetes: design and operate our EKS clusters, GitOps deployment workflows (Argo CD), and progressive delivery.
- CI/CD: standardize build and release across the org with GitHub Actions; bake in testing, security scanning, and policy-as-code guardrails.
- Observability defaults: ship golden dashboards and SLO templates (Datadog) so every new service is observable on day one.
- Developer ergonomics: reduce cognitive load and time-to-first-deploy; measure and improve platform adoption.

What we're looking for
- 6+ years in platform, infrastructure, or DevOps engineering.
- Deep AWS (EKS, ECS, EC2, Lambda, S3) and strong Terraform/OpenTofu.
- You've built internal platforms or golden paths before and think about DevEx as a product surface.
- Kubernetes in production; comfortable with GitOps and admission/policy control.
- Strong CI/CD (GitHub Actions) and automation in Python.
- You write clear docs and enjoy unblocking other engineers.

Nice to have
- Backstage or other IDP frameworks.
- Policy-as-code (OPA/Conftest), supply-chain security.
- Interest in AI/LLM tooling for internal developer workflows.`,
  },
  {
    id: "j3-sre",
    archetype: "nate-devops",
    fit: "high",
    control: false,
    ats: "greenhouse",
    title: "Site Reliability Engineer",
    company: "Corelight",
    sourceUrl: "https://job-boards.greenhouse.io/corelight/jobs/7785288",
    text: `Site Reliability Engineer (SRE)

About Corelight
Corelight transforms network and cloud activity into evidence that security teams use to detect, investigate, and respond to threats. Our SaaS platform ingests massive volumes of telemetry, and reliability is a feature our customers depend on. We're hiring an SRE to keep that platform fast, observable, and resilient.

The role
You'll define and operate against SLOs, own incident response, and engineer reliability into our systems rather than bolt it on. You'll work across our AWS and Kubernetes estate, partnering with product engineering to make services production-ready by default.

Responsibilities
- Define SLIs/SLOs and manage error budgets for critical services; drive data-informed reliability decisions.
- Lead incident response: on-call rotation, mitigation, and high-quality blameless postmortems with tracked follow-ups.
- Build and maintain observability — metrics, logs, traces, dashboards, and alerting in Datadog — to shorten detection and recovery.
- Operate Kubernetes (EKS) workloads at scale: capacity planning, autoscaling, and resilience testing.
- Automate operational toil with Python; codify infrastructure with Terraform.
- Improve CI/CD safety: progressive rollouts, automated rollback, and release health checks (GitHub Actions).
- Partner with engineering teams to harden services before launch.

Requirements
- 8+ years in SRE, DevOps, platform, or cloud infrastructure roles.
- Strong experience defining and operating against SLOs and error budgets in production.
- Production Kubernetes experience (EKS, GKE, or AKS) and container fundamentals.
- Deep AWS experience (EC2, EKS, Lambda, S3, networking).
- Observability expertise — Datadog, Prometheus/Grafana, or OpenTelemetry.
- Infrastructure-as-code with Terraform and scripting in Python.
- Calm, structured incident leadership and clear written communication.

Nice to have
- Experience operating high-throughput data or streaming systems.
- Chaos/resilience engineering practice.
- Exposure to running AI/LLM inference workloads reliably in production.`,
  },
  {
    id: "j4-ai-llmops",
    archetype: "nate-devops",
    fit: "high",
    control: false,
    ats: "ashby",
    title: "Applied AI Engineer (Agents & Evals)",
    company: "Future",
    sourceUrl: "https://job-boards.greenhouse.io/future/jobs/4683133005",
    text: `Applied AI Engineer (Agents & Evals)

Hey 👋 — we're building AI agents that real users actually rely on, and we need someone who's done the unglamorous, high-leverage work of making LLM systems trustworthy in production. If you've shipped agents, written evals you'd stake a release on, and care about reliability as much as cleverness, read on.

What you'll be doing
- Build and ship AI agents that serve real users — tool/function-calling LLM systems on the Anthropic Claude platform (and others), with structured outputs and multi-step workflows.
- Design evaluation harnesses and quality scoring: regression tests, task-based success metrics, and LLM-as-judge graders you can trust to gate deploys.
- Own the LLMOps loop — prompt engineering, versioning, tracing, cost/latency monitoring, and continuous eval — so agent quality only goes up.
- Wire agents into production infra: deploy on our AWS stack, containerize on Kubernetes, and stand up CI/CD (GitHub Actions) that runs evals on every change.
- Instrument everything (Datadog) — token spend, latency, failure modes — and close the loop with offline eval datasets.
- Partner with product to define what "good" means for each agent and make that measurable.

What we're looking for
- Strong Python (you live in it); comfortable with JavaScript/TypeScript for glue and tooling.
- Hands-on LLM-in-production experience: prompt engineering, tool calling, structured output, and evaluation. Anthropic Claude / API experience is a big plus.
- You've built eval frameworks — multi-turn testing, regression, and success metrics — not just demos.
- Solid software and infra fundamentals: AWS, containers/Kubernetes, and CI/CD. You can deploy your own agents.
- Bias toward measurement over vibes. You don't ship agent changes without an eval to back them.

Nice to have
- DevOps/SRE background — observability, reliability, infra-as-code (Terraform).
- Experience with agent frameworks, RAG, or vector stores.
- You've operated cost and latency for LLM workloads at scale.`,
  },
  {
    id: "j5-staff-platform",
    archetype: "nate-devops",
    fit: "high",
    control: false,
    ats: "workday",
    title: "Principal Platform Engineer",
    company: "Workday",
    sourceUrl: "https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/Principal-Platform-Engineer_JR-0106270",
    text: `Principal Platform Engineer

About the Team
The Platform Engineering organization at Workday builds the infrastructure, tooling, and golden paths that thousands of engineers use to ship software safely and quickly. As a Principal Platform Engineer, you will set technical direction for org-wide platform initiatives, influence architecture across multiple teams, and raise operational standards without relying on formal authority.

About the Role
- Set and drive the multi-quarter technical strategy for our internal developer platform, infrastructure-as-code standards, and deployment workflows across the engineering organization.
- Lead complex, cross-team initiatives end to end — resolving ambiguity, negotiating trade-offs with senior leaders, and delivering measurable outcomes.
- Define and govern platform patterns: Terraform/OpenTofu module standards, Kubernetes (EKS) cluster architecture, CI/CD conventions (GitHub Actions, GitLab), and policy-as-code guardrails.
- Establish reliability and observability standards — SLOs, error budgets, and Datadog dashboards — that every service inherits by default.
- Review platform health signals (CI/CD success rates, cluster health, key service SLOs) and drive systemic improvements to throughput, incident frequency, and time-to-recovery.
- Coach senior and staff engineers on infrastructure design, operational excellence, and secure-by-default engineering; elevate review quality and engineering standards across the org.
- Partner with leadership to align platform investment with business priorities and quantify impact.

Basic Qualifications
- 12+ years of software, infrastructure, or platform engineering experience, including senior technical leadership.
- Deep expertise in AWS at scale (EC2, EKS, ECS, Lambda, S3) and infrastructure-as-code with Terraform/OpenTofu.
- Proven track record operating Kubernetes and CI/CD systems for large engineering organizations.
- Strong programming ability (Python and/or JavaScript) and automation discipline.

Other Qualifications
- Experience building internal developer platforms and golden paths adopted across many teams.
- Track record of influencing architecture and standards across an org without direct authority.
- Familiarity with running AI/LLM or MLOps workloads on shared platform infrastructure.`,
  },
  {
    id: "j6-frontend",
    archetype: "nate-devops",
    fit: "low",
    control: true,
    ats: "greenhouse",
    title: "Senior Frontend Engineer, Design Systems",
    company: "Chime",
    sourceUrl: "https://job-boards.greenhouse.io/chime/jobs/8375225002",
    text: `Senior Frontend Engineer, Design Systems

About the role
Chime is a financial technology company built on the premise that basic banking services should be helpful, easy, and free. Our Design Systems team builds the shared UI foundation — components, patterns, and tooling — that every product team uses to ship consistent, accessible experiences across web and mobile. We're hiring a Senior Frontend Engineer to own and evolve that system.

What you'll do
- Design, build, and maintain a reusable component library in React, React Native, and TypeScript used by dozens of product teams.
- Craft pixel-accurate, accessible UI — semantic HTML, ARIA, keyboard navigation, and WCAG compliance are non-negotiable.
- Own theming and styling architecture (CSS-in-JS, design tokens, responsive layouts) and keep it consistent across light/dark modes and platforms.
- Partner closely with product designers in Figma to translate designs into robust, documented components.
- Improve frontend developer experience: Storybook documentation, visual regression testing, and component APIs that are a joy to use.
- Optimize rendering performance, bundle size, and Core Web Vitals for consumer-facing surfaces.

What we're looking for
- 6+ years of active web and/or mobile development experience.
- Deep expertise in React, React Native, and TypeScript.
- Mastery of CSS, responsive design, and modern styling systems (CSS-in-JS, Tailwind, design tokens).
- Experience building and maintaining design systems or shared component libraries at scale.
- Strong eye for visual detail, accessibility, and interaction design.
- Track record collaborating with designers and shipping polished consumer UI.

Nice to have
- Experience with animation libraries and micro-interactions.
- Familiarity with Figma plugins or design-to-code tooling.
- Contributions to open-source UI libraries.`,
  },
  {
    id: "j7-ux-designer",
    archetype: "nate-devops",
    fit: "low",
    control: true,
    ats: "lever",
    title: "Senior Product Designer",
    company: "Articulate",
    sourceUrl: "https://jobs.lever.co/articulate/76a17f4d-8b38-4896-af16-ce3d7dc10df2",
    text: `Senior Product Designer
Articulate · Remote

Articulate makes the world's best-loved e-learning software. We're looking for a Senior Product Designer to shape end-to-end product experiences — from early discovery and user research through polished, implementation-ready design.

What you'll do
- Lead the design of complex product features from concept to launch, owning the full UX process.
- Plan and conduct user research: interviews, usability tests, and surveys; synthesize findings into clear, actionable insights.
- Create wireframes, interactive prototypes, and high-fidelity designs in Figma using component-based methodologies and shared libraries.
- Contribute to and evolve our scalable design system; ensure consistency, accessibility, and craft across the product.
- Partner with product managers and engineers to balance user needs, business goals, and feasibility.
- Champion user-centered design and a strong point of view on interaction and visual design.

What we're looking for
- 5+ years of product design experience shipping consumer or SaaS products.
- Fluency in Figma and experience working with design systems.
- Strong understanding of user research, usability testing, and data-informed design decisions.
- A portfolio demonstrating end-to-end UX thinking — research, IA, interaction, and visual design.
- Excellent communication and the ability to articulate design rationale to cross-functional partners.

Nice to have
- Experience designing for e-learning, education, or creative tools.
- Motion/prototyping skills and a sharp eye for visual polish.
- Experience facilitating design workshops and design-thinking sessions.`,
  },
];

export const CONTROL_IDS = BENCHMARK_JOBS.filter((j) => j.control).map((j) => j.id); // ["j6-frontend","j7-ux-designer"]
