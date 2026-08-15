import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  journeyFeedEntries,
  journeyIdeas,
  type JourneySourceType,
} from "../db/schema.js";

export type JourneyIdea = typeof journeyIdeas.$inferSelect;
export type JourneyFeedEntry = typeof journeyFeedEntries.$inferSelect;

export type CreateJourneyIdeaInput = {
  userId: string;
  title: string;
  sourceType: JourneySourceType;
  sourceReference: string;
};

export type CreateJourneyFeedEntryInput = {
  ideaId: string;
  userId: string;
  content: string;
};

export type UpdateJourneyFeedEntryInput = CreateJourneyFeedEntryInput & {
  entryId: string;
};

export interface JourneyStore {
  listIdeas(userId: string): Promise<JourneyIdea[]>;
  createIdea(input: CreateJourneyIdeaInput): Promise<JourneyIdea>;
  findIdeaByIdForUser(
    ideaId: string,
    userId: string,
  ): Promise<JourneyIdea | null>;
  listFeedEntries(
    ideaId: string,
    userId: string,
  ): Promise<JourneyFeedEntry[] | null>;
  createFeedEntry(
    input: CreateJourneyFeedEntryInput,
  ): Promise<JourneyFeedEntry | null>;
  updateFeedEntry(
    input: UpdateJourneyFeedEntryInput,
  ): Promise<JourneyFeedEntry | null>;
  deleteFeedEntry(
    entryId: string,
    ideaId: string,
    userId: string,
  ): Promise<boolean>;
}

async function ownsIdea(ideaId: string, userId: string) {
  const [idea] = await getDb()
    .select({ id: journeyIdeas.id })
    .from(journeyIdeas)
    .where(and(eq(journeyIdeas.id, ideaId), eq(journeyIdeas.userId, userId)))
    .limit(1);

  return Boolean(idea);
}

export const journeyStore: JourneyStore = {
  async listIdeas(userId) {
    return getDb()
      .select()
      .from(journeyIdeas)
      .where(eq(journeyIdeas.userId, userId))
      .orderBy(desc(journeyIdeas.createdAt));
  },

  async createIdea(input) {
    const [idea] = await getDb()
      .insert(journeyIdeas)
      .values(input)
      .returning();

    if (!idea) {
      throw new Error("The Journey idea could not be created.");
    }

    return idea;
  },

  async findIdeaByIdForUser(ideaId, userId) {
    const [idea] = await getDb()
      .select()
      .from(journeyIdeas)
      .where(and(eq(journeyIdeas.id, ideaId), eq(journeyIdeas.userId, userId)))
      .limit(1);

    return idea ?? null;
  },

  async listFeedEntries(ideaId, userId) {
    if (!(await ownsIdea(ideaId, userId))) {
      return null;
    }

    return getDb()
      .select()
      .from(journeyFeedEntries)
      .where(eq(journeyFeedEntries.ideaId, ideaId))
      .orderBy(desc(journeyFeedEntries.createdAt));
  },

  async createFeedEntry(input) {
    if (!(await ownsIdea(input.ideaId, input.userId))) {
      return null;
    }

    const [entry] = await getDb()
      .insert(journeyFeedEntries)
      .values({ ideaId: input.ideaId, content: input.content })
      .returning();

    return entry ?? null;
  },

  async updateFeedEntry(input) {
    if (!(await ownsIdea(input.ideaId, input.userId))) {
      return null;
    }

    const [entry] = await getDb()
      .update(journeyFeedEntries)
      .set({ content: input.content, updatedAt: new Date() })
      .where(
        and(
          eq(journeyFeedEntries.id, input.entryId),
          eq(journeyFeedEntries.ideaId, input.ideaId),
        ),
      )
      .returning();

    return entry ?? null;
  },

  async deleteFeedEntry(entryId, ideaId, userId) {
    if (!(await ownsIdea(ideaId, userId))) {
      return false;
    }

    const deleted = await getDb()
      .delete(journeyFeedEntries)
      .where(
        and(
          eq(journeyFeedEntries.id, entryId),
          eq(journeyFeedEntries.ideaId, ideaId),
        ),
      )
      .returning({ id: journeyFeedEntries.id });

    return deleted.length > 0;
  },
};
