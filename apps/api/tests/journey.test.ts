import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import type {
  CreateJourneyFeedEntryInput,
  CreateJourneyIdeaInput,
  JourneyFeedEntry,
  JourneyIdea,
  JourneyStore,
  UpdateJourneyFeedEntryInput,
} from "../src/journey/repository.js";
import { createServer } from "../src/server.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET =
  "test-only-cookie-secret-with-more-than-thirty-two-characters";

const firstUser: AuthUser = {
  id: "1ea48778-ef55-4a23-a550-0f31801a6413",
  username: "memoos-user",
  passwordHash: "unused",
};

const secondUser: AuthUser = {
  id: "f3a8af82-632c-4773-a57d-68ca21d10a8b",
  username: "other-user",
  passwordHash: "unused",
};

class MemoryAuthStore implements AuthStore {
  private readonly users = [firstUser, secondUser];

  async findById(userId: string) {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async findByUsername(username: string) {
    return this.users.find((user) => user.username === username) ?? null;
  }
}

class MemoryJourneyStore implements JourneyStore {
  readonly ideas: JourneyIdea[] = [];
  readonly entries: JourneyFeedEntry[] = [];
  private timestamp = Date.parse("2026-08-12T12:00:00.000Z");

  private now() {
    this.timestamp += 1_000;
    return new Date(this.timestamp);
  }

  private ownsIdea(ideaId: string, userId: string) {
    return this.ideas.some(
      (idea) => idea.id === ideaId && idea.userId === userId,
    );
  }

  async listIdeas(userId: string) {
    return this.ideas
      .filter((idea) => idea.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async createIdea(input: CreateJourneyIdeaInput) {
    const now = this.now();
    const idea: JourneyIdea = {
      id: randomUUID(),
      userId: input.userId,
      title: input.title,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      createdAt: now,
      updatedAt: now,
    };

    this.ideas.push(idea);
    return idea;
  }

  async findIdeaByIdForUser(ideaId: string, userId: string) {
    return (
      this.ideas.find(
        (idea) => idea.id === ideaId && idea.userId === userId,
      ) ?? null
    );
  }

  async listFeedEntries(ideaId: string, userId: string) {
    if (!this.ownsIdea(ideaId, userId)) {
      return null;
    }

    return this.entries
      .filter((entry) => entry.ideaId === ideaId)
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      );
  }

  async createFeedEntry(input: CreateJourneyFeedEntryInput) {
    if (!this.ownsIdea(input.ideaId, input.userId)) {
      return null;
    }

    const now = this.now();
    const entry: JourneyFeedEntry = {
      id: randomUUID(),
      ideaId: input.ideaId,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    };

    this.entries.push(entry);
    return entry;
  }

  async updateFeedEntry(input: UpdateJourneyFeedEntryInput) {
    if (!this.ownsIdea(input.ideaId, input.userId)) {
      return null;
    }

    const entry = this.entries.find(
      (candidate) =>
        candidate.id === input.entryId && candidate.ideaId === input.ideaId,
    );

    if (!entry) {
      return null;
    }

    entry.content = input.content;
    entry.updatedAt = this.now();
    return entry;
  }

  async deleteFeedEntry(
    entryId: string,
    ideaId: string,
    userId: string,
  ) {
    if (!this.ownsIdea(ideaId, userId)) {
      return false;
    }

    const index = this.entries.findIndex(
      (entry) => entry.id === entryId && entry.ideaId === ideaId,
    );

    if (index < 0) {
      return false;
    }

    this.entries.splice(index, 1);
    return true;
  }
}

function sessionCookie(userId: string) {
  return createSessionCookie(userId).split(";", 1)[0];
}

function testServer(store = new MemoryJourneyStore()) {
  return {
    store,
    server: createServer(
      {},
      {
        authStore: new MemoryAuthStore(),
        journeyStore: store,
      },
    ),
  };
}

async function createIdea(
  server: ReturnType<typeof createServer>,
  cookie: string,
) {
  const response = await server.inject({
    method: "POST",
    url: "/journey/ideas",
    headers: { cookie },
    payload: {
      title: "Arcoíris de sonido",
      sourceType: "book",
      sourceReference: "Acoustics, chapter 3",
    },
  });

  assert.equal(response.statusCode, 201);
  return response.json().idea as { id: string };
}

test("Journey requires authentication for ideas and feed entries", async () => {
  const { store, server } = testServer();

  try {
    const list = await server.inject({ method: "GET", url: "/journey/ideas" });
    const creation = await server.inject({
      method: "POST",
      url: "/journey/ideas",
      payload: {
        title: "Idea",
        sourceType: "url",
        sourceReference: "https://example.com",
      },
    });
    const entry = await server.inject({
      method: "POST",
      url: `/journey/ideas/${randomUUID()}/entries`,
      payload: { content: "A note" },
    });

    assert.equal(list.statusCode, 401);
    assert.equal(creation.statusCode, 401);
    assert.equal(entry.statusCode, 401);
    assert.equal(store.ideas.length, 0);
    assert.equal(store.entries.length, 0);
  } finally {
    await server.close();
  }
});

test("Journey validates idea fields and source types", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const missingTitle = await server.inject({
      method: "POST",
      url: "/journey/ideas",
      headers: { cookie },
      payload: {
        title: " ",
        sourceType: "book",
        sourceReference: "Chapter 3",
      },
    });
    const invalidSource = await server.inject({
      method: "POST",
      url: "/journey/ideas",
      headers: { cookie },
      payload: {
        title: "Idea",
        sourceType: "podcast",
        sourceReference: "Episode 2",
      },
    });

    assert.equal(missingTitle.statusCode, 400);
    assert.equal(invalidSource.statusCode, 400);
  } finally {
    await server.close();
  }
});

