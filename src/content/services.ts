/**
 * "What SKOLAR does": editable service content.
 *
 * ⚠️ These services follow the service areas listed in the website brief,
 * which were marked "subject to our actual business offerings". Every entry is
 * `confirmed: false` until the SKOLAR team signs off the wording. Edit the
 * copy here, set `confirmed: true`, or delete an entry. In development, unconfirmed
 * entries show a small marker.
 */

export interface Service {
  id: string;
  title: string;
  description: string;
  /** What the student comes away with. Concrete, never a promise of outcome. */
  outcome: string;
  confirmed: boolean;
}

export interface ServicePhase {
  id: string;
  label: string;
  heading: string;
  image: { src: string; alt: string };
  services: Service[];
}

export const servicePhases: ServicePhase[] = [
  {
    id: "decide",
    label: "Decide",
    heading: "Choose where and what to study",
    image: { src: "/images/library-reading-hall.webp", alt: "Students reading in a bright, columned university library" },
    services: [
      {
        id: "discovery",
        title: "University discovery & shortlisting",
        description:
          "We help you build a shortlist of universities and programmes that suit your grades, subject, budget and preferred destination.",
        outcome: "A shortlist you can research and compare",
        confirmed: false,
      },
      {
        id: "course",
        title: "Course selection guidance",
        description:
          "Compare programmes by content, teaching language, duration and where they can lead, so the course fits your goals as well as the university name.",
        outcome: "A clearer view of which courses suit you",
        confirmed: false,
      },
      {
        id: "requirements",
        title: "Understanding admission requirements",
        description:
          "We go through each programme's requirements with you: qualifications, grades, entrance tests and language certificates, and what you still need.",
        outcome: "A checklist of what each programme asks for",
        confirmed: false,
      },
    ],
  },
  {
    id: "apply",
    label: "Apply",
    heading: "Prepare strong, complete applications",
    image: { src: "/images/students-studying.webp", alt: "Students working together at library tables" },
    services: [
      {
        id: "application",
        title: "Application guidance",
        description: "Step-by-step help preparing and submitting your applications in the right order and on time.",
        outcome: "A clear plan for every application",
        confirmed: false,
      },
      {
        id: "documents",
        title: "Documentation guidance",
        description:
          "Know which documents each application needs, including translations and legalisation, and how to prepare them correctly.",
        outcome: "A document list for each application",
        confirmed: false,
      },
      {
        id: "scholarships",
        title: "Scholarship information & guidance",
        description:
          "Information on scholarships and funding you may be able to apply for, and help understanding their conditions and deadlines.",
        outcome: "Funding options worth looking into",
        confirmed: false,
      },
    ],
  },
  {
    id: "prepare",
    label: "Prepare",
    heading: "Move forward with support",
    image: { src: "/images/students-campus.webp", alt: "Students walking along a tree-lined path to campus" },
    services: [
      {
        id: "counselling",
        title: "Counselling & application support",
        description: "A SKOLAR counsellor is there to help through the process and answer your questions as decisions come up.",
        outcome: "Someone to ask at each step",
        confirmed: false,
      },
      {
        id: "next-stages",
        title: "Preparing for the next stages",
        description:
          "Guidance on what comes after an offer: enrolment steps, visa paperwork and planning your move abroad.",
        outcome: "A plan for the steps after an offer",
        confirmed: false,
      },
    ],
  },
];
