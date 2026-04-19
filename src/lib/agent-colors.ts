// Deterministic chip palette so each agent gets a consistent color across the
// calendar. Tailwind classes ship at build-time, so the strings must be
// literal — no interpolation.

export type AgentTint = {
  bg:     string
  border: string
  text:   string
}

const PALETTE: AgentTint[] = [
  { bg: 'bg-violet-500/30',   border: 'border-violet-500/50',   text: 'text-violet-100'   },
  { bg: 'bg-emerald-500/30',  border: 'border-emerald-500/50',  text: 'text-emerald-100'  },
  { bg: 'bg-sky-500/30',      border: 'border-sky-500/50',      text: 'text-sky-100'      },
  { bg: 'bg-amber-500/30',    border: 'border-amber-500/50',    text: 'text-amber-100'    },
  { bg: 'bg-rose-500/30',     border: 'border-rose-500/50',     text: 'text-rose-100'     },
  { bg: 'bg-fuchsia-500/30',  border: 'border-fuchsia-500/50',  text: 'text-fuchsia-100'  },
  { bg: 'bg-teal-500/30',     border: 'border-teal-500/50',     text: 'text-teal-100'     },
  { bg: 'bg-orange-500/30',   border: 'border-orange-500/50',   text: 'text-orange-100'   },
]

const UNASSIGNED: AgentTint = {
  bg: 'bg-gray-500/20', border: 'border-gray-500/40', text: 'text-gray-200',
}

function hash(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function tintForAgent(agentId: string | null | undefined): AgentTint {
  if (!agentId) return UNASSIGNED
  return PALETTE[hash(agentId) % PALETTE.length]
}