test("an idea is persisted, listed and visible only to its owner", async () => {
  const { store, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const idea = await createIdea(server, ownerCookie);
    const ownerList = await server.inject({
      method: "GET",
      url: "/journey/ideas",
      headers: { cookie: ownerCookie },
    });
    const ownerDetail = await server.inject({
      method: "GET",
      url: `/journey/ideas/${idea.id}`,
      headers: { cookie: ownerCookie },
    });
    const otherDetail = await server.inject({
      method: "GET",
      url: `/journey/ideas/${idea.id}`,
      headers: { cookie: otherCookie },
    });

    assert.equal(store.ideas[0]?.userId, firstUser.id);
    assert.equal(ownerList.statusCode, 200);
    assert.equal(ownerList.json().ideas[0].title, "Arcoíris de sonido");
    assert.equal(ownerDetail.statusCode, 200);
    assert.equal(ownerDetail.json().idea.sourceType, "book");
    assert.equal(otherDetail.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("feed entries support ordered create, reload, edit and delete", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const idea = await createIdea(server, cookie);
    const firstCreation = await server.inject({
      method: "POST",
      url: `/journey/ideas/${idea.id}/entries`,
      headers: { cookie },
      payload: { content: "  Primera observación.  " },
    });
    const secondCreation = await server.inject({
      method: "POST",
      url: `/journey/ideas/${idea.id}/entries`,
      headers: { cookie },
      payload: { content: "Segunda observación." },
    });

    assert.equal(firstCreation.statusCode, 201);
    assert.equal(firstCreation.json().entry.content, "Primera observación.");
    assert.equal(secondCreation.statusCode, 201);

    const listing = await server.inject({
      method: "GET",
      url: `/journey/ideas/${idea.id}/entries`,
      headers: { cookie },
    });
    const entries = listing.json().entries as Array<{
      id: string;
      content: string;
    }>;

    assert.equal(listing.statusCode, 200);
    assert.deepEqual(
      entries.map((entry) => entry.content),
      ["Segunda observación.", "Primera observación."],
    );

    const entryId = entries[0]?.id;
    assert.ok(entryId);
    const update = await server.inject({
      method: "PATCH",
      url: `/journey/ideas/${idea.id}/entries/${entryId}`,
      headers: { cookie },
      payload: { content: "Segunda observación editada." },
    });

    assert.equal(update.statusCode, 200);
    assert.equal(update.json().entry.content, "Segunda observación editada.");

    const reloaded = await server.inject({
      method: "GET",
      url: `/journey/ideas/${idea.id}/entries`,
      headers: { cookie },
    });
    assert.equal(
      reloaded.json().entries[0].content,
      "Segunda observación editada.",
    );

    const deletion = await server.inject({
      method: "DELETE",
      url: `/journey/ideas/${idea.id}/entries/${entryId}`,
      headers: { cookie },
    });
    const afterDeletion = await server.inject({
      method: "GET",
      url: `/journey/ideas/${idea.id}/entries`,
      headers: { cookie },
    });

    assert.equal(deletion.statusCode, 204);
    assert.deepEqual(
      afterDeletion.json().entries.map((entry: { content: string }) =>
        entry.content,
      ),
      ["Primera observación."],
    );
  } finally {
    await server.close();
  }
});

test("a different user cannot read or mutate another user's feed", async () => {
  const { server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const idea = await createIdea(server, ownerCookie);
    const creation = await server.inject({
      method: "POST",
      url: `/journey/ideas/${idea.id}/entries`,
      headers: { cookie: ownerCookie },
      payload: { content: "Private note" },
    });
    const entryId = creation.json().entry.id as string;

    const listing = await server.inject({
      method: "GET",
      url: `/journey/ideas/${idea.id}/entries`,
      headers: { cookie: otherCookie },
    });
    const update = await server.inject({
      method: "PATCH",
      url: `/journey/ideas/${idea.id}/entries/${entryId}`,
      headers: { cookie: otherCookie },
      payload: { content: "Changed" },
    });
    const deletion = await server.inject({
      method: "DELETE",
      url: `/journey/ideas/${idea.id}/entries/${entryId}`,
      headers: { cookie: otherCookie },
    });

    assert.equal(listing.statusCode, 404);
    assert.equal(update.statusCode, 404);
    assert.equal(deletion.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("Journey migration is additive and contains only the required tables", async () => {
  const migration = await readFile(
    new URL("../drizzle/0004_create_journey.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE "journey_ideas"/);
  assert.match(migration, /CREATE TABLE "journey_feed_entries"/);
  assert.match(migration, /REFERENCES "users" \("id"\)/);
  assert.match(migration, /REFERENCES "journey_ideas" \("id"\)/);
  assert.doesNotMatch(
    migration,
    /\b(?:DROP|TRUNCATE|ALTER)\b|\bDELETE\s+FROM\b/i,
  );
});
