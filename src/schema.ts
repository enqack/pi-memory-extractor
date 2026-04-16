import { Type, Static } from "@sinclair/typebox";

/**
 * Schema for a session message payload.
 * Content is permissive (Type.Any) since it varies by message type.
 */
export const SessionMessageSchema = Type.Object(
  {
    role: Type.Union([
      Type.Literal("user"),
      Type.Literal("assistant"),
      Type.Literal("toolResult"),
    ]),
    content: Type.Any(),
    toolName: Type.Optional(Type.String()),
    toolCallId: Type.Optional(Type.String()),
    customType: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const EntryBase = {
  id: Type.String(),
  timestamp: Type.String(),
};

/** First line of a .jsonl session file — identifies the session. */
export const SessionHeaderSchema = Type.Object(
  {
    ...EntryBase,
    type: Type.Literal("session"),
    cwd: Type.String(),
    version: Type.Optional(Type.Number()),
    parentSession: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

/** Union of all possible session entry shapes. */
export const SessionEntrySchema = Type.Union(
  [
    SessionHeaderSchema,
    Type.Object(
      {
        ...EntryBase,
        type: Type.Literal("message"),
        parentId: Type.Union([Type.String(), Type.Null()]),
        message: SessionMessageSchema,
      },
      { additionalProperties: true },
    ),
    Type.Object(
      {
        ...EntryBase,
        type: Type.Literal("compaction"),
        parentId: Type.Union([Type.String(), Type.Null()]),
        summary: Type.String(),
      },
      { additionalProperties: true },
    ),
    Type.Object(
      {
        ...EntryBase,
        type: Type.Literal("custom"),
        parentId: Type.Union([Type.String(), Type.Null()]),
        customType: Type.String(),
        data: Type.Optional(Type.Any()),
      },
      { additionalProperties: true },
    ),
    Type.Object(
      {
        ...EntryBase,
        type: Type.Literal("thinking_level_change"),
        parentId: Type.Union([Type.String(), Type.Null()]),
        thinkingLevel: Type.String(),
      },
      { additionalProperties: true },
    ),
    Type.Object(
      {
        ...EntryBase,
        type: Type.Literal("model_change"),
        parentId: Type.Union([Type.String(), Type.Null()]),
        provider: Type.String(),
        modelId: Type.String(),
      },
      { additionalProperties: true },
    ),
    Type.Object(
      {
        ...EntryBase,
        type: Type.Literal("branch_summary"),
        parentId: Type.Union([Type.String(), Type.Null()]),
        summary: Type.String(),
      },
      { additionalProperties: true },
    ),
    Type.Object(
      {
        ...EntryBase,
        type: Type.Literal("custom_message"),
        parentId: Type.Union([Type.String(), Type.Null()]),
        customType: Type.String(),
        content: Type.Any(),
      },
      { additionalProperties: true },
    ),
    Type.Object(
      {
        ...EntryBase,
        type: Type.Literal("label"),
        parentId: Type.Union([Type.String(), Type.Null()]),
        label: Type.Optional(Type.String()),
      },
      { additionalProperties: true },
    ),
    Type.Object(
      {
        ...EntryBase,
        type: Type.Literal("session_info"),
        parentId: Type.Union([Type.String(), Type.Null()]),
        name: Type.Optional(Type.String()),
      },
      { additionalProperties: true },
    ),
  ],
  { additionalProperties: true },
);

export type SessionHeader = Static<typeof SessionHeaderSchema>;
export type SessionEntry = Static<typeof SessionEntrySchema>;
