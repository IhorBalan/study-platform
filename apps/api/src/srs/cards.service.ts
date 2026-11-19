import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { schema } from '@study/db';
import type { CardDto, CardStatus, CreateCard, UpdateCard } from '@study/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { CurriculumService } from '../curriculum/curriculum.service.js';
import { InjectDb, type Database } from '../database/database.module.js';

const { cards, cardSchedules, cardSkills, skills } = schema;

@Injectable()
export class CardsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly curriculum: CurriculumService,
  ) {}

  async list(filter: { status?: CardStatus; lessonId?: string }): Promise<CardDto[]> {
    const where = and(
      filter.status ? eq(cards.status, filter.status) : undefined,
      filter.lessonId ? eq(cards.lessonId, filter.lessonId) : undefined,
    );
    const rows = await this.db
      .select()
      .from(cards)
      .innerJoin(cardSchedules, eq(cardSchedules.cardId, cards.id))
      .where(where)
      .orderBy(desc(cards.createdAt));
    return this.toDtos(rows);
  }

  async get(id: string): Promise<CardDto> {
    const rows = await this.db
      .select()
      .from(cards)
      .innerJoin(cardSchedules, eq(cardSchedules.cardId, cards.id))
      .where(eq(cards.id, id));
    const [dto] = await this.toDtos(rows);
    if (!dto) throw new NotFoundException(`Card "${id}" does not exist`);
    return dto;
  }

  /** Manual cards are active at once: the learner wrote them, so there is nothing to approve. */
  async create(input: CreateCard): Promise<CardDto> {
    if (input.lessonId) this.curriculum.lesson(input.lessonId);
    await this.assertSkillsExist(input.skills);

    const id = await this.db.transaction(async (tx) => {
      const [card] = await tx
        .insert(cards)
        .values({
          type: input.type,
          front: input.front,
          back: input.back,
          source: 'manual',
          status: 'active',
          lessonId: input.lessonId ?? null,
        })
        .returning({ id: cards.id });
      if (!card) throw new Error('insert returned no row');
      await tx.insert(cardSchedules).values({ cardId: card.id });
      if (input.skills.length > 0) {
        await tx
          .insert(cardSkills)
          .values(input.skills.map((skillId) => ({ cardId: card.id, skillId })));
      }
      return card.id;
    });
    return this.get(id);
  }

  async update(id: string, patch: UpdateCard): Promise<CardDto> {
    const current = await this.get(id);
    if (Object.keys(patch).length > 0) {
      // Once the learner has changed the text, the card is theirs: a later
      // correction in the curriculum must not overwrite it. A form that sends
      // every field back unchanged is not an edit.
      const textChanged =
        (patch.type !== undefined && patch.type !== current.type) ||
        (patch.front !== undefined && patch.front !== current.front) ||
        (patch.back !== undefined && patch.back !== current.back);
      await this.db
        .update(cards)
        .set(textChanged ? { ...patch, editedAt: new Date() } : patch)
        .where(eq(cards.id, id));
    }
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(cards)
        .where(eq(cards.id, id))
        .returning({ source: cards.source, sourceKey: cards.sourceKey });
      const [card] = deleted;
      if (!card) throw new NotFoundException(`Card "${id}" does not exist`);
      // Remember a deleted lesson card, so a curriculum update does not add it again.
      if (card.source === 'lesson' && card.sourceKey) {
        await tx
          .insert(schema.removedLessonCards)
          .values({ sourceKey: card.sourceKey })
          .onConflictDoNothing();
      }
    });
  }

  private async assertSkillsExist(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.db
      .select({ id: skills.id })
      .from(skills)
      .where(inArray(skills.id, ids));
    const known = new Set(found.map((s) => s.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown skill(s): ${unknown.join(', ')}`);
    }
  }

  async toDtos(
    rows: {
      cards: typeof cards.$inferSelect;
      card_schedules: typeof cardSchedules.$inferSelect;
    }[],
  ): Promise<CardDto[]> {
    if (rows.length === 0) return [];
    const links = await this.db
      .select()
      .from(cardSkills)
      .where(
        inArray(
          cardSkills.cardId,
          rows.map((r) => r.cards.id),
        ),
      );
    const skillsByCard = Map.groupBy(links, (l) => l.cardId);
    return rows.map(({ cards: c, card_schedules: s }) => ({
      id: c.id,
      type: c.type,
      front: c.front,
      back: c.back,
      source: c.source,
      status: c.status,
      lessonId: c.lessonId,
      skills: (skillsByCard.get(c.id) ?? []).map((l) => l.skillId),
      state: s.state,
      due: s.due.toISOString(),
      reps: s.reps,
      lapses: s.lapses,
    }));
  }
}
