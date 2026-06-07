/**
 * Five job descriptions used for the Phase A baseline matrix.
 *
 * Chosen for intentional stretch across both test resumes:
 *   j1 devops-senior — natural fit for Nate, off-specialty for ML candidate
 *   j2 backend-staff — stretches both toward backend framing
 *   j3 ml-senior     — natural fit for ML candidate, off-specialty for Nate
 *   j4 principal     — senior leadership framing stress
 *   j5 generalist    — mid-level generic SWE; tests over-optimization
 */
export const JOBS = [
  {
    id: "j1-devops-senior",
    title: "Senior DevOps / Platform Engineer",
    company: "StripeCloud",
    text: `Senior DevOps / Platform Engineer

About the role
We're looking for a Senior DevOps Engineer to own our cloud infrastructure and internal developer platform. You'll work across our AWS footprint, design and maintain CI/CD pipelines for 40+ services, and be the technical lead on reliability for our core transaction path.

What you'll do
- Own and evolve our Terraform-based infrastructure-as-code across multiple AWS accounts
- Design, build, and maintain GitHub Actions CI/CD pipelines for polyglot services (Go, Python, Node)
- Improve deploy safety through progressive delivery, feature flags, and automated rollback
- Partner with product teams to build platform-level abstractions that reduce per-team ops burden
- Lead incident response for production issues, author postmortems, drive follow-up action items
- Mentor junior and mid-level engineers on operational excellence

What we're looking for
- 6+ years of experience in DevOps, SRE, or platform engineering
- Deep AWS expertise (EC2, VPC, IAM, Lambda, RDS)
- Strong Terraform or equivalent infrastructure-as-code
- Python or Go for infrastructure automation
- Experience running CI/CD at scale — we value pragmatic, security-aware pipeline design
- Track record of cross-team technical leadership

Nice to have
- Datadog or similar observability platform expertise
- Kubernetes / container orchestration
- Zero-downtime deployment patterns (blue/green, canary)
`,
  },
  {
    id: "j2-backend-staff",
    title: "Staff Backend Engineer — Payments Platform",
    company: "FinSci Corp",
    text: `Staff Backend Engineer — Payments Platform

We're building the next generation of our payments platform and looking for a Staff Backend Engineer to lead the design of our core ledger and settlement systems. This is a deeply technical role with significant cross-team influence.

Responsibilities
- Design and build distributed backend services that process 2M+ transactions per day
- Lead architectural decisions on consistency, idempotency, and failure handling for money-movement workflows
- Partner with DevOps on deployment architecture, CI/CD, and observability for the payments stack
- Mentor engineers and drive engineering quality via code review, design docs, and RFC processes
- Collaborate with Risk, Compliance, and Product on domain modeling

What you bring
- 8+ years building production backend systems, ideally with experience in payments or fintech
- Strong Python or Go; comfortable with database internals (Postgres, Redis)
- Distributed systems fundamentals: consistency, partitioning, replication
- Experience with event-driven architectures and message queues (Kafka, SQS)
- Background designing CI/CD pipelines and deployment strategies for critical infrastructure
- Demonstrated technical leadership on cross-team initiatives

Bonus
- Terraform, Kubernetes, or equivalent infrastructure-as-code background
- Open source contributions
- Experience mentoring junior engineers through formal or informal programs
`,
  },
  {
    id: "j3-ml-senior",
    title: "Senior Machine Learning Engineer — Ranking",
    company: "Metrographer",
    text: `Senior Machine Learning Engineer — Ranking

Metrographer powers search and discovery experiences for consumer marketplaces. We're hiring a Senior ML Engineer to own our core ranking stack end-to-end.

What you'll own
- Design, train, evaluate, and deploy ranking models (learning-to-rank, two-tower, transformers)
- Build feature engineering pipelines in Python and Spark backed by an online feature store
- Define and run A/B tests end-to-end, with proper experimental design and power analysis
- Collaborate with product to prioritize model improvements based on business impact
- Mentor ML engineers on experiment hygiene, reproducibility, and deployment patterns

Requirements
- 5+ years building production ML systems, ideally in recommendation or search
- Deep Python, PyTorch or TensorFlow, and modern MLOps tooling (Airflow, Kubeflow, MLflow)
- Experience with offline → online evaluation gaps and causal inference for ranking
- Statistical rigor around A/B testing and experimental design
- Feature leakage awareness and point-in-time correctness for training data

Nice to have
- Two-tower, matrix-factorization, or neural retrieval experience
- Published work in ranking or recommendation systems
- SageMaker or Vertex AI production experience
`,
  },
  {
    id: "j4-principal",
    title: "Principal Software Engineer — Platform",
    company: "ResidencyOps",
    text: `Principal Software Engineer — Platform

ResidencyOps is the modern platform for medical residency programs. We're looking for a Principal Engineer to set technical direction for our platform engineering organization and be the senior-most engineering voice in the company.

This role is ~70% technical leadership, 30% hands-on. You'll work across engineering leadership to raise our bar on reliability, architecture, and engineering culture.

You'll be a fit if you've
- 10+ years of engineering experience, including time as a staff or principal engineer
- Led technical strategy for large, multi-team engineering initiatives
- Partnered with engineering managers on org design, career ladders, and engineering hiring
- Designed and run technical training programs (hands-on TDD, XP practices, pair programming)
- Shipped production systems on AWS or equivalent public cloud
- Strong opinions on CI/CD, infrastructure-as-code, observability, and deployment safety
- Experience mentoring senior ICs and formally or informally leading engineering communities

What you'll do in your first 6 months
- Develop a technical strategy doc for our platform and get it adopted
- Identify 3 highest-leverage platform investments and shepherd them through design → rollout
- Stand up an internal engineering-excellence community with regular technical training
- Partner with VP Engineering on engineering-wide review processes

Background in healthcare/regulated industry is a plus but not required.
`,
  },
  {
    id: "j5-generalist",
    title: "Software Engineer — Full Stack",
    company: "OrbitStudio",
    text: `Software Engineer — Full Stack

OrbitStudio is a 20-person startup building collaboration tools for creative teams. We need a full-stack Software Engineer who's comfortable owning features end-to-end.

You'll
- Build and ship features across our React frontend and Python / Node backend
- Write production-quality code with appropriate test coverage
- Participate in code review, design discussions, and shipping cadence
- Work closely with designers and product on small, fast iterations

We're looking for
- 3+ years building web applications (React strongly preferred)
- Comfortable in Python and/or Node for backend work
- Strong CS fundamentals — data structures, API design, debugging
- Self-directed — we're small, we won't micromanage
- Interest in working on small, shippable features, not long multi-month projects

Nice to have
- Experience at startups or small teams
- Open source contributions
- Design sensibility — opinions on product UX are welcomed
`,
  },
];
