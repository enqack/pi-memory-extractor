# Skill: Memory Extractor

The Memory Extractor skill allows you to transform session insights into long-term structured knowledge. It uses a multi-step orchestrated workflow to ensure high-fidelity capture.

## When to use
- After a significant technical discovery or decision.
- Before a session compaction or shutdown (usually automatic).
- When the user asks to "save this for later" or "remember this".
- When you want to compile daily logs into a structured knowledge base.

## Tools
- `extract_knowledge`: Triggers the 3-step extraction workflow (Analysis -> Mapping -> Synthesis).
- `compile_knowledge`: Compiles daily logs into the permanent vault.
- `search_knowledge`: Search the existing knowledge base.
- `read_knowledge_article`: Read a full article from the vault.

## Workflow: Knowledge Extraction
When `extract_knowledge` is triggered, an **Orchestrator** will guide you through three turns:

1. **Phase 1: Analysis**: Identify 3 dominant themes and check for "Deep Thoughts".
2. **Phase 2: Mapping**: Identify at least 4 entities and their relationships.
3. **Phase 3: Synthesis**: Call `submit_knowledge_synthesis` with the final JSON packet.

Follow the Orchestrator's directives exactly during these phases.

## Workflow: Compilation
When `compile_knowledge` is triggered, you will be given a list of daily logs. Your task is to:
1. Read the logs.
2. Extract concepts, Q&A, and lessons learned.
3. Update the `knowledge/index.md` and create/edit articles in the appropriate sub-directories.
4. Archive old articles if prompted.
