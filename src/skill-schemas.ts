import { z } from 'zod'

const NonEmptyString = z.string().trim().min(1)

const SkillName = z.string().trim().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'Use lowercase letters, digits and single hyphens, for example "weekly-report".'
).max(64)

const SkillId = NonEmptyString.max(64).describe('Skill id from msq_list_skills.')

const skillFields = {
  name: SkillName.describe('Unique name within the account: lowercase letters, digits and single hyphens, at most 64 characters.'),
  description: NonEmptyString.max(1024).describe(
    'What the skill does and when to use it, in one or two sentences. This is all the agent sees when deciding '
    + 'whether to load the skill, so name the task it applies to. At most 1024 characters.'
  ),
  instructions: NonEmptyString.max(50_000).describe(
    'The full instructions the agent follows after loading the skill. Markdown. Complete and self-contained. At most 50000 characters.'
  ),
  enabled: z.boolean().optional().describe(
    'Set false to stop offering the skill to agents while keeping it attached. Defaults to true.'
  ),
}

export const SkillCreateSchema = z.object(skillFields)

export const SkillGetSchema = z.object({ id: SkillId })

export const SkillUpdateSchema = z.object({
  id: SkillId,
  ...skillFields,
  enabled: z.boolean().optional().describe(
    'Set false to pause the skill, true to resume it. Omit to leave it as it is.'
  ),
})

export const SkillDeleteSchema = z.object({ id: SkillId })

export const SkillImportSchema = z.object({
  content: NonEmptyString.max(60_000).describe(
    'The complete text of a SKILL.md file: front matter between two --- lines that sets name and description, '
    + 'followed by the instructions. At most 60000 characters.'
  ),
  overwrite: z.boolean().optional().describe(
    'Set true to replace an existing skill with the same name, keeping its id so agents that use it get the new text. '
    + 'Without it an existing name is refused.'
  ),
})

export const AgentSkillsSetSchema = z.object({
  agentName: NonEmptyString.describe('Exact name of the agent, as msq_list_agents reports it.'),
  skills: z.array(NonEmptyString).max(50).describe(
    'The complete list of skills the agent should have, by skill name or id. This replaces the current list: '
    + 'include the skills to keep. An empty list removes every skill. At most 50.'
  ),
})

export const DirectivesSetSchema = z.object({
  directives: z.string().max(8000).describe(
    'The complete directives text. This replaces the current text; send the existing text plus any addition. '
    + 'An empty string clears the directives. At most 8000 characters.'
  ),
})
