import labels from './content/labels.json'

/**
 * Everything the shop says, in one place.
 *
 * The words that are modelled into the world — the name in neon over the
 * counter, the four arrow signs, the name tag, the name and roles painted on
 * the floor — live in `content/labels.json`, which Blender reads too: change
 * those and rebuild + rebake (see README). Everything else here is painted on
 * the screens at runtime and changes with a reload.
 *
 * All of it is Stefano Doko's own copy, carried over from his portfolio
 * (`stefano-portfolio`: lib/i18n/dictionaries.ts, lib/projects.ts,
 * PRODUCT.md). Nothing here is invented: his brief forbids stating any
 * project, client, outcome, year, role or link that the evidence does not
 * support, so where he has no data (articles, social profiles) this site
 * has none either.
 */
export type Project = {
  title: string
  blurb: string
  url?: string
  /** two colours for the poster: the sunburst and the ink */
  colours: [string, string]
  /** a short mark for the poster, one to three characters */
  mark: string
  tags: string[]
}

export const LABELS = labels

/** his deployed portfolio; the contact sign opens its form */
const SITE = 'https://stefano-porotfolio.vercel.app'

export const CONTENT = {
  name: labels.name,
  roles: labels.roles,

  about: {
    headline: 'One pair of hands',
    intro: [
      'One pair of hands takes the work from the first sketch to the last commit. Nothing is handed over, so nothing arrives broken.',
      'I design the thing and then I build it. No handover, no translation loss between a file and a repository, no second party to blame when the two disagree.',
    ],
    skills: [
      { group: 'Craft', items: ['Web design', 'Frontend development', 'UI/UX', 'Creative development', 'Digital experiences'] },
      { group: 'Stack', items: ['Next.js', 'TypeScript', 'Tailwind CSS', 'GSAP', 'React Three Fiber', 'Postgres'] },
      { group: 'Languages', items: ['Italian', 'English', 'Albanian'] },
    ],
    /** how the work runs, in his words */
    processIntro: 'Five passes, in order. Each one ends with something you can look at, not a status update.',
    process: [
      { step: '01', label: 'Brief', body: 'We agree what the site has to do, who it is for, and what it must not become. The constraints get written down before anything is drawn.' },
      { step: '02', label: 'Structure', body: 'Content and hierarchy first. What a page says and in what order is settled while it is still cheap to change.' },
      { step: '03', label: 'Design', body: 'Art direction happens in the browser, at real widths, with real copy. A design that only works in a static file is not finished.' },
      { step: '04', label: 'Build', body: 'Production code, typed throughout, measured against a performance budget rather than a feeling. Accessibility is part of the build, not a pass at the end.' },
      { step: '05', label: 'Ship', body: 'Deploy, measure the result, and hand over something you can run yourself. You own the code and the accounts.' },
    ],
  },

  /** the two shipped sites: live, his end to end; posters in each site's own colours */
  projects: [
    {
      title: 'Elixir',
      blurb: 'An online perfume house. Designer, Arabic and niche bottles, catalogued and sold across Albania, on a warm near-black ground built to make a bottle worth looking at.',
      url: 'https://elixir.al',
      colours: ['#c7a86b', '#0b0a09'],
      mark: '01',
      tags: ['Luxury perfume e-commerce', 'Catalogue and cart', 'Designer, Arabic and niche', 'Ships across Albania', '2025'],
    },
    {
      title: 'Bar Martiri',
      blurb: 'A bar on the sand at Spille. The menu, the sunbeds and the walk down to the sea, in three languages, for people deciding where to spend the afternoon.',
      url: 'https://barmartiri.com',
      colours: ['#56c4d8', '#14130f'],
      mark: '02',
      tags: ['Hospitality / bar experience', 'Menu and sunbeds', 'Three languages', 'Spille, on the coast', '2025'],
    },
  ] as Project[],

  /** the Contact sign opens the form on his site, one gesture away like there */
  contactUrl: `${SITE}/en#contact`,

  credits: [
    { title: 'Credits', lines: ['A portfolio for ' + labels.name, 'Web designer and developer', 'Built with Three.js and Blender'] },
    { title: 'Thanks', lines: ['After jesse-zhou.com by Jesse Zhou', 'The three.js and Blender contributors'] },
    { title: 'Press start', lines: ['Click again to loop', '© ' + new Date().getFullYear() + ' ' + labels.name] },
  ],

  /** where to find him: the form on his site and the two sites themselves */
  social: [
    { label: 'Contact form', url: `${SITE}/en#contact` },
    { label: 'elixir.al', url: 'https://elixir.al' },
    { label: 'barmartiri.com', url: 'https://barmartiri.com' },
  ],

  /** the strip above the arcade, in the words his own site's cash machine prints */
  ticker: ['SITES SHIPPED ▲ 2', 'ELIXIR.AL ▲ LIVE', 'BARMARTIRI.COM ▲ LIVE', 'CAPABILITIES ▲ 5', 'LANGUAGES ▲ 3', 'HANDOVERS ▼ 0'],
}
