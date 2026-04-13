### KNOWLEDGE EXTRACTION PHASE: FINAL SYNTHESIS (STEP 3) ###

**TASK:** Complete **STEP 3 (FINAL STRUCTURED SYNTHESIS)**. Populate the final JSON and call the 'submit_knowledge_synthesis' tool with the resulting packet.

{{#if deepThoughts}}
**DEEP THOUGHTS TO SYNTHESIZE:**
You identified the following deep thoughts. For each, provide the full Jack Handey-style content in the 'deep_thoughts' field of the tool call:
{{#each deepThoughts}}
- {{this.topic}}
{{/each}}
{{else}}
**DEEP THOUGHTS:** If you find any additional deep thoughts now, you can still include them in the 'deep_thoughts' field of the tool call.
{{/if}}

**CONTEXT:**
{{{transcript}}}
