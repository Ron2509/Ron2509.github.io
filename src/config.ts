// One chapter per lap sector. `at` is the scroll progress where the camera arrives.
export const CHAPTERS = [
  { id: 'intro', label: 'Start', at: 0 },
  { id: 'profile', label: 'Profile', at: 0.2 },
  { id: 'projects', label: 'Projects', at: 0.4 },
  { id: 'experience', label: 'Experience', at: 0.6 },
  { id: 'pitwall', label: 'Pit wall', at: 0.8 },
  { id: 'contact', label: 'Contact', at: 1 },
] as const

export type ChapterId = (typeof CHAPTERS)[number]['id']
