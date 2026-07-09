// Durable checkpoint store for the LangGraph agent graph.
//
// This is the persistence half of native HITL: when the graph compiles WITH a
// checkpointer, an `interrupt()` can suspend a run at a human-gate, and the run
// resumes later (even after a process restart) from the last saved checkpoint.
//
// It mirrors LangGraph's reference MemorySaver / PostgresSaver semantics against
// our own thin `Db` abstraction (pglite in dev, Postgres in prod), so the SAME
// saver works in both. Serialized state goes through the checkpoint serde and is
// stored as base64 TEXT — no bytea/encoding split between the two backends.
//
// Tenancy is carried by `thread_id` (minted `<customerId>:<uuid>`). This class
// is a GENERIC keyed store — LangGraph drives getTuple/put/putWrites with the
// run's raw config, so the saver cannot self-enforce the customer boundary.
// Enforcement lives at the caller: mint ids with `mintThreadId(customerId)` and
// gate every resume with `assertThreadOwnership(customerId, threadId)` (both in
// interruptible.ts). The live consumer is POST /v1/proposals/:id/countersign
// (four-eyes dual-authorization); any other route that drives this saver MUST do
// the same. See migration 008_checkpoints.sql.

import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  getCheckpointId,
  copyCheckpoint,
  type Checkpoint,
  type CheckpointTuple,
  type CheckpointMetadata,
  type CheckpointListOptions,
  type PendingWrite,
  type CheckpointPendingWrite,
  type ChannelVersions,
  type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { Db } from '../db/index.js';

const toB64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const fromB64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint: string;
  metadata: string;
}

interface WriteRow {
  task_id: string;
  channel: string;
  value: string;
}

/**
 * A {@link BaseCheckpointSaver} backed by the shared `Db` abstraction. Concrete
 * implementation of the five abstract methods LangGraph requires
 * (getTuple/list/put/putWrites/deleteThread), each scoped by
 * (thread_id, checkpoint_ns, checkpoint_id) exactly like the in-memory and
 * Postgres reference savers.
 */
