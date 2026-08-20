export interface Role {
  title: string;
  dateRange: string;
  duration: string;
  description: string;
  current: boolean;
}

export interface Organisation {
  name: string;
  duration: string;
  roles: Role[];
}

export const experience: Organisation[] = [
  {
    name: "Patra Corporation",
    duration: "5Y 9M",
    roles: [
      {
        title: "Senior Director of AI Engineering · Head of AI R&D",
        dateRange: "2024.09 → NOW",
        duration: "2Y",
        description:
          "Lead Patra's 45-person AI engineering organization and architected its Agent Platform, a block-based agentic system with deterministic-first execution and portable deployment. Led the accuracy program that raised extraction across 14+ insurance lines from the 80–85% range into the mid-90s, months ahead of schedule, at $0.20 per document against a $1.00 estimate. Drove the shift to AI-native development across the organization: agentic coding tools, evaluation harnesses to judge AI-generated work, and spec-driven templates. Own the AI budget and advise executive leadership on strategy, roadmap, and Responsible AI.",
        current: true,
      },
      {
        title: "Director of AI Engineering",
        dateRange: "2023.10 → 2024.09",
        duration: "1Y",
        description:
          "Led four teams (~20 people) to build and deliver Patra AI, scaling to 12,000 documents and 400,000+ data points extracted monthly. Designed its multi-model architecture (NLP for policy parsing, rules for comparison, LLM extraction with RAG for retrieval) and delivered proprietary models on SageMaker with full lifecycle management. Shipped Patra's first agentic AI system, which found and corrected its own extraction errors; customers saw average handling time drop about 30%.",
        current: false,
      },
      {
        title: "Software Engineering Manager",
        dateRange: "2022.01 → 2023.10",
        duration: "1Y 10M",
        description:
          "Matured Policy Checking Next Generation from first working application into a governed production system, with model performance review and formal code review standards. Drove ML development with BERT, transformers, and NLP for insurance document extraction, owning the architecture and data pipeline behind Patra's AI products, plus the security and observability groundwork under them.",
        current: false,
      },
      {
        title: "Software Engineering Team Lead",
        dateRange: "2020.12 → 2022.01",
        duration: "1Y 2M",
        description:
          "Founded Patra's AI engineering function in a zero-to-one role. Designed, built, and shipped Policy Checking Next Generation, the company's first AI-capable application and origin of its entire AI product line. Architected it as a modular monolith on AWS, so a small team could ship and evolve it quickly, and recruited the team that became Patra's AI organization.",
        current: false,
      },
    ],
  },
  {
    name: "BBVA in the USA",
    duration: "3Y 6M",
    roles: [
      {
        title: "Software Engineering Team Lead",
        dateRange: "2018.12 → 2020.12",
        duration: "2Y 1M",
        description:
          "Engineering lead for BBVA's Online Account Origination platform, owning the credit card service and expanding what customers could do entirely online. Managed two teams totaling 11 engineers and automation developers, shipping new features and integrating BBVA's new technology stack. Designed and deployed Spring Boot and Kubernetes services on AWS EKS, bridging modern front ends with legacy banking systems. Introduced the team's automation framework and an A/B testing framework for validating business ideas.",
        current: false,
      },
      {
        title: "Senior Software Engineer",
        dateRange: "2018.05 → 2018.12",
        duration: "8M",
        description:
          "Front-end lead for BBVA's Online Account Origination platform, managing a team of two engineers and setting the standards the team built on. Built the shared Web Component library, overhauled the build system, and led a driver's license line-detection feature using Hough transforms. Promoted to Team Lead after seven months.",
        current: false,
      },
      {
        title: "Software Engineer",
        dateRange: "2017.07 → 2018.05",
        duration: "11M",
        description:
          "Developed features across BBVA's Online Account Origination and Mobile Banking platforms, spearheading the integration that brought digital account opening (credit cards, CDs, money markets, loans) to iOS and Android for the first time. Shipped the Address Standardization service and a critical fraud detection fix that earned BBVA's Making It Happen Award. Promoted to Senior Software Engineer within ten months.",
        current: false,
      },
    ],
  },
  {
    name: "everis",
    duration: "1Y 2M",
    roles: [
      {
        title: "Software Developer",
        dateRange: "2016.06 → 2017.07",
        duration: "1Y 2M",
        description:
          "Built customer-facing features for BBVA's Online Banking platform as an embedded consultant, including the Credit Card Activation application and reusable widgets like Money Transfer. Increased unit test coverage to over 80% of the application's functionality.",
        current: false,
      },
    ],
  },
  {
    name: "The University of Alabama",
    duration: "1Y 1M",
    roles: [
      {
        title: "Web Developer",
        dateRange: "2015.05 → 2016.05",
        duration: "1Y 1M",
        description:
          "Built a classroom management application in PHP and MySQL that let faculty and staff book and manage classrooms. Delivered a major overhaul of clealabama.com and developed screens and features for law.ua.edu's migration to WordPress.",
        current: false,
      },
    ],
  },
];
