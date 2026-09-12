/** GitHub read-back adapters. Schema: https://docs.github.com/en/graphql/reference/pulls */
import { join } from 'node:path';
import { GQL, graphql } from './gh.mjs';
import { operation } from './operations.mjs';
import { RunError, saveRun } from './run.mjs';

const page = 'pageInfo { hasNextPage endCursor }';
const author = 'author { login }';
const queries = {
  reviews: `query($id: ID!, $cursor: String) { viewer { login } node(id:$id) { ... on PullRequest { headRefOid reviews(first:100, after:$cursor) { nodes { id body state url commit { oid } ${author} } ${page} } } } }`,
  threads: `query($id: ID!, $cursor: String) { viewer { login } node(id:$id) { ... on PullRequest { headRefOid reviewThreads(first:100, after:$cursor) { nodes { id isResolved path line comments(first:1) { nodes { id body ${author} pullRequestReview { id } } } } ${page} } } } }`,
  comments: `query($id: ID!, $cursor: String) { viewer { login } node(id:$id) { ... on PullRequestReviewThread { id isResolved comments(first:100, after:$cursor) { nodes { id body ${author} } ${page} } } } }`,
};

export function reviewGateway(cwd, input, pr, expectedHead) {
  const call = (query, variables) => graphql(cwd, input, { query, variables });
  const list = (kind, id) => {
    const nodes = []; const seen = new Set(); let cursor = null;
    for (let n = 0; n < 100; n += 1) {
      const data = call(queries[kind], { id, cursor });
      if (!data?.node || !data.viewer?.login) throw new RunError('remote read-back returned no accessible node/viewer');
      if (kind !== 'comments' && data.node.headRefOid !== expectedHead) throw new RunError('remote PR head changed during review reconciliation');
      const connection = data.node[kind === 'threads' ? 'reviewThreads' : kind];
      if (!Array.isArray(connection?.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw new RunError('incomplete remote pagination; absence is unverified');
      for (const node of connection.nodes) nodes.push({ ...node, mine: node.author?.login === data.viewer.login,
        comments: node.comments?.nodes?.map((c) => ({ ...c, mine: c.author?.login === data.viewer.login })) });
      if (!connection.pageInfo.hasNextPage) return { nodes, resolved: data.node.isResolved };
      cursor = connection.pageInfo.endCursor;
      if (!cursor || seen.has(cursor)) throw new RunError('remote pagination did not advance');
      seen.add(cursor);
    }
    throw new RunError('remote pagination exceeded its bounded allowance');
  };
  return {
    reviews: () => list('reviews', pr).nodes,
    threads: () => list('threads', pr).nodes,
    comments: (thread) => list('comments', thread),
    create: (body) => call(`mutation($pr:ID!, $body:String!, $head:GitObjectID!) { addPullRequestReview(input:{pullRequestId:$pr, body:$body, commitOID:$head}) { pullRequestReview { id } } }`, { pr, body, head: expectedHead }),
    thread: (review, t) => call(GQL.addThread, { review, path: t.path, line: t.line, side: t.side, body: t.body }),
    submit: (review, body) => call(GQL.submitReview, { review, body }),
    reply: (thread, body) => call(GQL.reply, { thread, body }),
    resolve: (thread) => call(GQL.resolve, { thread }),
  };
}

const mark = (key) => `<!-- issueflow:operation ${key} -->`;
const unique = (items) => { if (items.length > 1) throw new RunError('multiple remote effects match one operation; reconcile manually'); return items[0] ?? null; };

export function reconcileReply(dir, run, { target, threadId, body, resolve = false }, gateway) {
  const reply = operation(dir, run, { kind: 'thread-reply', target, intent: { threadId, body },
    read: (key) => unique(gateway.comments(threadId).nodes.filter((c) => c.mine && c.body === `${body}\n\n${mark(key)}`)),
    write: (key) => gateway.reply(threadId, `${body}\n\n${mark(key)}`) });
  if (resolve) operation(dir, run, { kind: 'thread-resolve', target, intent: { threadId }, retrySafe: true,
    read: () => gateway.comments(threadId).resolved ? { threadId, resolved: true } : null,
    write: () => gateway.resolve(threadId) });
  return reply;
}

export function reconcileReview(dir, run, lane, entry, payload, gateway = reviewGateway(run.repo.path, join(dir, 'remote-review.json'), lane.pr.nodeId, entry.head)) {
  const target = `${lane.pr.url}/round/${entry.round}`;
  let createKey;
  const review = operation(dir, run, { kind: 'review-create', target, intent: { head: entry.head },
    read: (key) => { createKey = key; return unique(gateway.reviews().filter((r) => r.mine && r.commit?.oid === entry.head && r.body.includes(mark(key)))); },
    write: (key) => gateway.create(mark(key)) });
  for (const t of payload.threads) {
    const result = operation(dir, run, { kind: 'review-thread', target, intent: { reviewId: review.id, ...t },
      read: () => unique(gateway.threads().filter((r) => r.path === t.path && r.line === t.line && r.comments.some((c) => c.mine && c.body === t.body && c.pullRequestReview?.id === review.id))),
      write: () => gateway.thread(review.id, t) });
    const finding = lane.review.findings.find((f) => f.id === t.id);
    finding.threadId = result.id; finding.posted = true; saveRun(dir, run);
  }
  const body = `${payload.body}\n\n${mark(createKey)}`;
  const submitted = operation(dir, run, { kind: 'review-submit', target, intent: { reviewId: review.id, body },
    read: () => unique(gateway.reviews().filter((r) => r.id === review.id && r.mine && r.state === 'COMMENTED' && r.body === body)),
    write: () => gateway.submit(review.id, body) });
  for (const r of payload.replies) reconcileReply(dir, run, { ...r, target }, gateway);
  entry.posted = { at: new Date().toISOString(), reviewId: review.id, url: submitted.url, threads: payload.threads.length, unanchored: 0,
    replies: payload.replies.map((r) => ({ id: r.id, state: r.resolve ? 'resolved' : 'replied' })) };
  saveRun(dir, run);
  return entry.posted;
}
