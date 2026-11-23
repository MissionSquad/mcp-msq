import { z } from 'zod'
import { defineTool } from './tool-definition.js'
import {
  AgentSkillsSetSchema, DirectivesSetSchema, SkillCreateSchema, SkillDeleteSchema, SkillGetSchema, SkillImportSchema,
  SkillUpdateSchema,
} from './skill-schemas.js'

const WHAT_A_SKILL_IS =
  'A skill is a named set of instructions for one kind of task. An agent that has a skill sees only its name and '
  + 'description and loads the full instructions with its load_skill tool when a task matches.'

function skillPath(id: string): string {
  return `core/skills/${encodeURIComponent(id)}`
}

/**
 * Skills and account directives. Every tool reads or changes only the account that owns the API key.
 */
export const skillTools = [
  defineTool({
    name: 'msq_list_skills',
    description:
      `List the account's skills. ${WHAT_A_SKILL_IS} Returns data.owned (id, name, description, enabled, `
      + 'instructionsLength, agents: names of the agents using the skill) and data.shared (skills other accounts shared '
      + 'with this one, readable but not attachable until copied), plus data.limits. Instructions are left out; read them '
      + 'with msq_get_skill. Read-only.',
    parameters: z.object({}),
    run: client => client.requestJson({ method: 'GET', path: 'core/skills' }),
  }),
  defineTool({
    name: 'msq_get_skill',
    description:
      'Read one skill in full by id: name, description, instructions, enabled, owned (false for a skill another account '
      + 'shared), markdown (the skill as SKILL.md text) and, for an owned skill, agents (names of the agents using it). '
      + 'Call this before msq_update_skill. Read-only.',
    parameters: SkillGetSchema,
    run: (client, args) => client.requestJson({ method: 'GET', path: skillPath(args.id) }),
  }),
  defineTool({
    name: 'msq_create_skill',
    description:
      `Create a skill. ${WHAT_A_SKILL_IS} Use a skill instead of a longer system prompt when the instructions are long, `
      + 'only matter for some tasks, or are shared by several agents. Creating a skill does not attach it: follow with '
      + 'msq_set_agent_skills. Fails with 409 and code SKILL_NAME_TAKEN when the name is already used (check '
      + 'msq_list_skills first), or code SKILL_LIMIT_REACHED when the account is at data.limits.maxSkillsPerAccount. '
      + 'Returns the skill with its id.',
    parameters: SkillCreateSchema,
    run: (client, args) => client.requestJson({ method: 'POST', path: 'core/skills', body: args }),
  }),
  defineTool({
    name: 'msq_update_skill',
    description:
      'Replace a skill by id. name, description and instructions are all replaced, so read the skill with msq_get_skill '
      + 'first and send all three back, changing only what is wanted. Omitting enabled keeps the skill enabled or paused '
      + 'as it is. The change applies on the next run of every agent that uses the skill. Set enabled=false to pause a '
      + 'skill without detaching it.',
    parameters: SkillUpdateSchema,
    run: (client, args) => {
      const { id, ...body } = args
      return client.requestJson({ method: 'PUT', path: skillPath(id), body })
    },
  }),
  defineTool({
    name: 'msq_delete_skill',
    description:
      'Delete a skill by id. It is removed from every agent that uses it and its shares are removed. This cannot be '
      + 'undone. Check the agents list from msq_list_skills and confirm with the user first.',
    parameters: SkillDeleteSchema,
    run: (client, args) => client.requestJson({ method: 'DELETE', path: skillPath(args.id) }),
  }),
  defineTool({
    name: 'msq_import_skill',
    description:
      'Create a skill from the text of a SKILL.md file. name and description are read from the front matter and the '
      + 'instructions from the body; other front matter keys are ignored. Only this one file is imported: files and '
      + 'scripts bundled with the skill are not, so instructions that refer to them will not work. Returns the skill and '
      + 'data.replaced (true when overwrite replaced an existing skill).',
    parameters: SkillImportSchema,
    run: (client, args) => client.requestJson({ method: 'POST', path: 'core/skills/import', body: args }),
  }),
  defineTool({
    name: 'msq_set_agent_skills',
    description:
      'Set the complete list of skills on an agent, by skill name or id. The list replaces the agent\'s current skills, so '
      + 'include the ones to keep; msq_list_skills shows which agents use each skill. An empty list removes them all. '
      + 'The agent\'s model must support tool calling, because skills are loaded through a tool. Nothing else about the '
      + 'agent changes. Fails with 400 naming any skill that does not exist.',
    parameters: AgentSkillsSetSchema,
    run: (client, args) => client.requestJson({
      method: 'PUT', path: 'core/update/agent', body: { name: args.agentName, skills: args.skills },
    }),
  }),
  defineTool({
    name: 'msq_get_directives',
    description:
      'Read the account directives: one block of text added to the system prompt of every agent on the account '
      + '(chat, workflows, factories, schedules, pages, shared and published agents). The title agent and the config '
      + 'agent are exempt. Returns data.directives ("" when none are set), updatedAt and maxLength. Read-only.',
    parameters: z.object({}),
    run: client => client.requestJson({ method: 'GET', path: 'core/directives' }),
  }),
  defineTool({
    name: 'msq_set_directives',
    description:
      'Replace the account directives. The text is added to the system prompt of every agent on the account from its '
      + 'next run. This replaces the whole text: read the current text with msq_get_directives and send it back with the '
      + 'change. An empty string clears the directives. Show the user the final text and confirm before calling.',
    parameters: DirectivesSetSchema,
    run: (client, args) => client.requestJson({ method: 'PUT', path: 'core/directives', body: { directives: args.directives } }),
  }),
] as const