export class DbCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    private readonly db: Db,
    serde?: SerializerProtocol,
  ) {
    super(serde);
  }

  private async loadWrites(
    thread_id: string,
    checkpoint_ns: string,
    checkpoint_id: string,
  ): Promise<CheckpointPendingWrite[]> {
    const rows = await this.db.query<WriteRow>(
      `SELECT task_id, channel, value FROM graph_checkpoint_writes
       WHERE thread_id = $1 AND checkpoint_ns = $2 AND checkpoint_id = $3
       ORDER BY idx`,
      [thread_id, checkpoint_ns, checkpoint_id],
    );
    return Promise.all(
      rows.map(
        async (w) =>
          [w.task_id, w.channel, await this.serde.loadsTyped('json', fromB64(w.value))] as CheckpointPendingWrite,
      ),
    );
  }

  private async rowToTuple(row: CheckpointRow): Promise<CheckpointTuple> {
    const checkpoint = (await this.serde.loadsTyped('json', fromB64(row.checkpoint))) as Checkpoint;
    const metadata = (await this.serde.loadsTyped('json', fromB64(row.metadata))) as CheckpointMetadata;
    const pendingWrites = await this.loadWrites(row.thread_id, row.checkpoint_ns, row.checkpoint_id);
    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };
    if (row.parent_checkpoint_id != null) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const thread_id = config.configurable?.thread_id as string | undefined;
    if (thread_id === undefined) return undefined;
    const checkpoint_ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const checkpoint_id = getCheckpointId(config);

    const rows = checkpoint_id
      ? await this.db.query<CheckpointRow>(
          `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata
           FROM graph_checkpoints
           WHERE thread_id = $1 AND checkpoint_ns = $2 AND checkpoint_id = $3`,
          [thread_id, checkpoint_ns, checkpoint_id],
        )
      : await this.db.query<CheckpointRow>(
          `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata
           FROM graph_checkpoints
           WHERE thread_id = $1 AND checkpoint_ns = $2
           ORDER BY checkpoint_id DESC
           LIMIT 1`,
          [thread_id, checkpoint_ns],
        );

    const row = rows[0];
    if (!row) return undefined;
    return this.rowToTuple(row);
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const thread_id = config.configurable?.thread_id as string | undefined;
    const checkpoint_ns = config.configurable?.checkpoint_ns as string | undefined;
    const { before, limit, filter } = options ?? {};

    const params: unknown[] = [];
    let sql =
      `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata
       FROM graph_checkpoints WHERE 1 = 1`;
    if (thread_id !== undefined) {
      params.push(thread_id);
      sql += ` AND thread_id = $${params.length}`;
    }
    if (checkpoint_ns !== undefined) {
      params.push(checkpoint_ns);
      sql += ` AND checkpoint_ns = $${params.length}`;
    }
    const beforeId = before?.configurable?.checkpoint_id as string | undefined;
    if (beforeId) {
      params.push(beforeId);
      sql += ` AND checkpoint_id < $${params.length}`;
    }
    sql += ` ORDER BY checkpoint_id DESC`;
    // Without a metadata filter, `limit` maps straight to SQL LIMIT so we never
    // fetch + deserialize (and second-query the writes of) more rows than asked.
    // With a filter, metadata lives inside the serialized blob, so we must read
    // and post-filter in JS and cannot push the limit down.
    if (limit !== undefined && !filter) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }

    const rows = await this.db.query<CheckpointRow>(sql, params);
    let yielded = 0;
    for (const row of rows) {
      if (limit !== undefined && yielded >= limit) break;
      const tuple = await this.rowToTuple(row);
      if (filter && !Object.entries(filter).every(([k, v]) => (tuple.metadata as Record<string, unknown>)?.[k] === v)) {
        continue;
      }
      yielded += 1;
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const thread_id = config.configurable?.thread_id as string | undefined;
    if (thread_id === undefined) throw new Error('DbCheckpointSaver.put: missing thread_id in config.configurable');
    const checkpoint_ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const parent = (config.configurable?.checkpoint_id as string | undefined) ?? null;

    const [, ckBytes] = await this.serde.dumpsTyped(copyCheckpoint(checkpoint));
    const [, mdBytes] = await this.serde.dumpsTyped(metadata);

    await this.db.query(
      `INSERT INTO graph_checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id)
       DO UPDATE SET parent_checkpoint_id = EXCLUDED.parent_checkpoint_id,
                     checkpoint = EXCLUDED.checkpoint,
                     metadata = EXCLUDED.metadata`,
      [thread_id, checkpoint_ns, checkpoint.id, parent, toB64(ckBytes), toB64(mdBytes)],
    );

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const thread_id = config.configurable?.thread_id as string | undefined;
    if (thread_id === undefined) throw new Error('DbCheckpointSaver.putWrites: missing thread_id in config.configurable');
    const checkpoint_ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const checkpoint_id = config.configurable?.checkpoint_id as string | undefined;
    if (checkpoint_id === undefined) {
      throw new Error('DbCheckpointSaver.putWrites: missing checkpoint_id in config.configurable');
    }

    for (let i = 0; i < writes.length; i += 1) {
      const [channel, value] = writes[i]!;
      // Special channels have a fixed negative slot (WRITES_IDX_MAP) and always
      // overwrite; ordinary writes take their positional index and are written
      // once (a retry of the same task must not duplicate or clobber them).
      const idx = WRITES_IDX_MAP[channel] ?? i;
      const conflict =
        idx >= 0
          ? 'DO NOTHING'
          : 'DO UPDATE SET channel = EXCLUDED.channel, value = EXCLUDED.value';
      const [, vBytes] = await this.serde.dumpsTyped(value);
      await this.db.query(
        `INSERT INTO graph_checkpoint_writes
           (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id, task_id, idx) ${conflict}`,
        [thread_id, checkpoint_ns, checkpoint_id, taskId, idx, channel, toB64(vBytes)],
      );
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.db.query(`DELETE FROM graph_checkpoint_writes WHERE thread_id = $1`, [threadId]);
    await this.db.query(`DELETE FROM graph_checkpoints WHERE thread_id = $1`, [threadId]);
  }
}
